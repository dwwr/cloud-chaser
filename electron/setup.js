const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");
const zlib = require("zlib");

const FFMPEG_RELEASE = "b6.1.1";
const FFMPEG_ASSETS = {
  arm64: {
    file: "ffmpeg-darwin-arm64.gz",
    sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
  },
  x64: {
    file: "ffmpeg-darwin-x64.gz",
    sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
  },
};

function request(url, redirects) {
  const remaining = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "cloud-chaser" } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (remaining <= 0) {
          reject(new Error("Download failed."));
          return;
        }
        resolve(request(new URL(res.headers.location, url).toString(), remaining - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Download failed (${status}).`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });
}

function download(url) {
  return request(url).then(
    (res) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
  );
}

function run(command, args, options, onStatus) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    let last = "";
    const take = (chunk) => {
      text += chunk.toString();
      const lines = text.split(/\r?\n/);
      text = lines.pop() || "";
      for (const line of lines) {
        if (line) {
          last = line;
        }
      }
      if (last && onStatus) {
        onStatus(last);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error((text || last).trim() || `Command failed (${code}).`));
    });
  });
}

function canImport(python, packages) {
  return new Promise((resolve) => {
    const env = { ...process.env, PYTHONPATH: packages };
    const child = spawn(python, ["-c", "import demucs"], { env, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function findFfmpeg(support) {
  const local = path.join(support, "ffmpeg", "ffmpeg");
  if (fs.existsSync(local)) {
    return local;
  }
  const pathEnv = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", process.env.PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);
  return new Promise((resolve) => {
    const child = spawn("which", ["ffmpeg"], {
      env: { ...process.env, PATH: pathEnv },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("error", () => resolve(""));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve("");
        return;
      }
      resolve(text.trim().split(/\r?\n/)[0] || "");
    });
  });
}

async function downloadFfmpeg(support) {
  const asset = FFMPEG_ASSETS[process.arch];
  if (!asset) {
    throw new Error(`ffmpeg is not available for ${process.arch}.`);
  }
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/${asset.file}`;
  const packed = await download(url);
  const digest = crypto.createHash("sha256").update(packed).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error("The ffmpeg download did not match the pinned checksum.");
  }
  const binary = zlib.gunzipSync(packed);
  const directory = path.join(support, "ffmpeg");
  fs.mkdirSync(directory, { recursive: true });
  const dest = path.join(directory, "ffmpeg");
  fs.writeFileSync(dest, binary, { mode: 0o755 });
  fs.chmodSync(dest, 0o755);
  return dest;
}

async function prepare({ python, appRoot, support, onStatus }) {
  fs.mkdirSync(support, { recursive: true });
  const packages = path.join(support, "python-packages");
  const stamp = path.join(support, "ready");
  const marker = `${python}\n`;
  const stamped = fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === marker;
  const ready = stamped ? await findFfmpeg(support) : "";
  if (ready) {
    return path.dirname(ready);
  }
  fs.mkdirSync(packages, { recursive: true });
  if (!(await canImport(python, packages))) {
    await onStatus("Installing stem tools. This download is large.");
    await run(
      python,
      ["-m", "pip", "install", "--disable-pip-version-check", "--target", packages, ".[instrumental]"],
      { cwd: appRoot, env: process.env },
      onStatus
    );
  }
  let binary = await findFfmpeg(support);
  if (!binary) {
    await onStatus("Downloading ffmpeg.");
    binary = await downloadFfmpeg(support);
  }
  fs.writeFileSync(stamp, marker);
  return path.dirname(binary);
}

module.exports = { prepare, findFfmpeg, FFMPEG_ASSETS };

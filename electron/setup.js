const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");
const zlib = require("zlib");

const FFMPEG_RELEASE = "b6.1.1";
const MEDIA_TOOLS = ["ffmpeg", "ffprobe"];
const FFMPEG_ASSETS = {
  arm64: {
    ffmpeg: {
      file: "ffmpeg-darwin-arm64.gz",
      sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
    },
    ffprobe: {
      file: "ffprobe-darwin-arm64.gz",
      sha256: "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be",
    },
  },
  x64: {
    ffmpeg: {
      file: "ffmpeg-darwin-x64.gz",
      sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
    },
    ffprobe: {
      file: "ffprobe-darwin-x64.gz",
      sha256: "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186",
    },
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

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function download(url, label, onStatus) {
  return request(url).then(
    (res) =>
      new Promise((resolve, reject) => {
        const total = Number(res.headers["content-length"]) || 0;
        const chunks = [];
        let received = 0;
        res.on("data", (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          if (onStatus) {
            const got = formatBytes(received);
            const all = total ? ` / ${formatBytes(total)}` : "";
            onStatus(`\r${label} ${got}${all}`);
          }
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
  );
}

function run(command, args, options, onStatus) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    const take = (chunk) => {
      const piece = chunk.toString();
      text += piece;
      if (onStatus) {
        onStatus(piece);
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
      const visible = text
        .split("\n")
        .map((line) => line.split("\r").pop())
        .join("\n")
        .trim();
      reject(new Error(visible.split("\n").filter(Boolean).at(-1) || `Command failed (${code}).`));
    });
  });
}

const RUNTIME_PACKAGES = ["yt-dlp>=2025.1.15", "demucs>=4.0.0", "numpy>=1.26"];
const MODEL_NAMES = ["htdemucs", "htdemucs_6s"];

const ENSURE_MODELS = `
from pathlib import Path

import numpy
import yaml
import yt_dlp
from demucs.hf import DEFAULT_NAMESPACE, hf_repo_name
from demucs.pretrained import get_model
from huggingface_hub import try_to_load_from_cache

names = ${JSON.stringify(MODEL_NAMES)}

def cached(repo, filename):
    found = try_to_load_from_cache(repo, filename)
    if not isinstance(found, str):
        return False
    path = Path(found)
    return path.is_file() and path.stat().st_size > 0

def ready(name):
    repo = f"{DEFAULT_NAMESPACE}/{hf_repo_name(name)}"
    if not cached(repo, f"{name}.yaml"):
        return False
    yaml_path = try_to_load_from_cache(repo, f"{name}.yaml")
    bag = yaml.safe_load(Path(yaml_path).read_text())
    return all(cached(repo, f"{sig}.safetensors") for sig in bag["models"])

for name in names:
    if ready(name):
        continue
    print(f"Downloading the {name} model.", flush=True)
    get_model(name)
    if not ready(name):
        raise SystemExit(f"The {name} model is missing.")
`;

function supportEnv(support) {
  return {
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    HF_HOME: path.join(support, "cache", "huggingface"),
    TORCH_HOME: path.join(support, "cache", "torch"),
    XDG_CACHE_HOME: path.join(support, "cache"),
  };
}

function commandEnv(support, packages) {
  return { ...process.env, ...supportEnv(support), PYTHONPATH: packages };
}

function canRun(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function toolPath(support, name) {
  return path.join(support, "ffmpeg", name);
}

function findFfmpeg(support) {
  const local = toolPath(support, "ffmpeg");
  if (fs.existsSync(local)) {
    return local;
  }
  return "";
}

async function downloadTool(support, name, onStatus) {
  const assets = FFMPEG_ASSETS[process.arch];
  const asset = assets && assets[name];
  if (!asset) {
    throw new Error(`${name} is not available for ${process.arch}.`);
  }
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/${asset.file}`;
  const packed = await download(url, name, onStatus);
  if (onStatus) {
    onStatus("\n");
  }
  const digest = crypto.createHash("sha256").update(packed).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`The ${name} download did not match the pinned checksum.`);
  }
  const binary = zlib.gunzipSync(packed);
  const directory = path.join(support, "ffmpeg");
  fs.mkdirSync(directory, { recursive: true });
  const dest = toolPath(support, name);
  fs.writeFileSync(dest, binary, { mode: 0o755 });
  fs.chmodSync(dest, 0o755);
  return dest;
}

function installPackages(python, packages, support, onStatus) {
  return run(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--target",
      packages,
      ...RUNTIME_PACKAGES,
    ],
    { cwd: support, env: commandEnv(support, packages) },
    onStatus
  );
}

async function installFresh(python, packages, support, onStatus) {
  fs.rmSync(packages, { recursive: true, force: true });
  fs.mkdirSync(packages, { recursive: true });
  await installPackages(python, packages, support, onStatus);
}

async function ensurePackages(python, packages, support, onStatus) {
  const env = commandEnv(support, packages);
  const check = () =>
    canRun(python, ["-c", "import yt_dlp, numpy, demucs.separate, demucs.hf, huggingface_hub"], env);
  if (await check()) {
    return;
  }
  await onStatus("Installing tools. This download is large.\n");
  await installFresh(python, packages, support, onStatus);
  if (await check()) {
    return;
  }
  await onStatus("Installing tools again.\n");
  await installFresh(python, packages, support, onStatus);
  if (!(await check())) {
    throw new Error("The Python tools did not install.");
  }
}

function ensureModels(python, packages, support, onStatus) {
  return run(python, ["-c", ENSURE_MODELS], { cwd: support, env: commandEnv(support, packages) }, onStatus);
}

async function ensureMediaTools(support, onStatus) {
  for (const name of MEDIA_TOOLS) {
    const existing = toolPath(support, name);
    if (fs.existsSync(existing) && (await canRun(existing, ["-version"], process.env))) {
      continue;
    }
    await onStatus(`Downloading ${name}.\n`);
    const binary = await downloadTool(support, name, onStatus);
    if (!(await canRun(binary, ["-version"], process.env))) {
      throw new Error(`${name} did not run.`);
    }
  }
  return path.dirname(toolPath(support, "ffmpeg"));
}

async function prepare({ python, support, onStatus }) {
  fs.mkdirSync(support, { recursive: true });
  const packages = path.join(support, "python-packages");
  fs.mkdirSync(packages, { recursive: true });
  fs.mkdirSync(path.join(support, "cache", "huggingface"), { recursive: true });
  await onStatus("Checking installed tools.\n");
  await ensurePackages(python, packages, support, onStatus);
  await ensureModels(python, packages, support, onStatus);
  return ensureMediaTools(support, onStatus);
}

module.exports = { prepare, supportEnv, findFfmpeg, FFMPEG_ASSETS };

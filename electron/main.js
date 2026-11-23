const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { prepare } = require("./setup");

let server = null;
let port = 8765;

app.setName("Cloud Chaser");

function pythonBinary(binDir) {
  const python3 = path.join(binDir, "python3");
  if (fs.existsSync(python3)) {
    return python3;
  }
  return path.join(binDir, "python");
}

function runtimePaths() {
  if (app.isPackaged) {
    const resources = process.resourcesPath;
    return {
      python: pythonBinary(path.join(resources, "python", "bin")),
      appRoot: path.join(resources, "app"),
      webRoot: path.join(resources, "ui"),
      packaged: true,
    };
  }
  const root = path.resolve(__dirname, "..");
  return {
    python: path.join(root, ".venv", "bin", "python"),
    appRoot: root,
    webRoot: path.join(root, "frontend", "out"),
    packaged: false,
  };
}

function supportDir() {
  const home = process.env.HOME || "";
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cloud Chaser");
  }
  return path.join(app.getPath("appData"), "Cloud Chaser");
}

function stopServer() {
  if (server && !server.killed) {
    server.kill("SIGTERM");
  }
}

function choosePort(preferred) {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", () => {
      const fallback = http.createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const chosen = fallback.address().port;
        fallback.close(() => resolve(chosen));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => {
      probe.close(() => resolve(preferred));
    });
  });
}

function startServer(paths, support, ffmpegDir) {
  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  env.CLOUD_CHASER_WEB_ROOT = paths.webRoot;
  if (paths.packaged) {
    env.CLOUD_CHASER_JOBS = path.join(support, "jobs");
  }
  env.HF_HOME = path.join(support, "cache", "huggingface");
  env.TORCH_HOME = path.join(support, "cache", "torch");
  env.XDG_CACHE_HOME = path.join(support, "cache");
  env.PATH = [ffmpegDir, "/opt/homebrew/bin", "/usr/local/bin", env.PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);
  env.PYTHONPATH = [paths.appRoot, path.join(support, "python-packages")].join(path.delimiter);
  server = spawn(
    paths.python,
    [path.join(paths.appRoot, "cli.py"), "run", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: paths.appRoot, env }
  );
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return server;
}

function waitForServer(child) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error("The local server stopped."));
        return;
      }
      const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > 20000) {
          reject(new Error("The local server did not start."));
          return;
        }
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function showStatus(win, message) {
  const payload = JSON.stringify(String(message));
  return win.webContents.executeJavaScript(`document.querySelector("#status").textContent = ${payload}`);
}

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", stopServer);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Cloud Chaser",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, "setup.html"));
  try {
    const paths = runtimePaths();
    if (!fs.existsSync(paths.python)) {
      throw new Error("The Python runtime is missing.");
    }
    if (!fs.existsSync(path.join(paths.webRoot, "index.html"))) {
      throw new Error("The app page is missing. Export the frontend first.");
    }
    const support = supportDir();
    const ffmpegDir = await prepare({
      python: paths.python,
      appRoot: paths.appRoot,
      support,
      onStatus: (message) => showStatus(win, message),
    });
    port = await choosePort(8765);
    const child = startServer(paths, support, ffmpegDir);
    await showStatus(win, "Starting Cloud Chaser.");
    await waitForServer(child);
    await win.loadURL(`http://127.0.0.1:${port}/`);
  } catch (error) {
    await showStatus(win, error instanceof Error ? error.message : String(error));
  }
});

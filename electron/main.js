const { app, BrowserWindow, ipcMain, nativeImage, screen, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { prepare } = require("./setup");

const FIT_CSS = [
  "html, body { margin: 0 !important; padding: 0 !important; min-height: 0 !important; height: 100% !important; background: #0080ff !important; overflow-x: hidden !important; overflow-y: auto !important; }",
  "main { width: 40rem !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }",
  "#form { margin: 0 !important; }",
].join("");

const FIT_PAGE = `(() => {
  if (window.__cloudChaserFit) {
    return;
  }
  window.__cloudChaserFit = true;
  const report = () => {
    const form = document.querySelector("#form");
    if (!form || !window.cloudChaser) {
      return;
    }
    const formBox = form.getBoundingClientRect();
    let right = formBox.right;
    let bottom = formBox.bottom;
    const result = document.querySelector("#result");
    if (result && !result.hidden) {
      const resultBox = result.getBoundingClientRect();
      right = Math.max(right, resultBox.right);
      bottom = Math.max(bottom, resultBox.bottom);
    }
    const sites = document.querySelector(".sites");
    if (sites) {
      const sitesBox = sites.getBoundingClientRect();
      right = Math.max(right, sitesBox.right);
      bottom = Math.max(bottom, sitesBox.bottom);
    }
    const rights = document.querySelector(".rights");
    if (rights) {
      const rightsBox = rights.getBoundingClientRect();
      right = Math.max(right, rightsBox.right);
      bottom = Math.max(bottom, rightsBox.bottom);
    }
    window.cloudChaser.setContentSize(right, bottom);
  };
  const watch = new ResizeObserver(report);
  const form = document.querySelector("#form");
  const result = document.querySelector("#result");
  const sites = document.querySelector(".sites");
  const rights = document.querySelector(".rights");
  if (form) {
    watch.observe(form);
  }
  if (result) {
    watch.observe(result);
    new MutationObserver(report).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }
  if (sites) {
    watch.observe(sites);
  }
  if (rights) {
    watch.observe(rights);
  }
  report();
})()`;

let server = null;
let port = 8765;
let win = null;
let lockedWidth = null;
let lockTimer = null;

function lockVerticalResize() {
  if (!win || lockedWidth != null) {
    return;
  }
  const bounds = win.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  if (bounds.height > workArea.height) {
    win.setBounds({ ...bounds, height: workArea.height, y: workArea.y });
  }
  const locked = win.getBounds();
  lockedWidth = locked.width;
  win.setMinimumSize(locked.width, 240);
  win.setMaximumSize(locked.width, workArea.height);
  win.setResizable(true);
}

function scheduleLock() {
  if (lockedWidth != null) {
    return;
  }
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockVerticalResize, 500);
}

ipcMain.on("content-size", (_event, size) => {
  if (!win || !size || lockedWidth != null) {
    return;
  }
  const width = Math.ceil(Number(size.width));
  const height = Math.ceil(Number(size.height));
  if (width < 200 || height < 80) {
    return;
  }
  const [currentWidth, currentHeight] = win.getContentSize();
  if (currentWidth !== width || currentHeight !== height) {
    win.setContentSize(width, height);
  }
  const url = win.webContents.getURL();
  if (url.startsWith("http://127.0.0.1:")) {
    scheduleLock();
  }
});

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

let logChain = Promise.resolve();
let logBuffer = "";
let setupReady = false;

function appendLog(target, chunk) {
  const text = String(chunk);
  if (!setupReady) {
    logBuffer += text;
    return Promise.resolve();
  }
  const payload = JSON.stringify(text);
  logChain = logChain
    .then(() => target.webContents.executeJavaScript(`window.cloudChaserWriteLog(${payload})`))
    .catch(() => {});
  return logChain;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSetup() {
  return new Promise((resolve, reject) => {
    const onLoad = () => resolve();
    win.webContents.once("did-finish-load", onLoad);
    win.loadFile(path.join(__dirname, "setup.html")).catch((error) => {
      win.webContents.removeListener("did-finish-load", onLoad);
      reject(error);
    });
  });
}

async function revealSetup() {
  await loadSetup();
  const buffered = logBuffer;
  logBuffer = "";
  if (buffered) {
    const payload = JSON.stringify(buffered);
    logChain = win.webContents
      .executeJavaScript(`(() => {
        const log = document.querySelector("#log");
        const raw = ${payload};
        log.dataset.buffer = raw;
        log.textContent = raw.split("\\n").map((line) => line.split("\\r").pop()).join("\\n");
        log.scrollTop = log.scrollHeight;
      })()`)
      .catch(() => {});
  }
  setupReady = true;
  if (buffered) {
    await logChain;
  }
}

async function bootApp() {
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
      onStatus: (message) => appendLog(win, message),
    });
    port = await choosePort(8765);
    const child = startServer(paths, support, ffmpegDir);
    appendLog(win, "\nStarting Cloud Chaser.\n");
    await waitForServer(child);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", stopServer);

app.whenReady().then(async () => {
  const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (process.platform === "darwin" && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
  win = new BrowserWindow({
    width: 640,
    height: 754,
    useContentSize: true,
    resizable: false,
    title: "Cloud Chaser",
    icon,
    backgroundColor: "#0080ff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on("will-resize", (event, newBounds) => {
    if (lockedWidth == null) {
      return;
    }
    if (newBounds.width === lockedWidth) {
      return;
    }
    event.preventDefault();
    win.setBounds({
      x: newBounds.x,
      y: newBounds.y,
      width: lockedWidth,
      height: newBounds.height,
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("file://")) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });
  let fitted = false;
  win.webContents.on("did-finish-load", () => {
    const url = win.webContents.getURL();
    if (fitted || !url.startsWith("http://127.0.0.1:")) {
      return;
    }
    fitted = true;
    win.webContents
      .insertCSS(FIT_CSS)
      .then(() => win.webContents.executeJavaScript(FIT_PAGE))
      .catch(() => {});
  });
  await win.loadFile(path.join(__dirname, "splash.html"));
  let bootResult;
  const boot = bootApp().then((error) => {
    bootResult = error;
  });
  await delay(5000);
  if (bootResult === null) {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    return;
  }
  await revealSetup();
  if (bootResult === undefined) {
    await boot;
  }
  if (bootResult) {
    await appendLog(win, `\n${bootResult.message}\n`);
    return;
  }
  await win.loadURL(`http://127.0.0.1:${port}/`);
});

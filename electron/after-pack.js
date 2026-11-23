const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function filesIn(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesIn(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

function isMachO(file) {
  try {
    const kind = execFileSync("file", ["-b", file], { encoding: "utf8" });
    return kind.includes("Mach-O");
  } catch {
    return false;
  }
}

function removeSignature(file) {
  try {
    execFileSync("codesign", ["--remove-signature", file], { stdio: "pipe" });
  } catch (error) {
    const detail = `${error.stderr || ""}${error.stdout || ""}`;
    if (detail.includes("code object is not signed")) {
      return;
    }
    throw error;
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  for (const file of filesIn(appPath)) {
    if (isMachO(file)) {
      removeSignature(file);
    }
  }
};

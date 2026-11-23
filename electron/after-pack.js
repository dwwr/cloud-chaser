const { execFileSync } = require("child_process");
const path = require("path");
const osxSign = require("@electron/osx-sign");

const signAsync = osxSign.signAsync || osxSign.signApp;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlements = path.join(__dirname, "entitlements.mac.plist");
  await signAsync({
    app: appPath,
    identity: "-",
    identityValidation: false,
    platform: "darwin",
    optionsForFile() {
      return {
        entitlements,
        hardenedRuntime: true,
      };
    },
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
};

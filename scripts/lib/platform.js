"use strict";

const os = require("node:os");
const path = require("node:path");

const WINDOWS_CLI = "C:\\Program Files (x86)\\Tencent\\WechatTool\\cli.bat";
const MAC_CLI_CANDIDATES = [
  "/Applications/wechatwebdevtools.app/Contents/MacOS/cli",
  "/Applications/微信开发者工具.app/Contents/MacOS/cli",
];

function resolvePlatform(value = process.platform) {
  if (value !== "win32" && value !== "darwin") {
    throw new Error(`Unsupported platform: ${value}. Supported platforms are win32 and darwin.`);
  }
  return value;
}

function pathApi(platform) {
  return resolvePlatform(platform) === "win32" ? path.win32 : path.posix;
}

function defaultWechatCliCandidates(platform = process.platform) {
  return resolvePlatform(platform) === "win32" ? [WINDOWS_CLI] : [...MAC_CLI_CANDIDATES];
}

function defaultIdeStateRoots(platform = process.platform, env = process.env) {
  const targetPlatform = resolvePlatform(platform);
  const targetPath = pathApi(targetPlatform);
  if (targetPlatform === "win32") {
    return env.LOCALAPPDATA
      ? [targetPath.join(env.LOCALAPPDATA, "微信开发者工具", "User Data")]
      : [];
  }
  const home = env.HOME || os.homedir();
  return [
    targetPath.join(home, "Library", "Application Support", "微信开发者工具"),
    targetPath.join(home, "Library", "Application Support", "wechatwebdevtools"),
  ];
}

function buildCliInvocation(cliPath, cliArgs, platform = process.platform) {
  if (resolvePlatform(platform) === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "call", cliPath, ...cliArgs],
    };
  }
  return { command: cliPath, args: [...cliArgs] };
}

function ideExecutableCandidates(cliPath, platform = process.platform) {
  const targetPlatform = resolvePlatform(platform);
  const targetPath = pathApi(targetPlatform);
  const installDir = targetPath.dirname(cliPath);
  if (targetPlatform === "win32") {
    return [
      targetPath.join(installDir, "微信开发者工具.exe"),
      targetPath.join(installDir, "wechatdevtools.exe"),
    ];
  }
  return [
    targetPath.join(installDir, "wechatwebdevtools"),
    targetPath.join(installDir, "微信开发者工具"),
  ];
}

function stopIdeCommands(platform = process.platform) {
  if (resolvePlatform(platform) === "win32") {
    return [
      { command: "taskkill.exe", args: ["/F", "/IM", "微信开发者工具.exe"] },
      { command: "taskkill.exe", args: ["/F", "/IM", "wechatdevtools.exe"] },
    ];
  }
  return [
    { command: "pkill", args: ["-x", "wechatwebdevtools"] },
    { command: "pkill", args: ["-x", "微信开发者工具"] },
  ];
}

module.exports = {
  buildCliInvocation,
  defaultIdeStateRoots,
  defaultWechatCliCandidates,
  ideExecutableCandidates,
  resolvePlatform,
  stopIdeCommands,
};

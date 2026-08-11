#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { PIPE_NAME, STATE_FILE, getRuntimePaths, normalizeInstanceName } = require("./lib/constants");
const { isRetryableAutoError, resolveLaunchConfig } = require("./lib/launcher");

const root = path.resolve(__dirname, "..");
const targets = ["scripts", "tests"];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }
}

for (const target of targets) {
  const targetPath = path.join(root, target);
  if (fs.existsSync(targetPath)) {
    walk(targetPath);
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const defaultRuntime = getRuntimePaths();
const secondRuntime = getRuntimePaths("app-b");
assert.equal(defaultRuntime.pipeName, PIPE_NAME);
assert.equal(defaultRuntime.stateFile, STATE_FILE);
assert.notEqual(secondRuntime.pipeName, defaultRuntime.pipeName);
assert.notEqual(secondRuntime.stateFile, defaultRuntime.stateFile);
assert.equal(normalizeInstanceName("shop_2"), "shop_2");
assert.throws(() => normalizeInstanceName("bad instance"), /instance must contain/);
const previousMultiOpen = process.env.WEAPP_MULTI_OPEN;
const previousAutoPort = process.env.WEAPP_AUTO_PORT;
delete process.env.WEAPP_MULTI_OPEN;
delete process.env.WEAPP_AUTO_PORT;
assert.equal(resolveLaunchConfig({}).multiOpen, false);
assert.equal(resolveLaunchConfig({}).autoPort, 9420);
if (previousMultiOpen === undefined) {
  delete process.env.WEAPP_MULTI_OPEN;
} else {
  process.env.WEAPP_MULTI_OPEN = previousMultiOpen;
}
if (previousAutoPort === undefined) {
  delete process.env.WEAPP_AUTO_PORT;
} else {
  process.env.WEAPP_AUTO_PORT = previousAutoPort;
}
assert.equal(
  isRetryableAutoError(new Error("#initialize-error: wait IDE port timeout")),
  true
);
assert.equal(isRetryableAutoError(new Error("Command timed out after 120000ms.")), true);
assert.equal(isRetryableAutoError(new Error("Project path was not resolved.")), false);

console.log(JSON.stringify({ ok: true, checked: files.length }));

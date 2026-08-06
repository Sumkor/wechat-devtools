"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const SKILL_ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(os.tmpdir(), "weapp-auto");
const ROOT_HASH = crypto.createHash("sha1").update(SKILL_ROOT).digest("hex").slice(0, 8);
const DEFAULT_INSTANCE = "default";
const DEFAULT_AUTOMATOR_PORT = 9420;
const DEFAULT_CDP_PORT = 9222;

function normalizeInstanceName(value) {
  const instance = String(value || DEFAULT_INSTANCE).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(instance)) {
    throw new Error("instance must contain only letters, digits, hyphen, or underscore (max 64 characters).");
  }
  return instance;
}

function getRuntimePaths(value, platform = process.platform) {
  const instance = normalizeInstanceName(value);
  const suffix = instance === DEFAULT_INSTANCE
    ? ROOT_HASH
    : `${ROOT_HASH}-${crypto.createHash("sha1").update(instance).digest("hex").slice(0, 8)}`;
  return {
    instance,
    pipeName: platform === "win32"
      ? `\\\\.\\pipe\\weapp-auto-${suffix}`
      : path.posix.join(STATE_DIR.replace(/\\/g, "/"), `weapp-auto-${suffix}.sock`),
    stateFile: path.join(STATE_DIR, `daemon-state-${suffix}.json`),
  };
}

const { pipeName: PIPE_NAME, stateFile: STATE_FILE } = getRuntimePaths(DEFAULT_INSTANCE);

module.exports = {
  DEFAULT_AUTOMATOR_PORT,
  DEFAULT_CDP_PORT,
  DEFAULT_INSTANCE,
  PIPE_NAME,
  SKILL_ROOT,
  STATE_DIR,
  STATE_FILE,
  getRuntimePaths,
  normalizeInstanceName,
};

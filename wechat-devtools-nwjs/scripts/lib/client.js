"use strict";

const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getRuntimePaths, SKILL_ROOT } = require("./constants");
const { attachNdjsonReader, writeNdjson } = require("./protocol");

async function sendRequest(method, params = {}, options = {}) {
  const runtime = getRuntimePaths(options.instance);
  if (options.autoStart !== false) {
    await ensureDaemon(runtime.instance);
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(runtime.pipeName);
    socket.once("error", reject);
    attachNdjsonReader(socket, (message) => {
      socket.destroy();
      if (!message.ok) {
        const error = new Error(message.error?.message || "Daemon request failed.");
        error.details = message.error;
        error.assertion = message.assertion;
        reject(error);
        return;
      }
      resolve(message.result);
    });
    socket.once("connect", () => {
      writeNdjson(socket, {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        method,
        params,
      });
    });
  });
}

async function ensureDaemon(instance) {
  try {
    await sendPing(instance);
    return;
  } catch {
    startDaemonProcess(instance);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await sendPing(instance);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Timed out waiting for weapp-auto daemon to start.");
}

function startDaemonProcess(instance) {
  const child = spawn(process.execPath, [path.join(SKILL_ROOT, "scripts", "daemon.js"), "--instance", instance], {
    cwd: SKILL_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function sendPing(instance) {
  const runtime = getRuntimePaths(instance);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(runtime.pipeName);
    socket.once("error", reject);
    attachNdjsonReader(socket, (message) => {
      socket.destroy();
      if (!message.ok) {
        reject(new Error(message.error?.message || "Daemon ping failed."));
        return;
      }
      resolve(message.result);
    });
    socket.once("connect", () => {
      writeNdjson(socket, { id: "ping", method: "ping", params: {} });
    });
  });
}

module.exports = {
  ensureDaemon,
  sendRequest,
};

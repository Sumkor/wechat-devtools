#!/usr/bin/env node
"use strict";

const { DaemonServer } = require("./lib/daemon-server");
const { SessionController } = require("./lib/session-controller");

async function main() {
  const instanceIndex = process.argv.indexOf("--instance");
  const instance = instanceIndex >= 0 ? process.argv[instanceIndex + 1] : undefined;
  const controller = new SessionController({ instance });
  const daemon = new DaemonServer(controller, { instance });
  await daemon.start();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});

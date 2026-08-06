"use strict";

const fs = require("node:fs");
const net = require("node:net");
const { getRuntimePaths } = require("./constants");
const { attachNdjsonReader, writeNdjson } = require("./protocol");
const { clearState, writeState } = require("./state");
const { safeError } = require("./utils");

class DaemonServer {
  constructor(controller, options = {}) {
    this.controller = controller;
    this.runtime = getRuntimePaths(options.instance);
    this.queue = Promise.resolve();
    this.server = null;
  }

  async start() {
    await this.tryCleanupOldPipe();
    await new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleSocket(socket));
      this.server.once("error", reject);
      this.server.listen(this.runtime.pipeName, () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    writeState({
      pid: process.pid,
      instance: this.runtime.instance,
      pipeName: this.runtime.pipeName,
      startedAt: new Date().toISOString(),
    }, this.runtime.instance);
  }

  async close() {
    clearState(this.runtime.instance);
    if (!this.server) {
      return;
    }
    await new Promise((resolve) => this.server.close(resolve));
    if (process.platform !== "win32") {
      try {
        fs.unlinkSync(this.runtime.pipeName);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  handleSocket(socket) {
    attachNdjsonReader(socket, (message) => {
      const execute = async () => {
        const response = await this.dispatch(message);
        writeNdjson(socket, response);
        socket.end();
      };
      if (["ping", "status", "cancelSessionStart"].includes(message.method)) {
        execute();
        return;
      }
      this.queue = this.queue.then(execute);
    });
  }

  async dispatch(message) {
    const id = message.id ?? null;
    try {
      if (message.method === "ping") {
        return { id, ok: true, result: { pid: process.pid } };
      }
      if (message.method === "shutdown") {
        const result = await this.controller.stop();
        setTimeout(() => {
          this.close().finally(() => process.exit(0));
        }, 50).unref?.();
        return { id, ok: true, result };
      }
      if (typeof this.controller[message.method] !== "function") {
        throw new Error(`Unknown daemon method: ${message.method}`);
      }
      const result = await this.controller[message.method](message.params || {});
      return { id, ok: true, result };
    } catch (error) {
      return {
        id,
        ok: false,
        error: safeError(error),
        assertion: error && error.assertion ? error.assertion : null,
      };
    }
  }

  async tryCleanupOldPipe() {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(this.runtime.pipeName);
        socket.once("connect", () => {
          socket.destroy();
          reject(new Error("Daemon is already running."));
        });
        socket.once("error", () => {
          if (process.platform !== "win32") {
            try {
              fs.unlinkSync(this.runtime.pipeName);
            } catch (error) {
              if (error.code !== "ENOENT") {
                reject(error);
                return;
              }
            }
          }
          resolve();
        });
      });
    } catch (error) {
      throw error;
    }
  }
}

module.exports = {
  DaemonServer,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(targetPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, targetPath);
}

async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 200;
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt <= timeoutMs) {
    if (options.signal?.aborted) {
      throw options.signal.reason || new Error("Operation cancelled.");
    }
    lastValue = await predicate();
    if (lastValue) {
      return { ok: true, value: lastValue, elapsedMs: Date.now() - startedAt };
    }
    await sleep(intervalMs);
  }
  return { ok: false, value: lastValue, elapsedMs: Date.now() - startedAt };
}

function safeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}

function parseJsonInput(input, flagName) {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`${flagName} must be valid JSON: ${error.message}`);
  }
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getByPath(input, dottedPath) {
  if (!dottedPath) {
    return input;
  }
  const segments = dottedPath.split(".").filter(Boolean);
  let cursor = input;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

module.exports = {
  deepEqualJson,
  ensureDir,
  fileExists,
  getByPath,
  parseJsonInput,
  readJson,
  safeError,
  sleep,
  waitFor,
  writeJsonAtomic,
};

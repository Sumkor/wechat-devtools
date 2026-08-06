"use strict";

const fs = require("node:fs");
const { getRuntimePaths } = require("./constants");
const { readJson, writeJsonAtomic } = require("./utils");

function readState(instance) {
  return readJson(getRuntimePaths(instance).stateFile, null);
}

function writeState(nextState, instance) {
  writeJsonAtomic(getRuntimePaths(instance).stateFile, nextState);
}

function clearState(instance) {
  const { stateFile } = getRuntimePaths(instance);
  try {
    fs.unlinkSync(stateFile);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

module.exports = {
  clearState,
  readState,
  writeState,
};

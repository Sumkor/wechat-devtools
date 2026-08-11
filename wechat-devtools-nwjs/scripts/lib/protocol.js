"use strict";

function attachNdjsonReader(stream, onMessage) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      onMessage(JSON.parse(line));
    }
  });
}

function writeNdjson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

module.exports = {
  attachNdjsonReader,
  writeNdjson,
};

"use strict";

const WebSocket = require("ws");
const { getCdpTargets } = require("./launcher");
const { getByPath, waitFor } = require("./utils");

const SENSITIVE_HEADER_PATTERN = /(authorization|cookie|token|secret|api[-_]?key|share[-_]?code)/i;

class CdpNetworkMonitor {
  constructor(options = {}) {
    this.maxEntries = Number(options.maxEntries || 500);
    this.port = null;
    this.entries = [];
    this.entriesById = new Map();
    this.connections = new Map();
    this.discoveryTimer = null;
  }

  async start(port) {
    if (this.port === port && this.discoveryTimer) {
      return this.status();
    }
    await this.stop();
    this.port = Number(port);
    await this.discover();
    this.discoveryTimer = setInterval(() => this.discover().catch(() => {}), 1000);
    this.discoveryTimer.unref?.();
    return this.status();
  }

  async stop() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    this.discoveryTimer = null;
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.port = null;
  }

  status() {
    return {
      enabled: Boolean(this.port),
      cdpPort: this.port,
      targets: [...this.connections.values()].map((connection) => connection.summary()),
      requestCount: this.entries.length,
    };
  }

  clear() {
    this.entries = [];
    this.entriesById.clear();
    return { ok: true, cleared: true, clearedAt: new Date().toISOString() };
  }

  list(options = {}) {
    const url = String(options.url || "").toLowerCase();
    const method = String(options.method || "").toUpperCase();
    const type = String(options.type || "").toLowerCase();
    const status = options.status === undefined ? null : Number(options.status);
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
    const filtered = this.entries.filter((entry) => {
      return (
        (!url || entry.url.toLowerCase().includes(url)) &&
        (!method || entry.method === method) &&
        (!type || String(entry.type || "").toLowerCase() === type) &&
        (status === null || entry.status === status)
      );
    });
    const items = filtered.slice(-limit).reverse().map(summarizeEntry);
    return { ok: true, matched: filtered.length, returned: items.length, items };
  }

  async wait(options = {}) {
    const startedAt = Date.now();
    const result = await waitFor(() => {
      const listed = this.list({ ...options, limit: 1 });
      return listed.items[0] || null;
    }, {
      timeoutMs: Number(options.timeoutMs || 10000),
      intervalMs: Number(options.intervalMs || 200),
    });
    return {
      ok: result.ok,
      elapsedMs: Date.now() - startedAt,
      request: result.value || null,
    };
  }

  async body(options = {}) {
    const id = requireString(options.id, "id");
    const entry = this.entriesById.get(id);
    if (!entry) {
      throw new Error(`Network request not found: ${id}`);
    }
    const connection = this.connections.get(entry.targetId);
    if (!connection) {
      throw new Error(`CDP target is no longer connected for request: ${id}`);
    }
    const response = await connection.send("Network.getResponseBody", { requestId: entry.requestId });
    const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes || 200000), 2000000));
    const body = String(response.body || "");
    const byteLength = Buffer.byteLength(body, "utf8");
    if (options.jsonPath) {
      if (response.base64Encoded) {
        throw new Error("--json-path is not supported for base64-encoded responses.");
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new Error(`Response body is not valid JSON: ${error.message}`);
      }
      return {
        ok: true,
        id,
        jsonPath: options.jsonPath,
        value: getByPath(parsed, options.jsonPath),
        byteLength,
      };
    }
    return {
      ok: true,
      id,
      base64Encoded: Boolean(response.base64Encoded),
      byteLength,
      truncated: byteLength > maxBytes,
      body: byteLength > maxBytes ? Buffer.from(body).subarray(0, maxBytes).toString("utf8") : body,
    };
  }

  detail(options = {}) {
    const id = requireString(options.id, "id");
    const entry = this.entriesById.get(id);
    if (!entry) {
      throw new Error(`Network request not found: ${id}`);
    }
    return {
      ok: true,
      ...summarizeEntry(entry),
      targetUrl: entry.targetUrl,
      requestHeaders: entry.requestHeaders,
      postData: entry.postData,
      responseHeaders: entry.responseHeaders,
      finishedAt: entry.finishedAt || null,
    };
  }

  async discover() {
    if (!this.port) {
      return;
    }
    const targets = await getCdpTargets(this.port);
    for (const target of targets) {
      if (!isCandidateTarget(target) || this.connections.has(target.id)) {
        continue;
      }
      const connection = new CdpConnection(target, (message) => this.onEvent(target, message));
      this.connections.set(target.id, connection);
      connection.onClose = () => this.connections.delete(target.id);
      try {
        await connection.open();
        await connection.send("Network.enable", {
          maxTotalBufferSize: 10000000,
          maxResourceBufferSize: 2000000,
          maxPostDataSize: 200000,
        });
      } catch {
        connection.close();
      }
    }
  }

  onEvent(target, message) {
    const params = message.params || {};
    if (message.method === "Network.requestWillBeSent") {
      const request = params.request || {};
      if (isInternalUrl(request.url)) {
        return;
      }
      const id = `${target.id}:${params.requestId}`;
      const entry = {
        id,
        targetId: target.id,
        targetType: target.type || null,
        targetUrl: target.url || null,
        requestId: params.requestId,
        timestamp: new Date().toISOString(),
        method: request.method || null,
        url: request.url || "",
        requestHeaders: redactHeaders(request.headers),
        postData: limitText(request.postData, 20000),
        type: params.type || null,
        status: null,
        mimeType: null,
        responseHeaders: null,
        failed: null,
      };
      this.entries.push(entry);
      this.entriesById.set(id, entry);
      while (this.entries.length > this.maxEntries) {
        const removed = this.entries.shift();
        this.entriesById.delete(removed.id);
      }
      return;
    }
    const id = `${target.id}:${params.requestId}`;
    const entry = this.entriesById.get(id);
    if (!entry) {
      return;
    }
    if (message.method === "Network.responseReceived") {
      entry.status = params.response?.status ?? null;
      entry.mimeType = params.response?.mimeType ?? null;
      entry.responseHeaders = redactHeaders(params.response?.headers);
      entry.type = params.type || entry.type;
    } else if (message.method === "Network.loadingFailed") {
      entry.failed = params.errorText || "loadingFailed";
    } else if (message.method === "Network.loadingFinished") {
      entry.encodedDataLength = params.encodedDataLength ?? null;
      entry.finishedAt = new Date().toISOString();
    }
  }
}

class CdpConnection {
  constructor(target, onEvent) {
    this.target = target;
    this.onEvent = onEvent;
    this.onClose = null;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.target.webSocketDebuggerUrl);
      this.socket = socket;
      socket.once("open", resolve);
      socket.once("error", reject);
      socket.on("message", (data) => this.handleMessage(data));
      socket.on("close", () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error("CDP target connection closed."));
        }
        this.pending.clear();
        this.onClose?.();
      });
    });
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP target is not connected."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP command failed."));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    this.onEvent(message);
  }

  close() {
    try {
      this.socket?.close();
    } catch {}
  }

  summary() {
    return {
      id: this.target.id,
      type: this.target.type || null,
      title: this.target.title || null,
      url: this.target.url || null,
    };
  }
}

function isCandidateTarget(target) {
  const url = String(target.url || "");
  if (url.startsWith("devtools://") || url.startsWith("chrome-extension://")) {
    return false;
  }
  return ["page", "webview", "worker", "service_worker", "other"].includes(target.type);
}

function isInternalUrl(urlValue) {
  const url = String(urlValue || "");
  if (/^(data|blob|devtools|chrome-extension):/i.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function redactHeaders(headers = {}) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    output[name] = SENSITIVE_HEADER_PATTERN.test(name) ? "[REDACTED]" : value;
  }
  return output;
}

function limitText(value, maxLength) {
  if (typeof value !== "string") {
    return value ?? null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function summarizeEntry(entry) {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    type: entry.type,
    mimeType: entry.mimeType,
    encodedDataLength: entry.encodedDataLength ?? null,
    failed: entry.failed,
    targetType: entry.targetType,
  };
}

function requireString(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

module.exports = {
  CdpNetworkMonitor,
  isCandidateTarget,
  redactHeaders,
};

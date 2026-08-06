"use strict";

const { DEFAULT_AUTOMATOR_PORT, normalizeInstanceName } = require("./constants");
const { CdpNetworkMonitor } = require("./cdp-network-monitor");
const { loadAutomator } = require("./automator");
const launcherModule = require("./launcher");
const { deepEqualJson, getByPath, sleep, waitFor } = require("./utils");

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function connectAutomatorWithRetry(automator, wsEndpoint, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const intervalMs = Number(options.intervalMs || 500);
  const attemptTimeoutMs = Number(options.attemptTimeoutMs || 10000);
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      throw options.signal.reason || new Error("Session start cancelled.");
    }
    attempts += 1;
    let miniProgram = null;
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    try {
      miniProgram = await withTimeout(
        automator.connect({ wsEndpoint }),
        Math.min(attemptTimeoutMs, remainingMs),
        "Automator connect"
      );

      while (Date.now() - startedAt < timeoutMs) {
        if (options.signal?.aborted) {
          throw options.signal.reason || new Error("Session start cancelled.");
        }
        try {
          const currentPage = await withTimeout(
            miniProgram.currentPage(),
            Math.min(5000, Math.max(1, timeoutMs - (Date.now() - startedAt))),
            "Automator currentPage"
          );
          if (currentPage) {
            return { attempts, currentPage, miniProgram };
          }
        } catch (error) {
          lastError = error;
          break;
        }
        await sleep(Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
      }
    } catch (error) {
      lastError = error;
    }

    if (miniProgram) {
      try {
        miniProgram.disconnect();
      } catch {
        // Best-effort cleanup before reconnecting.
      }
    }
    await sleep(Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }

  const detail = lastError ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Automator did not expose a ready current page within ${timeoutMs}ms.${detail}`);
}

class SessionController {
  constructor(options = {}) {
    this.instance = normalizeInstanceName(options.instance);
    this.automator = options.automator || loadAutomator();
    this.launcher = options.launcher || launcherModule;
    this.networkMonitor = options.networkMonitor || new CdpNetworkMonitor();
    this.miniProgram = null;
    this.sessionInfo = null;
    this.launchInfo = null;
    this.startAbortController = null;
  }

  async status() {
    const currentPage = await this.safeCurrentPage();
    return {
      instance: this.instance,
      connected: Boolean(this.miniProgram),
      currentPage: currentPage ? summarizePage(currentPage) : null,
      launchInfo: this.launchInfo,
      sessionInfo: this.sessionInfo,
      network: this.networkMonitor.status(),
      sessionStartInProgress: Boolean(this.startAbortController),
    };
  }

  cancelSessionStart() {
    if (!this.startAbortController) {
      return { cancelled: false, reason: "No session start is in progress." };
    }
    this.startAbortController.abort(new Error("Session start cancelled by caller."));
    return { cancelled: true };
  }

  async stop() {
    if (this.miniProgram) {
      try {
        this.miniProgram.disconnect();
      } catch {
        // Best-effort cleanup.
      }
    }
    this.miniProgram = null;
    this.sessionInfo = null;
    this.launchInfo = null;
    await this.networkMonitor.stop();
    return { stopped: true };
  }

  async ensureSession(options = {}) {
    if (this.startAbortController) {
      throw new Error("A session start is already in progress. Use session status or session cancel.");
    }
    const controller = new AbortController();
    this.startAbortController = controller;
    try {
      return await this._ensureSession({ ...options, signal: controller.signal });
    } finally {
      if (this.startAbortController === controller) {
        this.startAbortController = null;
      }
    }
  }

  async _ensureSession(options = {}) {
    const launchConfig = this.launcher.resolveLaunchConfig(options);
    if (!launchConfig.autoPort) {
      launchConfig.autoPort = DEFAULT_AUTOMATOR_PORT;
    }
    if (launchConfig.cdpEnabled) {
      launchConfig.cdpPort = await this.launcher.resolveCdpPort(launchConfig.cdpPort, {
        allowFallback: !launchConfig.cdpPortExplicit,
        preferExisting: launchConfig.multiOpen,
      });
    }
    const wsEndpoint = `ws://127.0.0.1:${launchConfig.autoPort}`;
    const sameSession =
      this.sessionInfo &&
      this.sessionInfo.wsEndpoint === wsEndpoint &&
      this.sessionInfo.projectPath === launchConfig.projectPath;

    if (sameSession && (await this.isAlive())) {
      if (launchConfig.cdpEnabled) {
        await this.ensureCdp(launchConfig, options);
      }
      return this.status();
    }

    if (this.miniProgram) {
      await this.stop();
    }

    if (launchConfig.cdpEnabled) {
      await this.ensureCdp(launchConfig, options);
    }

    if (!(await this.launcher.isPortListening(launchConfig.autoPort))) {
      const cdpLaunch = this.launchInfo?.cdp?.launch || null;
      const launchResult = await this.launcher.launchDevtools(launchConfig, {
        timeoutMs: Number(options.timeoutMs || 60000),
        signal: options.signal,
      });
      const readiness = await this.launcher.waitForPort(launchConfig.autoPort, {
        timeoutMs: Number(options.timeoutMs || 30000),
        intervalMs: 500,
        signal: options.signal,
      });
      if (!readiness.ok) {
        throw new Error(
          `Automator port ${launchConfig.autoPort} did not become reachable. This port is the WeChat Automator WebSocket port, not the ordinary DevTools service port.`
        );
      }
      this.launchInfo = {
        ...(this.launchInfo || {}),
        ...launchResult,
        projectPath: launchConfig.projectPath,
        wechatCliPath: launchConfig.wechatCliPath,
        automatorPort: launchConfig.autoPort,
      };
    }

    const connection = await connectAutomatorWithRetry(this.automator, wsEndpoint, {
      timeoutMs: Number(options.timeoutMs || 120000),
      signal: options.signal,
    });
    this.miniProgram = connection.miniProgram;
    this.sessionInfo = {
      connectedAt: new Date().toISOString(),
      instance: this.instance,
      projectPath: launchConfig.projectPath,
      wsEndpoint,
      automatorPort: launchConfig.autoPort,
      cdpPort: launchConfig.cdpEnabled ? launchConfig.cdpPort : null,
      multiOpen: launchConfig.multiOpen,
      connectAttempts: connection.attempts,
    };
    return this.status();
  }

  async ensureCdp(launchConfig, options = {}) {
    const cdpStatus = await this.launcher.checkCdpEndpoint(launchConfig.cdpPort);
    let cdpLaunch = null;
    if (!cdpStatus.ok) {
      cdpLaunch = await this.launcher.launchDevtoolsWithCdp(launchConfig, {
        timeoutMs: Number(options.timeoutMs || 60000),
        signal: options.signal,
      });
      if (cdpLaunch.idePort) {
        launchConfig.idePort = cdpLaunch.idePort;
      }
      const readiness = await this.launcher.waitForCdp(launchConfig.cdpPort, {
        timeoutMs: Number(options.timeoutMs || 30000),
        intervalMs: 500,
        signal: options.signal,
      });
      if (!readiness.ok) {
        throw new Error(
          `CDP port ${launchConfig.cdpPort} did not expose a valid /json/list endpoint.`
        );
      }
    } else if (!launchConfig.idePort && this.launcher.resolveActiveIdePort) {
      launchConfig.idePort = await this.launcher.resolveActiveIdePort();
      if (!launchConfig.idePort && !(await this.launcher.isPortListening(launchConfig.autoPort))) {
        cdpLaunch = await this.launcher.launchDevtoolsWithCdp(launchConfig, {
          forceRestart: true,
          timeoutMs: Number(options.timeoutMs || 60000),
          signal: options.signal,
        });
        launchConfig.idePort = cdpLaunch.idePort;
        const readiness = await this.launcher.waitForCdp(launchConfig.cdpPort, {
          timeoutMs: Number(options.timeoutMs || 30000),
          intervalMs: 500,
          signal: options.signal,
        });
        if (!readiness.ok) {
          throw new Error(
            `CDP port ${launchConfig.cdpPort} did not recover after restarting the IDE with a missing HTTP service port.`
          );
        }
      }
    }
    const network = await this.networkMonitor.start(launchConfig.cdpPort);
    this.launchInfo = {
      ...(this.launchInfo || {}),
      cdp: {
        enabled: true,
        port: launchConfig.cdpPort,
        launch: cdpLaunch,
        network,
      },
    };
  }

  async networkStatus() {
    return this.networkMonitor.status();
  }

  async networkClear() {
    return this.networkMonitor.clear();
  }

  async networkList(options = {}) {
    return this.networkMonitor.list(options);
  }

  async networkWait(options = {}) {
    return this.networkMonitor.wait(options);
  }

  async networkBody(options = {}) {
    return this.networkMonitor.body(options);
  }

  async networkDetail(options = {}) {
    return this.networkMonitor.detail(options);
  }

  async pageCurrent(options = {}) {
    const page = await this.requireCurrentPage();
    const result = summarizePage(page);
    if (options.dataPath) {
      result.dataPath = options.dataPath;
      result.data = await page.data(options.dataPath);
    }
    return result;
  }

  async pageStack() {
    const stack = await this.requireMiniProgram().pageStack();
    return stack.map(summarizePage);
  }

  async pageData(options = {}) {
    const page = await this.requireCurrentPage();
    return {
      ok: true,
      path: options.path || null,
      value: await page.data(options.path),
    };
  }

  async pageSetData(options = {}) {
    const page = await this.requireCurrentPage();
    await page.setData(options.data);
    return { ok: true };
  }

  async pageCallMethod(options = {}) {
    const page = await this.requireCurrentPage();
    return {
      ok: true,
      value: await page.callMethod(options.method, ...(options.args || [])),
    };
  }

  async wxCall(options = {}) {
    return {
      ok: true,
      value: await this.requireMiniProgram().callWxMethod(options.method, ...(options.args || [])),
    };
  }

  async wxMock(options = {}) {
    await this.requireMiniProgram().mockWxMethod(options.method, options.result);
    return { ok: true };
  }

  async wxRestore(options = {}) {
    await this.requireMiniProgram().restoreWxMethod(options.method);
    return { ok: true };
  }

  async pageNavigate(options = {}) {
    const miniProgram = this.requireMiniProgram();
    const method = options.method || "navigateTo";
    if (!["navigateTo", "redirectTo", "reLaunch", "switchTab", "navigateBack"].includes(method)) {
      throw new Error(`Unsupported navigation method: ${method}`);
    }
    const page =
      method === "navigateBack"
        ? await miniProgram.navigateBack()
        : await miniProgram[method](options.url);
    return summarizePage(page);
  }

  async pageScreenshot(options = {}) {
    const miniProgram = this.requireMiniProgram();
    const result = options.path
      ? await miniProgram.screenshot({ path: options.path })
      : await miniProgram.screenshot();
    return { ok: true, value: result ?? null, path: options.path || null };
  }

  async pageWait(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 15000);
    const intervalMs = Number(options.intervalMs || 200);
    if (options.selector) {
      return this.waitForElement({ selector: options.selector, timeoutMs, intervalMs });
    }
    if (options.route) {
      return this.assertRoute({ expected: options.route, timeoutMs, intervalMs, failOnFalse: false });
    }
    throw new Error("page wait requires --selector or --route.");
  }

  async queryElement(options = {}) {
    const page = await this.requireCurrentPage();
    const element = await page.$(options.selector);
    return summarizeElement(element, options.selector, 0, options);
  }

  async queryElements(options = {}) {
    const page = await this.requireCurrentPage();
    const elements = await page.$$(options.selector);
    const limit = Math.max(1, Math.min(Number(options.limit || 20), 50));
    const sliced = elements.slice(0, limit);
    const items = [];
    for (let index = 0; index < sliced.length; index += 1) {
      items.push(await summarizeElement(sliced[index], options.selector, index, options));
    }
    return {
      ok: true,
      count: elements.length,
      returned: items.length,
      items,
    };
  }

  async tapElement(options = {}) {
    const element = await this.resolveElement(options);
    await element.tap();
    return this.buildTapResult(options);
  }

  async tapText(options = {}) {
    const page = await this.requireCurrentPage();
    const selectors = options.selector ? [options.selector] : ["text", "button", "view"];
    for (const selector of selectors) {
      const elements = await page.$$(selector);
      for (let index = 0; index < elements.length; index += 1) {
        const text = await safeElementCall(elements[index], "text", "");
        if (typeof text === "string" && text.includes(options.text)) {
          await elements[index].tap();
          return {
            ok: true,
            selector,
            index,
            matchedText: text,
            currentPage: summarizePage(await this.requireCurrentPage()),
          };
        }
      }
    }
    throw new Error(`No tappable element text matched "${options.text}".`);
  }

  async inputElement(options = {}) {
    const element = await this.resolveElement(options);
    await element.input(options.value);
    return { ok: true };
  }

  async elementCallMethod(options = {}) {
    const element = await this.resolveElement(options);
    return {
      ok: true,
      value: await element.callMethod(options.method, ...(options.args || [])),
    };
  }

  async elementData(options = {}) {
    const element = await this.resolveElement(options);
    return {
      ok: true,
      path: options.path || null,
      value: await element.data(options.path),
    };
  }

  async scrollViewTo(options = {}) {
    const element = await this.resolveElement(options);
    await element.scrollTo(Number(options.x || 0), Number(options.y || 0));
    return { ok: true, x: Number(options.x || 0), y: Number(options.y || 0) };
  }

  async swipe(options = {}) {
    const element = await this.resolveElement(options);
    const offset = await element.offset();
    const size = await element.size();
    const direction = options.direction || "up";
    const steps = Math.max(1, Math.min(Number(options.steps || 6), 20));
    const marginRatio = Number(options.marginRatio || 0.2);
    const xCenter = offset.left + size.width / 2;
    const yCenter = offset.top + size.height / 2;
    const xMin = offset.left + size.width * marginRatio;
    const xMax = offset.left + size.width * (1 - marginRatio);
    const yMin = offset.top + size.height * marginRatio;
    const yMax = offset.top + size.height * (1 - marginRatio);

    const vectors = {
      up: { start: [xCenter, yMax], end: [xCenter, yMin] },
      down: { start: [xCenter, yMin], end: [xCenter, yMax] },
      left: { start: [xMax, yCenter], end: [xMin, yCenter] },
      right: { start: [xMin, yCenter], end: [xMax, yCenter] },
    };
    const vector = vectors[direction];
    if (!vector) {
      throw new Error(`Unsupported direction: ${direction}`);
    }

    await touch(element, "touchstart", vector.start, vector.start);
    for (let index = 1; index <= steps; index += 1) {
      const point = [
        vector.start[0] + ((vector.end[0] - vector.start[0]) * index) / steps,
        vector.start[1] + ((vector.end[1] - vector.start[1]) * index) / steps,
      ];
      await touch(element, "touchmove", point, point);
    }
    await touch(element, "touchend", [], vector.end);
    return {
      ok: true,
      direction,
      start: vector.start,
      end: vector.end,
      steps,
    };
  }

  async assertVisible(options = {}) {
    const selector = requireString(options.selector, "selector");
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const waited = await waitFor(async () => {
      const page = await this.requireCurrentPage();
      const elements = await page.$$(selector);
      if (!elements.length) {
        return null;
      }
      return summarizeElement(elements[0], selector, 0, {});
    }, { timeoutMs, intervalMs });
    return assertionResult(waited.ok, "visible", selector, true, waited.value, waited.elapsedMs, options.failOnFalse);
  }

  async assertText(options = {}) {
    const selector = requireString(options.selector, "selector");
    const expected = requireString(options.expected, "expected");
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const mode = options.mode || "contains";
    const waited = await waitFor(async () => {
      const element = await this.resolveElement({ selector });
      const text = await safeElementCall(element, "text", "");
      if (mode === "equals" ? text === expected : String(text).includes(expected)) {
        return text;
      }
      return null;
    }, { timeoutMs, intervalMs });
    return assertionResult(waited.ok, "text", selector, expected, waited.value, waited.elapsedMs, options.failOnFalse);
  }

  async assertData(options = {}) {
    const page = await this.requireCurrentPage();
    const expected = options.expected;
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const waited = await waitFor(async () => {
      const value = await page.data(options.path);
      if (deepEqualJson(value, expected)) {
        return value;
      }
      return null;
    }, { timeoutMs, intervalMs });
    return assertionResult(waited.ok, "data", options.path || "", expected, waited.value, waited.elapsedMs, options.failOnFalse);
  }

  async assertRoute(options = {}) {
    const expected = requireString(options.expected, "expected");
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const waited = await waitFor(async () => {
      const page = await this.safeCurrentPage();
      if (page && page.path === expected) {
        return summarizePage(page);
      }
      return null;
    }, { timeoutMs, intervalMs });
    return assertionResult(waited.ok, "path", "currentPage.path", expected, waited.value, waited.elapsedMs, options.failOnFalse);
  }

  async capabilityList(options = {}) {
    const target = options.target || "miniProgram";
    const maps = {
      miniProgram: [
        "pageStack",
        "currentPage",
        "navigateTo",
        "redirectTo",
        "navigateBack",
        "reLaunch",
        "switchTab",
        "callWxMethod",
        "mockWxMethod",
        "restoreWxMethod",
        "pageScrollTo",
        "screenshot",
      ],
      page: ["$", "$$", "waitFor", "data", "setData", "size", "scrollTop", "callMethod"],
      element: [
        "text",
        "tap",
        "longpress",
        "touchstart",
        "touchmove",
        "touchend",
        "trigger",
        "input",
        "callMethod",
        "data",
        "setData",
        "scrollTo",
        "scrollHeight",
        "scrollWidth",
      ],
    };
    if (!maps[target]) {
      throw new Error(`Unknown capability target: ${target}`);
    }
    return { ok: true, target, methods: maps[target] };
  }

  async invoke(options = {}) {
    const target = options.target || "miniProgram";
    const method = requireSafeMethod(options.method);
    const args = Array.isArray(options.args) ? options.args : [];
    if (target === "miniProgram") {
      if (["evaluate", "disconnect"].includes(method)) {
        throw new Error(`miniProgram method is not allowed through invoke: ${method}`);
      }
      const miniProgram = this.requireMiniProgram();
      if (typeof miniProgram[method] !== "function") {
        throw new Error(`miniProgram method not found: ${method}`);
      }
      return { ok: true, value: await miniProgram[method](...args) };
    }
    if (target === "page") {
      const page = await this.requireCurrentPage();
      if (typeof page[method] !== "function") {
        throw new Error(`page method not found: ${method}`);
      }
      return { ok: true, value: await page[method](...args) };
    }
    if (target === "element") {
      const element = await this.resolveElement(options);
      if (typeof element[method] !== "function") {
        throw new Error(`element method not found: ${method}`);
      }
      return { ok: true, value: await element[method](...args) };
    }
    throw new Error(`Unsupported invoke target: ${target}`);
  }

  async waitForElement(options = {}) {
    const selector = requireString(options.selector, "selector");
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const waited = await waitFor(async () => {
      const page = await this.requireCurrentPage();
      const elements = await page.$$(selector);
      return elements.length ? true : null;
    }, { timeoutMs, intervalMs });
    return {
      ok: waited.ok,
      selector,
      elapsedMs: waited.elapsedMs,
    };
  }

  async safeCurrentPage() {
    if (!this.miniProgram) {
      return null;
    }
    try {
      return await withTimeout(this.miniProgram.currentPage(), 5000, "Automator currentPage health check");
    } catch {
      return null;
    }
  }

  async isAlive() {
    const page = await this.safeCurrentPage();
    return Boolean(page);
  }

  requireMiniProgram() {
    if (!this.miniProgram) {
      throw new Error("No active session. Run session start first.");
    }
    return this.miniProgram;
  }

  async requireCurrentPage() {
    const page = await this.requireMiniProgram().currentPage();
    if (!page) {
      throw new Error("No current page is available from the automator session.");
    }
    return page;
  }

  async resolveElement(options = {}) {
    const selector = requireString(options.selector, "selector");
    const page = await this.requireCurrentPage();
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found for selector "${selector}".`);
    }
    return element;
  }

  async buildTapResult(options) {
    if (!options.waitRoute && !options.waitSelector) {
      return { ok: true };
    }
    if (options.waitRoute) {
      return this.assertRoute({ expected: options.waitRoute, timeoutMs: options.timeoutMs, failOnFalse: false });
    }
    return this.waitForElement({ selector: options.waitSelector, timeoutMs: options.timeoutMs });
  }
}

function summarizePage(page) {
  return {
    path: page.path ?? null,
    query: page.query ?? {},
  };
}

async function summarizeElement(element, selector, index, options = {}) {
  const text = await safeElementCall(element, "text", null);
  const value = await safeElementCall(element, "value", null);
  const size = await safeElementCall(element, "size", null);
  const offset = await safeElementCall(element, "offset", null);
  const summary = {
    selector,
    index,
    tagName: element.tagName ?? null,
    text,
    value,
    size,
    offset,
  };
  if (options.includeDataPath) {
    summary.data = await safeElementCall(element, "data", null, options.includeDataPath);
  }
  return summary;
}

async function safeElementCall(element, methodName, fallback, ...args) {
  try {
    if (typeof element[methodName] !== "function") {
      return fallback;
    }
    return await element[methodName](...args);
  } catch {
    return fallback;
  }
}

async function touch(element, methodName, touchesValue, changedValue) {
  const createTouch = (point) => ({
    identifier: 1,
    pageX: Math.round(point[0]),
    pageY: Math.round(point[1]),
  });
  const touches = Array.isArray(touchesValue) && touchesValue.length === 0 ? [] : [createTouch(touchesValue)];
  const changedTouches = [createTouch(changedValue)];
  await element[methodName]({ touches, changedTouches });
}

function requireString(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireSafeMethod(value) {
  const method = requireString(value, "method");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
    throw new Error("method must be a simple identifier.");
  }
  if (["constructor", "__proto__", "prototype"].includes(method)) {
    throw new Error(`method is not allowed: ${method}`);
  }
  return method;
}

function assertionResult(ok, kind, subject, expected, actual, elapsedMs, failOnFalse = true) {
  const result = {
    ok,
    assertion: kind,
    subject,
    expected,
    actual: actual ?? null,
    elapsedMs,
  };
  if (!ok && failOnFalse !== false) {
    const error = new Error(`${kind} assertion failed for ${subject}`);
    error.assertion = result;
    throw error;
  }
  return result;
}

module.exports = {
  connectAutomatorWithRetry,
  SessionController,
};

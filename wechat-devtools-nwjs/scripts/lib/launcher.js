"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const WebSocket = require("ws");
const { DEFAULT_AUTOMATOR_PORT, DEFAULT_CDP_PORT } = require("./constants");
const {
  buildCliInvocation,
  defaultIdeStateRoots,
  defaultWechatCliCandidates,
  detectWechatRuntime,
  ideExecutableCandidates,
  resolvePlatform,
  stopIdeCommands,
} = require("./platform");
const { fileExists, waitFor } = require("./utils");

function resolveLaunchConfig(options = {}) {
  const platform = resolvePlatform(options.platform || process.platform);
  const projectPath =
    options.projectPath ||
    process.env.WEAPP_AUTO_PROJECT ||
    null;
  const autoPort =
    options.autoPort ||
    Number(process.env.WEAPP_AUTO_PORT || 0) ||
    DEFAULT_AUTOMATOR_PORT;
  const wechatCliPath =
    options.wechatCliPath ||
    process.env.WECHAT_DEVTOOLS_CLI ||
    defaultWechatCliCandidates(platform).find(fileExists) ||
    defaultWechatCliCandidates(platform)[0];
  const envCdpPort = Number(process.env.WEAPP_CDP_PORT || 0);
  const cdpPort = options.cdpPort || envCdpPort || DEFAULT_CDP_PORT;
  const envIdePort = Number(process.env.WEAPP_IDE_PORT || 0);
  const idePort = options.idePort || envIdePort || null;

  const runtime = options.runtime || (platform === "win32" ? detectWechatRuntime(wechatCliPath) : "nwjs");
  return {
    autoPort,
    cdpEnabled: options.cdpEnabled !== false,
    cdpPort,
    cdpPortExplicit: Boolean(options.cdpPortExplicit || envCdpPort),
    idePort,
    multiOpen: options.multiOpen === true || process.env.WEAPP_MULTI_OPEN === "1",
    projectPath,
    restartIdeForCdp: options.restartIdeForCdp !== false,
    runtime,
    legacySupported: runtime !== "electron",
    recommendedSkill: runtime === "electron" ? "wechat-devtools" : null,
    platform,
    wechatCliPath,
  };
}

function getJson(url, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Request timed out.")));
    request.on("error", reject);
  });
}

async function getCdpTargets(port) {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  if (!Array.isArray(targets)) {
    throw new Error("CDP /json/list did not return an array.");
  }
  return targets.filter((target) => target && target.webSocketDebuggerUrl);
}

async function checkCdpEndpoint(port) {
  try {
    const targets = await getCdpTargets(port);
    return { ok: true, port, targetCount: targets.length };
  } catch (error) {
    return { ok: false, port, error: error.message };
  }
}

async function resolveCdpPort(preferredPort, options = {}) {
  const preferred = Number(preferredPort || DEFAULT_CDP_PORT);
  const existing = await checkCdpEndpoint(preferred);
  if (existing.ok) {
    return preferred;
  }
  if (options.preferExisting && options.allowFallback !== false) {
    for (let port = preferred + 1; port <= preferred + 10; port += 1) {
      const status = await checkCdpEndpoint(port);
      if (status.ok) {
        return port;
      }
    }
  }
  if (!(await isPortListening(preferred))) {
    return preferred;
  }
  if (options.allowFallback === false) {
    return preferred;
  }
  for (let port = preferred + 1; port <= preferred + 10; port += 1) {
    const status = await checkCdpEndpoint(port);
    if (status.ok || !(await isPortListening(port))) {
      return port;
    }
  }
  throw new Error(`No available CDP port found from ${preferred} to ${preferred + 10}.`);
}

async function waitForCdp(port, options = {}) {
  return waitFor(async () => {
    const status = await checkCdpEndpoint(port);
    return status.ok ? status : null;
  }, options);
}

async function waitForProjectRuntime(port, options = {}) {
  const stableChecks = Number(options.stableChecks || 4);
  let consecutiveReadyChecks = 0;
  return waitFor(async () => {
    try {
      const targets = await getCdpTargets(port);
      const hasAppService = targets.some((target) => /\/appservice\/mainframe/i.test(target.url || ""));
      const hasPageFrame = targets.some((target) => /\/__pageframe__\/instanceframe/i.test(target.url || ""));
      if (hasAppService && hasPageFrame) {
        consecutiveReadyChecks += 1;
        return consecutiveReadyChecks >= stableChecks ? { targets } : null;
      }
      consecutiveReadyChecks = 0;
      return null;
    } catch {
      consecutiveReadyChecks = 0;
      return null;
    }
  }, options);
}

async function checkProjectOpened(port, projectPath) {
  try {
    const expectedPath = path.normalize(projectPath || "").toLowerCase();
    const targets = await getCdpTargets(port);
    const projectTarget = targets.find((target) => {
      try {
        const targetUrl = new URL(target.url || "");
        const openedPath = targetUrl.searchParams.get("projectpath");
        return openedPath && path.normalize(openedPath).toLowerCase() === expectedPath;
      } catch {
        return false;
      }
    });
    return { ok: Boolean(projectTarget), projectTarget: projectTarget || null, targets };
  } catch (error) {
    return { ok: false, projectTarget: null, targets: [], error: error.message };
  }
}

function evaluateCdp(target, expression, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const id = 1;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      callback();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("CDP Runtime.evaluate timed out."))),
      timeoutMs
    );
    socket.once("open", () => {
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    socket.once("error", (error) => finish(() => reject(error)));
    socket.on("message", (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.id !== id) return;
      if (message.error || message.result?.exceptionDetails) {
        finish(() => reject(new Error(message.error?.message || "CDP evaluation failed.")));
        return;
      }
      finish(() => resolve(message.result?.result?.value));
    });
  });
}

async function inspectProjectDom(target) {
  return evaluateCdp(target, `(() => {
    const body = document.body;
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const busySelector = [
      '[aria-busy="true"]', 'progress',
      '[class*="loading" i]', '[class*="spinner" i]',
      '[class*="skeleton" i]', '[id*="loading" i]'
    ].join(',');
    const visibleBusyCount = body
      ? Array.from(body.querySelectorAll(busySelector)).filter(isVisible).length
      : 0;
    const bodyChildCount = body ? body.childElementCount : 0;
    const elementCount = body ? body.getElementsByTagName('*').length : 0;
    return {
      readyState: document.readyState,
      bodyPresent: Boolean(body && bodyChildCount > 0 && elementCount > 0),
      bodyChildCount,
      elementCount,
      visibleBusyCount,
    };
  })()`);
}

async function waitForProjectOpened(port, projectPath, options = {}) {
  const debounceMs = Number(options.debounceMs ?? options.stableMs ?? 3000);
  const checkProject = options.checkProject || checkProjectOpened;
  const inspectDom = options.inspectDom || inspectProjectDom;
  let readySince = null;
  let readinessKey = null;
  return waitFor(async () => {
    const state = await checkProject(port, projectPath);
    if (state.ok) {
      const targetKey = state.projectTarget.id || state.projectTarget.url;
      let dom;
      try {
        dom = await inspectDom(state.projectTarget);
      } catch {
        readySince = null;
        readinessKey = null;
        return null;
      }
      const signalsReady =
        dom?.readyState === "complete" &&
        dom?.bodyPresent === true &&
        dom?.visibleBusyCount === 0;
      if (!signalsReady) {
        readySince = null;
        readinessKey = null;
        return null;
      }
      const domFingerprint = `${dom.bodyChildCount}:${dom.elementCount}:${dom.visibleBusyCount}`;
      const nextReadinessKey = `${targetKey}:${domFingerprint}`;
      if (nextReadinessKey !== readinessKey) {
        readinessKey = nextReadinessKey;
        readySince = Date.now();
      }
      return Date.now() - readySince >= debounceMs ? { ...state, dom } : null;
    }
    readySince = null;
    readinessKey = null;
    return null;
  }, options);
}

function isPortListening(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

async function waitForPort(port, options = {}) {
  return waitFor(() => isPortListening(port), options);
}

async function waitForStablePort(port, options = {}) {
  const stableMs = Number(options.stableMs || 5000);
  let listeningSince = null;
  return waitFor(async () => {
    if (await isPortListening(port)) {
      listeningSince = listeningSince || Date.now();
      return Date.now() - listeningSince >= stableMs ? true : null;
    }
    listeningSince = null;
    return null;
  }, options);
}

function buildWrapCommand(config) {
  if (!config.wechatCliPath) {
    throw new Error("WeChat DevTools CLI was not resolved.");
  }
  if (!config.projectPath) {
    throw new Error("Project path was not resolved.");
  }
  const args = [];
  if (config.idePort) {
    args.push("--port", String(config.idePort));
  }
  args.push(
    "auto",
    "--project",
    config.projectPath,
    "--auto-port",
    String(config.autoPort),
    "--trust-project",
  );
  return buildCliInvocation(config.wechatCliPath, args, config.platform).args;
}

function buildAutoInvocation(config) {
  return buildCliInvocation(config.wechatCliPath, buildCliArgs(config, "auto"), config.platform);
}

function buildCliArgs(config, command) {
  const args = [];
  if (config.idePort) args.push("--port", String(config.idePort));
  args.push(command, "--project", config.projectPath);
  if (command === "auto") {
    args.push("--auto-port", String(config.autoPort), "--trust-project");
  }
  return args;
}

function buildOpenCommand(config) {
  if (!config.wechatCliPath) {
    throw new Error("WeChat DevTools CLI was not resolved.");
  }
  if (!config.projectPath) {
    throw new Error("Project path was not resolved.");
  }
  if (!config.idePort) {
    throw new Error("IDE HTTP service port was not resolved.");
  }
  return buildCliInvocation(
    config.wechatCliPath,
    buildCliArgs(config, "open"),
    config.platform
  ).args;
}

function buildOpenInvocation(config) {
  return buildCliInvocation(config.wechatCliPath, buildCliArgs(config, "open"), config.platform);
}

function buildCloseCommand(config) {
  if (!config.wechatCliPath) {
    throw new Error("WeChat DevTools CLI was not resolved.");
  }
  if (!config.projectPath) {
    throw new Error("Project path was not resolved.");
  }
  if (!config.idePort) {
    throw new Error("IDE HTTP service port was not resolved.");
  }
  return buildCliInvocation(
    config.wechatCliPath,
    buildCliArgs(config, "close"),
    config.platform
  ).args;
}

function buildOpenOtherCommand(config) {
  if (!config.wechatCliPath) {
    throw new Error("WeChat DevTools CLI was not resolved.");
  }
  if (!config.projectPath) {
    throw new Error("Project path was not resolved.");
  }
  return buildCliInvocation(
    config.wechatCliPath,
    ["open-other", "--project", config.projectPath],
    config.platform
  ).args;
}

function buildOpenOtherInvocation(config) {
  return buildCliInvocation(
    config.wechatCliPath,
    ["open-other", "--project", config.projectPath],
    config.platform
  );
}

function spawnHidden(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
}

async function createIdePortCallbackServer() {
  let reportedIdePort = null;
  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const port = Number(requestUrl.searchParams.get("port"));
      if (requestUrl.pathname === "/updatePort" && Number.isInteger(port) && port > 0) {
        reportedIdePort = port;
        response.statusCode = 200;
        response.end();
        return;
      }
    } catch {
      // Fall through to a compact 404 response.
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to allocate the temporary WeChat CLI callback port.");
  }

  return {
    port: address.port,
    getReportedIdePort: () => reportedIdePort,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function buildDirectIdeArgs(config, callbackPort) {
  const args = [
    "--cli",
    "--remote-port",
    String(callbackPort),
    "--enable-service-port",
    `--remote-debugging-port=${config.cdpPort}`,
  ];
  if (config.idePort) {
    args.push("--ide-http-port", String(config.idePort));
  }
  if (config.projectPath) {
    args.push("--project", config.projectPath);
  }
  return args;
}

function readIdePortState(options = {}) {
  const platform = resolvePlatform(options.platform || process.platform);
  const roots = options.roots || defaultIdeStateRoots(platform, options.env || process.env);
  const candidates = [];
  for (const root of roots) {
    if (!fileExists(root)) continue;
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
        } else if (entry.name === ".ide") {
          const port = Number(fs.readFileSync(entryPath, "utf8").trim());
          if (Number.isInteger(port) && port > 0) {
            candidates.push({ port, modifiedAt: fs.statSync(entryPath).mtimeMs });
          }
        }
      }
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.port || null;
}

async function resolveActiveIdePort(preferredPort = null, options = {}) {
  const port = preferredPort || readIdePortState(options);
  if (!port) {
    return null;
  }
  return (await isPortListening(port)) ? port : null;
}

function runHidden(command, args, timeoutMs = 60000, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments:
        process.platform === "win32" && /(?:^|[\\/])cmd\.exe$/i.test(command),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      child.kill();
      finish(() => reject(options.signal.reason || new Error("Operation cancelled.")));
    };
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-20000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-20000);
    });
    timer = setTimeout(() => {
      child.kill();
      const error = new Error(`Command timed out after ${timeoutMs}ms.`);
      error.stdout = stdout.trim();
      error.stderr = stderr.trim();
      finish(() => reject(error));
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    child.once("error", (error) => {
      finish(() => reject(error));
    });
    child.once("exit", (code) => {
      if (settled) return;
      if (code !== 0) {
        const error = new Error(`Command exited with code ${code}: ${stderr || stdout}`);
        error.exitCode = code;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        finish(() => reject(error));
        return;
      }
      finish(() => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  });
}

function summarizeCliAttempt(attempt, result = null, error = null) {
  return {
    attempt,
    ok: Boolean(result),
    result,
    error: error ? error.message : null,
  };
}

function isRetryableAutoError(error) {
  const message = [error?.message, error?.stderr, error?.stdout].filter(Boolean).join("\n");
  return /Command timed out after|IDE may already started|#initialize-error|wait IDE port timeout|initialize[^\n]*timeout/i.test(message);
}

function resolveLaunchMethod(config, recoveredFrom, result) {
  if (config.multiOpen) {
    return "open-other";
  }
  if (!recoveredFrom) {
    return "direct-cli";
  }
  return result ? "direct-cli-retry" : "direct-cli-port-recovery";
}

async function launchDevtools(config, options = {}) {
  if (config.runtime === "electron") {
    throw new Error(
      "Detected modern Electron WeChat DevTools. Stop this legacy workflow and use $wechat-devtools; cli.bat, open/auto, port 9420, and miniprogram-automator were not invoked."
    );
  }
  const runCommand = options.runCommand || runHidden;
  const waitForAutoPort = options.waitForAutoPort || waitForStablePort;
  const waitForRuntime = options.waitForRuntime || waitForProjectRuntime;
  const waitForProjectOpen = options.waitForProjectOpen || waitForProjectOpened;
  const timeoutMs = Number(options.timeoutMs || 60000);
  const shouldWaitForProjectOpen =
    config.cdpEnabled !== false &&
    config.cdpPort &&
    (!options.runCommand || Boolean(options.waitForProjectOpen));
  let openOtherResult = null;
  let openResult = null;
  const openResults = [];

  const openProjectAndWait = async () => {
    const invocation = buildOpenInvocation(config);
    openResult = await runCommand(invocation.command, invocation.args, timeoutMs, { signal: options.signal });
    openResults.push(openResult);
    if (shouldWaitForProjectOpen) {
      const readiness = await waitForProjectOpen(config.cdpPort, config.projectPath, {
        timeoutMs: Math.min(timeoutMs, Number(options.projectOpenTimeoutMs || 60000)),
        intervalMs: 500,
        debounceMs: Number(options.projectOpenDebounceMs || 3000),
        signal: options.signal,
      });
      if (!readiness.ok) {
        throw new Error(
          `Target project window did not remain stable on CDP port ${config.cdpPort} after CLI open; auto was not started.`
        );
      }
    }
  };

  if (config.multiOpen) {
    const invocation = buildOpenOtherInvocation(config);
    openOtherResult = await runCommand(
      invocation.command,
      invocation.args,
      Number(options.timeoutMs || 60000),
      { signal: options.signal }
    );
  } else if (config.idePort) {
    await openProjectAndWait();
  }
  const invocation = buildAutoInvocation(config);
  const attempts = [];
  let result = null;
  let recoveredFrom = null;

  try {
    result = await runCommand(invocation.command, invocation.args, timeoutMs, { signal: options.signal });
    attempts.push(summarizeCliAttempt(1, result));
  } catch (error) {
    attempts.push(summarizeCliAttempt(1, null, error));
    if (config.multiOpen || !isRetryableAutoError(error)) {
      throw error;
    }

    recoveredFrom = error.message;
    const graceTimeoutMs = Math.max(
      0,
      Math.min(Number(options.autoPortGraceMs ?? 5000), timeoutMs)
    );
    const readiness = await waitForAutoPort(config.autoPort, {
      timeoutMs: graceTimeoutMs,
      intervalMs: 500,
      signal: options.signal,
    });
    if (!readiness.ok) {
      error.cliAttempts = attempts;
      throw error;
    }
  }

  if (config.cdpEnabled !== false && config.cdpPort) {
    const runtimeReadiness = await waitForRuntime(config.cdpPort, {
      timeoutMs,
      intervalMs: 500,
      signal: options.signal,
    });
    if (!runtimeReadiness.ok) {
      throw new Error(
        `Mini Program runtime did not expose appservice and pageframe CDP targets on port ${config.cdpPort} after one CLI auto attempt; open/auto was not replayed.`
      );
    }
  }

  if (!options.runCommand || options.waitForAutoPort) {
    const stableReadiness = await waitForAutoPort(config.autoPort, {
      timeoutMs,
      intervalMs: 250,
      stableMs: 5000,
      signal: options.signal,
    });
    if (!stableReadiness.ok) {
      throw new Error(`Automator port ${config.autoPort} did not remain stable after one CLI auto attempt; auto was not replayed.`);
    }
  }

  return {
    cliResult: result,
    cliAttempts: attempts,
    multiOpen: config.multiOpen,
    openResult,
    openResults,
    openOtherResult,
    recoveredFrom,
    retryCount: Math.max(0, attempts.length - 1),
    startedBy: resolveLaunchMethod(config, recoveredFrom, result),
  };
}

function resolveIdeExecutable(wechatCliPath, platform = process.platform) {
  if (!wechatCliPath) {
    throw new Error("WeChat DevTools CLI was not resolved.");
  }
  for (const executable of ideExecutableCandidates(wechatCliPath, platform)) {
    if (fileExists(executable)) {
      return executable;
    }
  }
  throw new Error(`WeChat DevTools executable was not found for CLI: ${wechatCliPath}`);
}

function stopExistingIdeForCdp(platform = process.platform) {
  for (const invocation of stopIdeCommands(platform)) {
    spawnSync(invocation.command, invocation.args, {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

async function launchDevtoolsWithCdp(config, options = {}) {
  const existing = await checkCdpEndpoint(config.cdpPort);
  if (existing.ok && !options.forceRestart) {
    return {
      reused: true,
      cdpPort: config.cdpPort,
      idePort: await resolveActiveIdePort(config.idePort, { platform: config.platform }),
      targetCount: existing.targetCount,
    };
  }
  if (!options.forceRestart && (await isPortListening(config.cdpPort))) {
    throw new Error(
      `Port ${config.cdpPort} is listening but is not a valid CDP /json/list endpoint. Choose another --cdp-port.`
    );
  }
  if (config.multiOpen) {
    throw new Error(
      `Multi-open mode requires an existing CDP endpoint. Start the primary instance first, then reuse its CDP port with --cdp-port (current: ${config.cdpPort}).`
    );
  }
  if (!config.restartIdeForCdp) {
    throw new Error(
      "CDP requires restarting WeChat DevTools with --remote-debugging-port. Re-run without --no-restart-ide-for-cdp, or use --no-cdp."
    );
  }
  stopExistingIdeForCdp(config.platform);
  const executable = resolveIdeExecutable(config.wechatCliPath, config.platform);
  const callbackServer = await createIdePortCallbackServer();
  let child = null;
  let ideReadiness = null;
  try {
    const args = buildDirectIdeArgs(config, callbackServer.port);
    child = spawnHidden(executable, args, { cwd: path.dirname(config.wechatCliPath) });
    child.unref();
    ideReadiness = await waitFor(() => callbackServer.getReportedIdePort(), {
      timeoutMs: Number(options.timeoutMs || 60000),
      intervalMs: 100,
      signal: options.signal,
    });
  } finally {
    await callbackServer.close();
  }
  if (!ideReadiness.ok) {
    throw new Error(
      "WeChat DevTools started but did not report its IDE HTTP service port to the CLI callback server."
    );
  }
  if (config.idePort && ideReadiness.value !== config.idePort) {
    throw new Error(
      `WeChat DevTools reported IDE HTTP port ${ideReadiness.value}, expected ${config.idePort}.`
    );
  }
  return {
    reused: false,
    pid: child?.pid || null,
    cdpPort: config.cdpPort,
    idePort: ideReadiness.value,
    cliCallbackPort: callbackServer.port,
    executable,
  };
}

module.exports = {
  buildCloseCommand,
  buildAutoInvocation,
  buildDirectIdeArgs,
  buildOpenCommand,
  checkCdpEndpoint,
  checkProjectOpened,
  createIdePortCallbackServer,
  getCdpTargets,
  isPortListening,
  isRetryableAutoError,
  launchDevtools,
  launchDevtoolsWithCdp,
  readIdePortState,
  resolveActiveIdePort,
  resolveLaunchConfig,
  resolveCdpPort,
  waitForCdp,
  waitForPort,
  waitForProjectOpened,
  waitForProjectRuntime,
  waitForStablePort,
};

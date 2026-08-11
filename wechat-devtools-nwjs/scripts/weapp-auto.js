#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { sendRequest: sendRequestForInstance } = require("./lib/client");
const {
  DEFAULT_AUTOMATOR_PORT,
  DEFAULT_CDP_PORT,
  DEFAULT_INSTANCE,
  SKILL_ROOT,
  getRuntimePaths,
  normalizeInstanceName,
} = require("./lib/constants");
const {
  checkCdpEndpoint,
  isPortListening,
  resolveActiveIdePort,
  resolveCdpPort,
  resolveLaunchConfig,
} = require("./lib/launcher");
const { readState } = require("./lib/state");
const { fileExists, parseJsonInput } = require("./lib/utils");

let activeInstance = DEFAULT_INSTANCE;

function sendRequest(method, params) {
  return sendRequestForInstance(method, params, { instance: activeInstance });
}

async function main(argv) {
  const parsed = parseArgv(argv);
  activeInstance = normalizeInstanceName(parsed.flags.instance);
  let result;
  switch (parsed.commandKey) {
    case "env check":
      result = await envCheck(parsed.flags);
      break;
    case "session start": {
      const sessionOptions = mapSessionFlags(parsed.flags);
      const config = resolveLaunchConfig(sessionOptions);
      if (config.runtime === "electron") {
        throw new Error(
          "Detected modern Electron WeChat DevTools. Use $wechat-devtools; the legacy daemon was not started and cli.bat/open/auto/9420 were not invoked."
        );
      }
      result = await sendRequest("ensureSession", sessionOptions);
      break;
    }
    case "session status":
      result = await sendRequest("status");
      break;
    case "session cancel":
      result = await sendRequest("cancelSessionStart");
      break;
    case "session stop":
      result = await sendRequest("shutdown");
      break;
    case "network status":
      result = await sendRequest("networkStatus");
      break;
    case "network clear":
      result = await sendRequest("networkClear");
      break;
    case "network list":
      result = await sendRequest("networkList", mapNetworkFilters(parsed.flags));
      break;
    case "network wait":
      result = await sendRequest("networkWait", {
        ...mapNetworkFilters(parsed.flags),
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
      });
      break;
    case "network body":
      result = await sendRequest("networkBody", {
        id: requireFlag(parsed.flags, "id"),
        maxBytes: numberFlag(parsed.flags["max-bytes"], 200000),
        jsonPath: parsed.flags["json-path"],
      });
      break;
    case "network detail":
      result = await sendRequest("networkDetail", {
        id: requireFlag(parsed.flags, "id"),
      });
      break;
    case "page current":
      result = await sendRequest("pageCurrent", {
        dataPath: parsed.flags["data-path"],
      });
      break;
    case "page stack":
      result = await sendRequest("pageStack");
      break;
    case "page data":
      result = await sendRequest("pageData", {
        path: parsed.flags.path,
      });
      break;
    case "page set-data":
      result = await sendRequest("pageSetData", {
        data: requireJsonFlag(parsed.flags, "data-json"),
      });
      break;
    case "page call-method":
      result = await sendRequest("pageCallMethod", {
        method: requireFlag(parsed.flags, "method"),
        args: optionalJsonArray(parsed.flags["args-json"]),
      });
      break;
    case "page navigate":
      result = await sendRequest("pageNavigate", {
        method: parsed.flags.method || "navigateTo",
        url: parsed.flags.url,
      });
      break;
    case "page screenshot":
      result = await sendRequest("pageScreenshot", {
        path: parsed.flags.path ? path.resolve(parsed.flags.path) : null,
      });
      break;
    case "page wait":
      result = await sendRequest("pageWait", {
        selector: parsed.flags.selector,
        route: parsed.flags.route,
        timeoutMs: numberFlag(parsed.flags.timeout, 15000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
      });
      break;
    case "element query":
      result = await sendRequest("queryElement", {
        selector: requireFlag(parsed.flags, "selector"),
      });
      break;
    case "element query-all":
      result = await sendRequest("queryElements", {
        selector: requireFlag(parsed.flags, "selector"),
        limit: numberFlag(parsed.flags.limit, 20),
      });
      break;
    case "element tap":
      result = await sendRequest("tapElement", {
        selector: requireFlag(parsed.flags, "selector"),
        waitRoute: parsed.flags["wait-route"],
        waitSelector: parsed.flags["wait-selector"],
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
      });
      break;
    case "element tap-text":
      result = await sendRequest("tapText", {
        selector: parsed.flags.selector,
        text: requireFlag(parsed.flags, "text"),
      });
      break;
    case "element input":
      result = await sendRequest("inputElement", {
        selector: requireFlag(parsed.flags, "selector"),
        value: requireFlag(parsed.flags, "value"),
      });
      break;
    case "element call-method":
      result = await sendRequest("elementCallMethod", {
        selector: requireFlag(parsed.flags, "selector"),
        method: requireFlag(parsed.flags, "method"),
        args: optionalJsonArray(parsed.flags["args-json"]),
      });
      break;
    case "element data":
      result = await sendRequest("elementData", {
        selector: requireFlag(parsed.flags, "selector"),
        path: parsed.flags.path,
      });
      break;
    case "gesture swipe":
      result = await sendRequest("swipe", {
        selector: requireFlag(parsed.flags, "selector"),
        direction: parsed.flags.direction || "up",
        steps: numberFlag(parsed.flags.steps, 6),
        marginRatio: numberFlag(parsed.flags["margin-ratio"], 0.2),
      });
      break;
    case "scroll-view to":
      result = await sendRequest("scrollViewTo", {
        selector: requireFlag(parsed.flags, "selector"),
        x: numberFlag(parsed.flags.x, 0),
        y: numberFlag(parsed.flags.y, 0),
      });
      break;
    case "wx call":
      result = await sendRequest("wxCall", {
        method: requireFlag(parsed.flags, "method"),
        args: optionalJsonArray(parsed.flags["args-json"]),
      });
      break;
    case "wx mock":
      result = await sendRequest("wxMock", {
        method: requireFlag(parsed.flags, "method"),
        result: requireJsonFlag(parsed.flags, "result-json"),
      });
      break;
    case "wx restore":
      result = await sendRequest("wxRestore", {
        method: requireFlag(parsed.flags, "method"),
      });
      break;
    case "assert visible":
      result = await sendRequest("assertVisible", {
        selector: requireFlag(parsed.flags, "selector"),
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
        failOnFalse: false,
      });
      break;
    case "assert text":
      result = await sendRequest("assertText", {
        selector: requireFlag(parsed.flags, "selector"),
        expected: requireFlag(parsed.flags, "expected"),
        mode: parsed.flags.mode || "contains",
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
        failOnFalse: false,
      });
      break;
    case "assert data":
      result = await sendRequest("assertData", {
        path: parsed.flags.path,
        expected: requireJsonFlag(parsed.flags, "expected-json"),
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
        failOnFalse: false,
      });
      break;
    case "assert path":
      result = await sendRequest("assertRoute", {
        expected: requireFlag(parsed.flags, "expected"),
        timeoutMs: numberFlag(parsed.flags.timeout, 10000),
        intervalMs: numberFlag(parsed.flags.interval, 200),
        failOnFalse: false,
      });
      break;
    case "capability list":
      result = await sendRequest("capabilityList", {
        target: parsed.flags.target,
      });
      break;
    case "invoke":
      result = await sendRequest("invoke", {
        target: parsed.flags.target || "miniProgram",
        selector: parsed.flags.selector,
        method: requireFlag(parsed.flags, "method"),
        args: optionalJsonArray(parsed.flags["args-json"]),
      });
      break;
    default:
      throw new Error(`Unknown command: ${parsed.commandKey || argv.join(" ")}`);
  }

  printJson(result);
  if (String(parsed.commandKey).startsWith("assert ") && result && result.ok === false) {
    process.exit(1);
  }
}

async function envCheck(flags) {
  const runtime = getRuntimePaths(flags.instance);
  const config = resolveLaunchConfig({
    projectPath: flags.project,
    autoPort: numberFlag(flags["auto-port"], DEFAULT_AUTOMATOR_PORT),
    wechatCliPath: flags["wechat-cli"],
    cdpEnabled: !flags["no-cdp"],
    cdpPort: numberFlag(flags["cdp-port"], DEFAULT_CDP_PORT),
    cdpPortExplicit: flags["cdp-port"] !== undefined,
    idePort: numberFlag(flags["ide-port"], undefined),
    multiOpen: Boolean(flags["multi-open"]),
    restartIdeForCdp: !flags["no-restart-ide-for-cdp"],
  });
  if (config.runtime === "electron") {
    return {
      ok: false,
      platform: process.platform,
      instance: runtime.instance,
      skillRoot: SKILL_ROOT,
      node: process.execPath,
      projectPath: config.projectPath,
      projectConfigFound: Boolean(config.projectPath && fileExists(path.join(config.projectPath, "project.config.json"))),
      wechatCliPath: config.wechatCliPath,
      wechatCliFound: Boolean(config.wechatCliPath && fileExists(config.wechatCliPath)),
      runtime: config.runtime,
      legacySupported: false,
      recommendedSkill: config.recommendedSkill,
      message: "Modern Electron WeChat DevTools is not supported by this legacy NW.js/9420 Skill. Use $wechat-devtools; no legacy ports or startup commands were probed.",
    };
  }
  const selectedCdpPort = config.cdpEnabled
    ? await resolveCdpPort(config.cdpPort, {
      allowFallback: !config.cdpPortExplicit,
      preferExisting: config.multiOpen,
    })
    : config.cdpPort;
  const state = readState(runtime.instance);
  return {
    ok: true,
    platform: process.platform,
    instance: runtime.instance,
    skillRoot: SKILL_ROOT,
    daemonPipe: runtime.pipeName,
    daemonState: state,
    node: process.execPath,
    projectPath: config.projectPath,
    projectConfigFound: Boolean(config.projectPath && fileExists(path.join(config.projectPath, "project.config.json"))),
    wechatCliPath: config.wechatCliPath,
    runtime: config.runtime,
    legacySupported: true,
    recommendedSkill: null,
    wechatCliFound: Boolean(config.wechatCliPath && fileExists(config.wechatCliPath)),
    automatorPort: config.autoPort,
    automatorPortListening: await isPortListening(config.autoPort),
    idePort: await resolveActiveIdePort(config.idePort),
    cdpEnabled: config.cdpEnabled,
    multiOpen: config.multiOpen,
    cdpPreferredPort: config.cdpPort,
    cdpPort: selectedCdpPort,
    cdp: await checkCdpEndpoint(selectedCdpPort),
    notes: [
      "automatorPort is the WebSocket port used by miniprogram-automator.",
      "This is distinct from any ordinary WeChat DevTools CLI service port.",
      "A listening CDP port is valid only when /json/list returns CDP targets.",
      "Launch precedence: explicit flags > env vars > internal startup defaults.",
    ],
  };
}

function mapSessionFlags(flags) {
  const multiOpen = Boolean(flags["multi-open"]);
  if (multiOpen && flags["auto-port"] === undefined) {
    throw new Error("--multi-open requires an explicit unique --auto-port.");
  }
  return {
    autoPort: numberFlag(flags["auto-port"], undefined),
    projectPath: flags.project,
    timeoutMs: numberFlag(flags.timeout, 120000),
    wechatCliPath: flags["wechat-cli"],
    cdpEnabled: !flags["no-cdp"],
    cdpPort: numberFlag(flags["cdp-port"], DEFAULT_CDP_PORT),
    cdpPortExplicit: flags["cdp-port"] !== undefined,
    idePort: numberFlag(flags["ide-port"], undefined),
    multiOpen,
    restartIdeForCdp: !flags["no-restart-ide-for-cdp"],
  };
}

function mapNetworkFilters(flags) {
  return {
    url: flags.url,
    method: flags.method,
    type: flags.type,
    status: flags.status === undefined ? undefined : numberFlag(flags.status),
    limit: numberFlag(flags.limit, 20),
  };
}

function parseArgv(argv) {
  const tokens = [...argv];
  const command = [];
  const flags = {};
  while (tokens.length) {
    const token = tokens.shift();
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = tokens[0];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = tokens.shift();
      }
      continue;
    }
    command.push(token);
  }
  return {
    commandKey: command.join(" "),
    flags,
  };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function requireJsonFlag(flags, name) {
  return parseJsonInput(requireFlag(flags, name), `--${name}`);
}

function optionalJsonArray(value) {
  if (!value) {
    return [];
  }
  const parsed = parseJsonInput(value, "--args-json");
  if (!Array.isArray(parsed)) {
    throw new Error("--args-json must be a JSON array.");
  }
  return parsed;
}

function numberFlag(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected numeric value, got: ${value}`);
  }
  return number;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  const output = {
    ok: false,
    message: error.message,
    assertion: error.assertion || null,
    details: error.details || null,
  };
  process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(error.assertion ? 1 : 2);
});

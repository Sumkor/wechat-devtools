#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_WS_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  loadAutomator,
  withTimeout,
} from './automator-session.mjs'

function usage() {
  console.error(`Usage:
  node capture-wx-request.mjs [options]

Options:
  --ws-endpoint <url>   Automator endpoint (default: ws://127.0.0.1:9420)
  --duration-ms <ms>    Capture duration (default: 10000)
  --operation-timeout-ms <ms>
                        Timeout for connect/page/evaluate (default: 15000)
  --output <file>       Write the records array as JSON
  --quiet               Do not print individual records to stdout
  --help                Show this help`)
}

function parseArgs(argv) {
  const options = {
    wsEndpoint: DEFAULT_WS_ENDPOINT,
    durationMs: 10000,
    operationTimeoutMs: DEFAULT_TIMEOUT_MS,
    output: null,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    const value = argv[++i]
    if (value == null) throw new Error(`Missing value for ${arg}`)
    if (arg === '--ws-endpoint') options.wsEndpoint = value
    else if (arg === '--duration-ms') options.durationMs = Number(value)
    else if (arg === '--operation-timeout-ms') options.operationTimeoutMs = Number(value)
    else if (arg === '--output') options.output = value
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('--duration-ms must be a positive number')
  }
  if (!Number.isFinite(options.operationTimeoutMs) || options.operationTimeoutMs <= 0) {
    throw new Error('--operation-timeout-ms must be a positive number')
  }
  return options
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

const options = parseArgs(process.argv.slice(2))
const automator = loadAutomator()
const records = []
const mp = await withTimeout(
  automator.connect({ wsEndpoint: options.wsEndpoint }),
  options.operationTimeoutMs,
  'automator.connect',
)

async function installWrapper() {
  const page = await withTimeout(mp.currentPage(), options.operationTimeoutMs, 'currentPage')
  if (!page?.path) throw new Error('Automator page is not ready: currentPage().path is empty')
  const result = await withTimeout(mp.evaluate(function () {
    if (typeof wx === 'undefined' || typeof wx.request !== 'function') return 'wx.request-unavailable'
    if (wx.request.__automatorNetworkWrapped) return 'already-wrapped'
    const originalRequest = wx.request
    wx.request = function (requestOptions = {}) {
      const startedAt = Date.now()
      const report = payload => {
        void __automatorNetworkRecord({
          url: requestOptions.url,
          method: requestOptions.method || 'GET',
          requestData: requestOptions.data,
          elapsedMs: Date.now() - startedAt,
          ...payload,
        })
      }
      return originalRequest.call(wx, {
        ...requestOptions,
        success(response) {
          report({
            type: 'HTTP_RESPONSE',
            statusCode: response.statusCode,
            data: response.data,
          })
          requestOptions.success?.(response)
        },
        fail(error) {
          report({
            type: 'HTTP_ERROR',
            error: error.errMsg || String(error),
          })
          requestOptions.fail?.(error)
        },
      })
    }
    wx.request.__automatorNetworkWrapped = true
    return 'wrapped'
  }), options.operationTimeoutMs, 'evaluate')
  return { path: page.path, result }
}

await mp.exposeFunction('__automatorNetworkRecord', record => {
  records.push(record)
  if (!options.quiet) printJson({ event: 'network', record })
})

const initial = await installWrapper()
printJson({ event: 'attached', wsEndpoint: options.wsEndpoint, path: initial.path, wrapper: initial.result })

const endAt = Date.now() + options.durationMs
while (Date.now() < endAt) {
  await new Promise(resolve => setTimeout(resolve, Math.min(500, endAt - Date.now())))
  if (Date.now() >= endAt) break
  try {
    // Re-install after page/context recreation; the in-page marker avoids duplicate wrapping.
    await installWrapper()
  } catch {
    // A navigation in progress can make one poll fail; the next poll retries.
  }
}

if (options.output) {
  const outputPath = path.resolve(options.output)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

printJson({ event: 'summary', count: records.length, output: options.output ? path.resolve(options.output) : null })
await mp.disconnect()

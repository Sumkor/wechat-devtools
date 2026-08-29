#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222'
const DEFAULT_TARGET_TYPES = new Set(['page', 'webview', 'iframe', 'worker', 'service_worker', 'other'])
const SENSITIVE_HEADER = /(authorization|cookie|token|secret|api[-_]?key|share[-_]?code|phone|mobile|ticket)/i
const PHONE_NUMBER = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const EMBEDDED_TOKEN = /\btoken\/[A-Za-z0-9._~+-]+/gi

function usage() {
  console.error(`Usage:
  node capture-cdp-network.mjs [options]

Options:
  --cdp-endpoint <url>       CDP HTTP endpoint (default: http://127.0.0.1:9222)
  --cdp-port <port>          Shorthand for http://127.0.0.1:<port>
  --url-contains <text>      Match response URL by substring (required for capture unless --url-regex is used)
  --url-regex <pattern>      Match response URL by JavaScript regular expression
  --method <method>          Match request method, for example POST
  --target-type <csv>        Candidate target types (default: page,webview,iframe,worker,service_worker,other)
  --target-title-contains <text>
                             Only attach targets whose title contains text
  --duration-ms <ms>         Capture window after targets are ready (default: 30000)
  --max-body-bytes <bytes>   Maximum response body retained (default: 200000; max: 2000000)
  --output <file>            Write the sanitized capture as JSON
  --list-targets             Only list eligible targets; do not enable Network
  --quiet                    Print only the final result
  --help                     Show this help

The script only attaches listeners. Start it before performing the page action with
miniprogram-automator. Output is redacted by default.`)
}

function parseArgs(argv) {
  const options = {
    cdpEndpoint: DEFAULT_CDP_ENDPOINT,
    urlContains: '',
    urlRegex: null,
    method: '',
    targetTypes: new Set(DEFAULT_TARGET_TYPES),
    targetTitleContains: '',
    durationMs: 30000,
    maxBodyBytes: 200000,
    output: null,
    listTargets: false,
    quiet: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--list-targets') {
      options.listTargets = true
      continue
    }
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    const value = argv[++index]
    if (value == null) throw new Error(`Missing value for ${arg}`)
    if (arg === '--cdp-endpoint') options.cdpEndpoint = value
    else if (arg === '--cdp-port') options.cdpEndpoint = `http://127.0.0.1:${value}`
    else if (arg === '--url-contains') options.urlContains = value
    else if (arg === '--url-regex') options.urlRegex = new RegExp(value)
    else if (arg === '--method') options.method = value.toUpperCase()
    else if (arg === '--target-type') options.targetTypes = new Set(value.split(',').map(item => item.trim()).filter(Boolean))
    else if (arg === '--target-title-contains') options.targetTitleContains = value
    else if (arg === '--duration-ms') options.durationMs = Number(value)
    else if (arg === '--max-body-bytes') options.maxBodyBytes = Number(value)
    else if (arg === '--output') options.output = value
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('--duration-ms must be a positive number')
  }
  if (!Number.isFinite(options.maxBodyBytes) || options.maxBodyBytes < 1024 || options.maxBodyBytes > 2000000) {
    throw new Error('--max-body-bytes must be between 1024 and 2000000')
  }
  if (!options.listTargets && !options.urlContains && !options.urlRegex) {
    throw new Error('Capture requires --url-contains or --url-regex to minimize collected data')
  }
  const endpoint = new URL(options.cdpEndpoint)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('CDP endpoint must use a loopback host')
  }
  options.cdpEndpoint = endpoint.toString().replace(/\/$/, '')
  return options
}

function emit(value, quiet = false) {
  if (!quiet) process.stdout.write(`${JSON.stringify(value)}\n`)
}

function sanitizeString(value) {
  return String(value)
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(EMBEDDED_TOKEN, 'token/[REDACTED]')
    .replace(PHONE_NUMBER, '[REDACTED_PHONE]')
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, '[REDACTED]')
    }
    return sanitizeString(url.toString())
  } catch {
    return sanitizeString(value)
  }
}

function sanitize(value, key = '') {
  if (isSensitiveKey(key)) return '[REDACTED]'
  if (typeof value === 'string') return sanitizeString(value)
  if (Array.isArray(value)) return value.map(item => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  }
  return value
}

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers || {}).map(([name, value]) => {
    if (SENSITIVE_HEADER.test(name) || isSensitiveKey(name)) return [name, '[REDACTED]']
    if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
      try {
        return [name, JSON.stringify(sanitize(JSON.parse(value)))]
      } catch {
        // Fall through to string redaction for non-JSON header values.
      }
    }
    return [name, typeof value === 'string' ? sanitizeString(value) : sanitize(value)]
  }))
}

function isSensitiveKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized) return false
  if (['authorization', 'proxyauthorization', 'cookie', 'setcookie', 'secret', 'apikey', 'ticket', 'phone', 'phonenumber', 'mobile', 'mobilephone', 'logincode', 'phonecode', 'latitude', 'longitude', 'lat', 'lng', 'lon', 'location', 'coordinate', 'address', 'storeaddress', 'detailaddress'].includes(normalized)) return true
  return normalized.endsWith('token')
    || normalized.endsWith('phonenumber')
    || normalized.endsWith('mobilephone')
    || normalized.endsWith('mobile')
    || normalized.endsWith('phonecode')
    || normalized.endsWith('logincode')
    || normalized.endsWith('sharecode')
    || normalized.endsWith('password')
}

function sanitizePostData(postData) {
  if (typeof postData !== 'string') return postData ?? null
  try {
    return sanitize(JSON.parse(postData))
  } catch {
    return sanitizeString(postData)
  }
}

function isInternalTarget(target) {
  const url = String(target.url || '')
  return /^(devtools|chrome-extension):/i.test(url)
}

function isEligibleTarget(target, options) {
  return Boolean(
    target.webSocketDebuggerUrl
    && options.targetTypes.has(target.type)
    && !isInternalTarget(target)
    && (!options.targetTitleContains || String(target.title || '').includes(options.targetTitleContains))
  )
}

function matchesRequest(request, options) {
  const url = String(request.url || '')
  return Boolean(
    !isInternalRequestUrl(url)
    && (!options.urlContains || url.includes(options.urlContains))
    && (!options.urlRegex || options.urlRegex.test(url))
    && (!options.method || String(request.method || '').toUpperCase() === options.method)
  )
}

function isInternalRequestUrl(value) {
  if (/^(data|blob|devtools|chrome-extension):/i.test(value)) return true
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)
  } catch {
    return false
  }
}

async function getTargets(endpoint) {
  const response = await fetch(`${endpoint}/json/list`)
  if (!response.ok) throw new Error(`CDP /json/list returned HTTP ${response.status}`)
  const targets = await response.json()
  if (!Array.isArray(targets)) throw new Error('CDP /json/list did not return an array')
  return targets
}

class CdpConnection {
  constructor(target, onEvent) {
    this.target = target
    this.onEvent = onEvent
    this.socket = null
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.target.webSocketDebuggerUrl)
      this.socket = socket
      socket.once('open', resolve)
      socket.once('error', reject)
      socket.on('message', data => this.handleMessage(data))
      socket.on('close', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('CDP target connection closed'))
        this.pending.clear()
      })
    })
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP target is not connected'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  handleMessage(data) {
    let message
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'))
      else pending.resolve(message.result || {})
      return
    }
    this.onEvent(this, message)
  }

  close() {
    try {
      this.socket?.terminate()
    } catch {
      // Closing an already detached target is harmless.
    }
  }
}

export async function captureCdpNetwork(options) {
  const targets = (await getTargets(options.cdpEndpoint)).filter(target => isEligibleTarget(target, options))
  if (options.listTargets) {
    return {
      ok: true,
      cdpEndpoint: options.cdpEndpoint,
      targets: targets.map(({ id, type, title, url }) => ({ id, type, title, url: sanitizeUrl(url || '') })),
    }
  }
  if (targets.length === 0) throw new Error('No eligible CDP targets were found')

  const requests = new Map()
  const records = []
  const connections = new Map()
  const pendingBodies = new Set()

  const finishRecord = async (connection, state) => {
    if (state.recorded || !state.response || !state.finished) return
    state.recorded = true
    const task = (async () => {
      let body = null
      let bodyError = null
      let base64Encoded = false
      let byteLength = null
      let truncated = false
      try {
        const result = await connection.send('Network.getResponseBody', { requestId: state.requestId })
        base64Encoded = Boolean(result.base64Encoded)
        const rawBody = String(result.body || '')
        byteLength = Buffer.byteLength(rawBody, 'utf8')
        truncated = byteLength > options.maxBodyBytes
        const retained = truncated ? Buffer.from(rawBody).subarray(0, options.maxBodyBytes).toString('utf8') : rawBody
        if (base64Encoded) body = '[BASE64_RESPONSE_REDACTED]'
        else {
          try {
            body = sanitize(JSON.parse(retained))
          } catch {
            body = sanitizeString(retained)
          }
        }
      } catch (error) {
        bodyError = error.message
      }
      const response = state.response
      const record = {
        capturedAt: new Date().toISOString(),
        target: {
          id: connection.target.id,
          type: connection.target.type || null,
          title: connection.target.title || null,
          url: sanitizeUrl(connection.target.url || ''),
        },
        request: {
          method: state.request.method || null,
          url: sanitizeUrl(state.request.url || ''),
          headers: sanitizeHeaders(state.request.headers),
          postData: sanitizePostData(state.request.postData),
        },
        response: {
          status: response.status ?? null,
          statusText: response.statusText || null,
          mimeType: response.mimeType || null,
          protocol: response.protocol || null,
          headers: sanitizeHeaders(response.headers),
          encodedDataLength: state.encodedDataLength ?? null,
          base64Encoded,
          byteLength,
          truncated,
          bodyError,
          body,
        },
      }
      records.push(record)
      emit({ event: 'response', targetType: record.target.type, method: record.request.method, url: record.request.url, status: record.response.status }, options.quiet)
    })()
    pendingBodies.add(task)
    task.finally(() => pendingBodies.delete(task))
  }

  const onEvent = (connection, message) => {
    const params = message.params || {}
    const key = `${connection.target.id}:${params.requestId}`
    if (message.method === 'Network.requestWillBeSent') {
      if (!matchesRequest(params.request || {}, options)) return
      requests.set(key, {
        requestId: params.requestId,
        request: params.request || {},
        response: null,
        finished: false,
        recorded: false,
      })
      return
    }
    const state = requests.get(key)
    if (!state) return
    if (message.method === 'Network.responseReceived') {
      state.response = params.response || {}
      void finishRecord(connection, state)
    } else if (message.method === 'Network.loadingFinished') {
      state.finished = true
      state.encodedDataLength = params.encodedDataLength ?? null
      void finishRecord(connection, state)
    } else if (message.method === 'Network.loadingFailed') {
      state.recorded = true
      records.push({
        capturedAt: new Date().toISOString(),
        target: { id: connection.target.id, type: connection.target.type || null, title: connection.target.title || null },
        request: { method: state.request.method || null, url: sanitizeUrl(state.request.url || '') },
        failed: sanitizeString(params.errorText || 'loadingFailed'),
      })
    }
  }

  const attachTargets = async candidateTargets => {
    for (const target of candidateTargets) {
      if (!isEligibleTarget(target, options) || connections.has(target.id)) continue
      const connection = new CdpConnection(target, onEvent)
      try {
        await connection.open()
        await connection.send('Network.enable', {
          maxTotalBufferSize: 10000000,
          maxResourceBufferSize: 2000000,
          maxPostDataSize: 200000,
        })
        connections.set(target.id, connection)
        emit({ event: 'target-attached', id: target.id, type: target.type || null, title: target.title || null }, options.quiet)
      } catch {
        connection.close()
      }
    }
  }

  await attachTargets(targets)
  if (connections.size === 0) throw new Error('Eligible targets were found, but Network.enable failed for all of them')

  emit({
    event: 'ready',
    cdpEndpoint: options.cdpEndpoint,
    targets: [...connections.values()].map(connection => ({
      id: connection.target.id,
      type: connection.target.type || null,
      title: connection.target.title || null,
    })),
    durationMs: options.durationMs,
  }, options.quiet)

  const discoveryTimer = setInterval(() => {
    void getTargets(options.cdpEndpoint).then(attachTargets).catch(() => {})
  }, 1000)
  discoveryTimer.unref?.()
  await new Promise(resolve => setTimeout(resolve, options.durationMs))
  clearInterval(discoveryTimer)
  await Promise.allSettled([...pendingBodies])
  for (const connection of connections.values()) connection.close()

  return {
    ok: true,
    cdpEndpoint: options.cdpEndpoint,
    filters: {
      urlContains: options.urlContains || null,
      urlRegex: options.urlRegex?.source || null,
      method: options.method || null,
    },
    targetCount: connections.size,
    matched: records.length,
    records,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await captureCdpNetwork(options)
  if (options.output) {
    const outputPath = path.resolve(options.output)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    result.output = outputPath
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`)
    process.exitCode = 1
  })
}

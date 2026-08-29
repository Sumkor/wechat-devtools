import process from 'node:process'

import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WS_ENDPOINT,
  connectReady,
  withTimeout,
} from './automator-session.mjs'

function parseArgs(argv) {
  const options = {
    endpoint: process.env.AUTOMATOR_ENDPOINT || DEFAULT_WS_ENDPOINT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    includeCommands: false,
    inspectee: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--endpoint') options.endpoint = argv[++index]
    else if (argument === '--timeout-ms') options.timeoutMs = Number(argv[++index])
    else if (argument === '--include-commands') options.includeCommands = true
    else if (argument === '--inspectee') options.inspectee = true
    else throw new Error(`Unknown argument: ${argument}`)
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number')
  }

  const endpoint = new URL(options.endpoint)
  if (!['ws:', 'wss:'].includes(endpoint.protocol)) {
    throw new Error('--endpoint must use ws:// or wss://')
  }
  if (!['127.0.0.1', '::1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('Only loopback Automator endpoints are allowed')
  }

  return options
}

function summarizeProtocols(protocols, includeCommands) {
  const occurrences = new Map()
  for (const protocol of protocols) {
    occurrences.set(protocol.domain, (occurrences.get(protocol.domain) || 0) + 1)
  }

  const result = {
    protocolCount: protocols.length,
    domains: [...occurrences.keys()].sort(),
    domainOccurrences: Object.fromEntries(
      [...occurrences.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    hasTargetDomain: occurrences.has('Target'),
    hasBrowserDomain: occurrences.has('Browser'),
    hasNetworkDomain: occurrences.has('Network'),
    hasRuntimeDomain: occurrences.has('Runtime'),
  }

  if (includeCommands) {
    result.protocols = protocols.map(protocol => ({
      domain: protocol.domain,
      commands: (protocol.commands || []).map(command => command.name),
      events: (protocol.events || []).map(event => event.name),
    }))
  }

  return result
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { mp, page } = await connectReady({
    wsEndpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
  })

  try {
    if (!mp.connection?.send) {
      throw new Error('This miniprogram-automator build does not expose its protocol connection')
    }

    const protocols = await withTimeout(
      mp.connection.send('App.CDPListProtocol', {}),
      options.timeoutMs,
      'App.CDPListProtocol',
    )
    if (!Array.isArray(protocols)) {
      throw new Error('App.CDPListProtocol returned a non-array result')
    }

    const output = {
      endpoint: options.endpoint,
      currentPage: page.path,
      pageId: page.id,
      ...summarizeProtocols(protocols, options.includeCommands),
    }

    if (options.inspectee) {
      await withTimeout(
        mp.connection.send('App.CDPEnable', {}),
        options.timeoutMs,
        'App.CDPEnable',
      )
      const document = await withTimeout(
        mp.connection.send('App.CDPCommand', {
          domain: 'DOM',
          method: 'getDocument',
          params: { depth: 1, pierce: true },
        }),
        options.timeoutMs,
        'DOM.getDocument',
      )
      output.inspectee = {
        name: document?.inspectee || null,
        baseURL: document?.baseURL || null,
        rootNodeName: document?.root?.nodeName || null,
        enabledFeatures: document?.enabledFeatures || [],
      }
    }

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } finally {
    try {
      await mp.disconnect()
    } catch {
      // The runtime may already have closed the protocol connection.
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exitCode = 1
})

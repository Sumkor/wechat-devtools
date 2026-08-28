import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_WS_ENDPOINT = 'ws://127.0.0.1:9420'
export const DEFAULT_TIMEOUT_MS = 15000

export function withTimeout(promise, milliseconds, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timeout after ${milliseconds}ms`)),
      milliseconds,
    )),
  ])
}

export function loadAutomator(cwd = process.cwd()) {
  const locations = [
    path.join(cwd, 'package.json'),
    path.join(rootDir, '..', 'package.json'),
  ]
  let lastError
  for (const location of locations) {
    try {
      return createRequire(location)('miniprogram-automator')
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `Cannot load miniprogram-automator. Run npm install in the automation project `
    + `or wechat-devtools skill directory.\n${lastError?.message || ''}`,
  )
}

export async function connectReady({
  wsEndpoint = DEFAULT_WS_ENDPOINT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = 500,
  automator = loadAutomator(),
} = {}) {
  const mp = await withTimeout(
    automator.connect({ wsEndpoint }),
    timeoutMs,
    'automator.connect',
  )
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const page = await withTimeout(mp.currentPage(), timeoutMs, 'currentPage')
      if (page?.path) return { mp, page }
    } catch {
      // The simulator can be between contexts; continue until the deadline.
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())))
  }
  await mp.disconnect().catch(() => {})
  throw new Error(`Automator connected but no ready page within ${timeoutMs}ms`)
}

export async function currentPageReady(mp, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const page = await withTimeout(mp.currentPage(), timeoutMs, 'currentPage')
  if (!page?.path) throw new Error('currentPage().path is empty')
  return page
}

import type { EngineInterface, Register, Timer } from 'claude-code'

import type { VisualizeStatus } from '../types'

const STATUS = { plugin: 'tachyons-visualize', key: 'status' } as const
const POLL_MS = 5000
// The skill's own commands and screen writes all name one of these.
const TOUCHES = /tachyons-visualize|\.tachyons\/visualize/

const s = {
  cwd: '',
  sessionDir: undefined as string | undefined,
  timer: undefined as Timer | undefined,
  published: '',
}

const OFF: VisualizeStatus = { isRunning: false, screens: 0, clicks: 0 }

export async function probe($: EngineInterface, dir: string): Promise<VisualizeStatus> {
  const off = { ...OFF, sessionDir: dir }
  const raw = await $.fs.read(`${dir}/state/server-info`).catch(() => undefined)
  if (raw === undefined) return off
  let info: { pid?: number; port?: number; url?: string }
  try {
    info = JSON.parse(raw)
  } catch {
    return off
  }
  // A killed server leaves its info file behind, so ask whether the pid still lives.
  if (!info.pid) return off
  const isAlive = await $.process.run(['kill', '-0', String(info.pid)]).then(r => r.exitCode === 0, () => false)
  if (!isAlive) return off

  const entries = await $.fs.list(`${dir}/content`).catch(() => [])
  const screens = entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.html'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const newest = screens[0]?.name
  const events = await $.fs.read(`${dir}/state/events`).catch(() => '')
  const clicks = newest ? events.split('\n').filter(l => l.includes(`"screen":"${newest}"`)).length : 0

  return {
    isRunning: true,
    sessionDir: dir,
    port: info.port,
    url: info.url,
    screen: newest?.replace(/\.html$/, ''),
    screens: screens.length,
    clicks,
  }
}

async function refresh($: EngineInterface) {
  const status = await probe($, s.sessionDir ?? `${s.cwd}/.tachyons/visualize/current`)
  const json = JSON.stringify(status)
  if (json !== s.published) {
    s.published = json
    await $.state.set(STATUS, JSON.parse(json)).catch(() => {})
  }
  // Poll only while a server runs: it can idle out or be killed behind our back.
  if (status.isRunning && !s.timer) s.timer = $.clock.every(POLL_MS, () => void refresh($))
  if (!status.isRunning && s.timer) {
    s.timer.cancel()
    s.timer = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    s.cwd = e.cwd
    s.published = ''
    // $.state outlives a reload, so a session started elsewhere is still known.
    const { value: was } = await $.state.get(STATUS)
    s.sessionDir = was?.sessionDir
    await refresh($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (TOUCHES.test(e.command)) {
      const out = ran.deny === undefined && !ran.isError ? ran.result.stdout : ''
      const dir = /"session_dir":"([^"]+)"/.exec(out)?.[1]
      if (dir) s.sessionDir = dir
      await refresh($)
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (TOUCHES.test(e.file_path)) await refresh($)
    return ran
  })
}

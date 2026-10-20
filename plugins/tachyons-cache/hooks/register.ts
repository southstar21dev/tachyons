import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheStatus } from '../types'

const PROMPT = 'Cache keep-alive ping. Reply with the single word: ok'

const s = {
  intervalMs: 270_000,
  maxPings: 12,
  isEnabled: true,
  isBusy: false,
  pings: 0,
  timer: undefined as Timer | undefined,
  nextAt: undefined as number | undefined,
  lastAt: undefined as number | undefined,
  lastReadTokens: undefined as number | undefined,
  lastError: undefined as string | undefined,
}

function publish($: EngineInterface) {
  const status: CacheStatus = {
    isEnabled: s.isEnabled,
    isBusy: s.isBusy,
    pings: s.pings,
    maxPings: s.maxPings,
    intervalMs: s.intervalMs,
    nextAt: s.nextAt,
    lastAt: s.lastAt,
    lastReadTokens: s.lastReadTokens,
    lastError: s.lastError,
  }
  void $.state.set({ plugin: 'tachyons-cache', key: 'status' }, JSON.parse(JSON.stringify(status))).catch(() => {})
}

function stop() {
  s.timer?.cancel()
  s.timer = undefined
  s.nextAt = undefined
}

function schedule($: EngineInterface) {
  stop()
  if (s.isEnabled && s.pings < s.maxPings) {
    s.nextAt = Date.now() + s.intervalMs
    s.timer = $.clock.after(s.intervalMs, () => void ping($))
  }
  publish($)
}

async function ping($: EngineInterface) {
  s.timer = undefined
  s.nextAt = undefined
  if (s.isBusy || !s.isEnabled) return
  s.pings += 1
  const r = await $.model.fork({ prompt: PROMPT })
  if (s.isBusy) return
  s.lastAt = Date.now()
  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    $.ui.status(undefined)
    publish($)
    return
  }
  if (!r.isAnswered && r.reason === 'api-error') {
    s.lastError = `ping failed (${r.status})`
    $.ui.status(`cache: ${s.lastError}`)
    publish($)
    return
  }
  s.lastError = undefined
  s.lastReadTokens = r.usage?.cache_read_input_tokens ?? 0
  const read = Math.round(s.lastReadTokens / 1000)
  $.ui.status(
    s.pings >= s.maxPings
      ? `cache: warmed ${s.pings}x, stopped`
      : `cache warm · ${read}k read · ${s.pings}/${s.maxPings}`,
  )
  schedule($)
}

export const register: Register = (on, options) => {
  s.intervalMs = Math.max(30, Number(options.intervalSeconds ?? 270)) * 1000
  s.maxPings = Math.max(1, Number(options.maxPings ?? 12))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tachyons-cache',
      description: 'Cache keep-alive: on, off, or status',
    })
    // $.state outlives a reload, so an earlier /tachyons-cache off still holds.
    const { value: was } = await $.state.get({ plugin: 'tachyons-cache', key: 'status' })
    if (was) s.isEnabled = was.isEnabled
    publish($)
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      s.isBusy = true
      s.pings = 0
      stop()
      publish($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      s.isBusy = false
      if (s.isEnabled) $.ui.status('cache: idle, warming')
      schedule($)
    }
    return result
  })

  on('command.run', { command: 'tachyons-cache' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const every = `every ${s.intervalMs / 1000}s while idle`
    if (arg === 'off') {
      s.isEnabled = false
      stop()
      publish($)
      $.ui.status(undefined)
      return { text: 'Cache keep-alive off.' }
    }
    if (arg === 'on') {
      s.isEnabled = true
      s.pings = 0
      if (s.isBusy) publish($)
      else schedule($)
      return { text: `Cache keep-alive on: a ping ${every}, up to ${s.maxPings}.` }
    }
    return {
      text: `Cache keep-alive is ${s.isEnabled ? 'on' : 'off'}: ${every}, ${s.pings}/${s.maxPings} pings this stretch.`,
    }
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { AgentRow, FileChange, LimitRow, UsageSnap } from '../types'
import { CRAB_ROWS, OUTFITS, activityOf, crabCells, toBase64 } from './crab'
import type { CrabFrame } from './crab'
import { INK, cellsOf, hex, paintCentered, paintPixels, span, widthOf } from './canvas'
import { LOGO_24, LOGO_COLORS } from './logo'
import type { Line } from './canvas'

const PANE = 'tachyons-sidebar'
const TITLE = 'Session'
// The logo's half-block rows, the southstar21.dev line under it, and a blank row at the bottom.
const LOGO_ROWS = LOGO_24.length / 2 + 2
const WIDTH = 34
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'spend' }
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 60_000

/** `seven_day_fable` reads `7d fable`; kinds without a name of their own are spelled out. */
export function limitLabel(kind: string): string {
  const known = LIMIT_NAMES[kind]
  if (known) return known
  const weekly = /^seven_day_(.+)$/.exec(kind)
  return weekly ? `7d ${weekly[1]!.replace(/_/g, ' ')}` : kind.replace(/_/g, ' ')
}

/** Every `{ utilization, resets_at }` window in the usage endpoint's answer, the 5-hour and 7-day first. */
export function parseUsage(body: string): LimitRow[] {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  if (typeof data !== 'object' || data === null) return []
  const rows: LimitRow[] = []
  for (const [kind, v] of Object.entries(data)) {
    if (typeof v !== 'object' || v === null) continue
    const { utilization, resets_at } = v as { utilization?: unknown; resets_at?: unknown }
    if (typeof utilization !== 'number') continue
    rows.push({
      kind,
      percentUsed: Math.round(utilization * 10) / 10,
      ...(typeof resets_at === 'string' ? { resetsAt: resets_at } : {}),
    })
  }
  // Model-scoped weekly windows (Fable, ...) are only in the `limits` list.
  const list = (data as { limits?: unknown }).limits
  for (const item of Array.isArray(list) ? list : []) {
    const { kind, percent, resets_at, scope } = (item ?? {}) as {
      kind?: unknown
      percent?: unknown
      resets_at?: unknown
      scope?: { model?: { display_name?: unknown } | null } | null
    }
    const model = scope?.model?.display_name
    if (kind !== 'weekly_scoped' || typeof percent !== 'number' || typeof model !== 'string') continue
    const key = `seven_day_${model.toLowerCase().replace(/\s+/g, '_')}`
    if (rows.some(r => r.kind === key)) continue
    rows.push({ kind: key, percentUsed: percent, ...(typeof resets_at === 'string' ? { resetsAt: resets_at } : {}) })
  }
  const rank = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2)
  return rows.sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** The polled windows laid over the ones the last reply reported. */
export function mergeLimits(reported: LimitRow[], polled: LimitRow[]): LimitRow[] {
  const byKind = new Map(reported.map(l => [l.kind, l]))
  for (const l of polled) byKind.set(l.kind, l)
  return [...byKind.values()]
}

const files = atom({ plugin: 'tachyons-sidebar', key: 'files' } as const, [])
const agents = atom({ plugin: 'tachyons-sidebar', key: 'agents' } as const, [])
const usage = atom({ plugin: 'tachyons-sidebar', key: 'usage' } as const, null)
const stats = atom({ plugin: 'tachyons-sidebar', key: 'stats' } as const, { tools: 0, turns: 0, startedAt: 0 })

export function snapOf(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): UsageSnap {
  return {
    contextTokens: context.tokens,
    contextWindow: context.window,
    contextPercent: context.percent,
    limits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    costUsd: cost?.usd,
  }
}

/** Filled and empty parts of a thin meter with a half-cell end, `width` cells in all. */
export function meter(percent: number, width: number): [string, string] {
  const cells = (Math.min(100, Math.max(0, percent)) / 100) * width
  const whole = Math.floor(cells)
  const filled = '━'.repeat(whole) + (whole < width && cells - whole >= 0.5 ? '╸' : '')
  return [filled, '─'.repeat(Math.max(0, width - filled.length))]
}

// A meter's fill runs from calm to hot along its length, so a fuller meter ends redder.
const HEAT: [number, number][] = [
  [0, 0x4fb37a],
  [0.5, 0x9fb447],
  [0.7, 0xd9a03a],
  [0.85, 0xe0703f],
  [1, 0xe5484d],
]

/** The meter's color at `p` (0..1) along it. */
export function heat(p: number): number {
  const x = Math.min(1, Math.max(0, p))
  let i = 0
  while (i < HEAT.length - 2 && x > HEAT[i + 1]![0]) i++
  const [x0, c0] = HEAT[i]!
  const [x1, c1] = HEAT[i + 1]!
  const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
  const ch = (shift: number) => Math.round(((c0 >> shift) & 0xff) + (((c1 >> shift) & 0xff) - ((c0 >> shift) & 0xff)) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function clockTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function resetLabel(iso?: string): string {
  const at = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(at)) return ''
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return at - Date.now() < 86_400_000 ? `resets ${hm}` : `resets ${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export function shortPath(path: string, cwd: string): string {
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  const parts = path.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

/** A path split into a dim folder part and a bright name, cut from the left to fit. */
function splitPath(path: string, width: number): [string, string] {
  const cut = path.lastIndexOf('/')
  let dir = cut >= 0 ? path.slice(0, cut + 1) : ''
  const name = cut >= 0 ? path.slice(cut + 1) : path
  if (name.length > width) return ['', '…' + name.slice(name.length - width + 1)]
  if (dir.length + name.length > width) {
    const room = width - name.length - 1
    dir = room > 0 ? '…' + dir.slice(dir.length - room) : ''
  }
  return [dir, name]
}

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text
}

const AGENT_GLYPH: Record<string, [string, number]> = {
  pending: ['○', INK.muted],
  running: ['◐', INK.claude],
  waiting: ['◑', INK.warning],
  idle: ['◌', INK.muted],
  completed: ['✓', INK.success],
  failed: ['✗', INK.error],
  killed: ['✗', INK.error],
}

// The crab lives in the module and is repainted by blits, never by state. Its one
// timer runs only while a turn does, once a second: the caption's clock and a blink.
const crab = {
  isWorking: false,
  mode: 'requesting',
  /** The tool the main conversation is running now, if any: it picks Clawd's hat and tool. */
  tool: undefined as string | undefined,
  turnStartedAt: 0,
  tick: 0,
  columns: 0,
  timer: undefined as Timer | undefined,
}
let hasActiveAgents = false
// The windows the usage endpoint last reported: they outlive a turn's own reading.
const poll = { limits: [] as LimitRow[], at: 0, failures: 0, ticks: 0, isBusy: false }

/** Asks the usage endpoint for every window, so the meters move between turns. */
async function refreshLimits($: EngineInterface) {
  if (poll.isBusy) return
  poll.isBusy = true
  try {
    const auth = await $.session.authorize()
    if (!auth) return
    const res = await $.http.fetch(USAGE_URL, {
      headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      auth: auth.handle,
    })
    const rows = res.ok ? parseUsage(res.text) : []
    if (rows.length === 0) {
      poll.failures++
      return
    }
    poll.failures = 0
    poll.limits = rows
    poll.at = Date.now()
    await update($, usage, u => ({
      contextWindow: 0,
      ...u,
      limits: mergeLimits(u?.limits ?? [], rows),
      polledAt: poll.at,
    }))
  } catch {
    poll.failures++
  } finally {
    poll.isBusy = false
  }
}

function crabFrame(): CrabFrame {
  const activity = activityOf(crab.isWorking, crab.mode, crab.tool)
  const word = OUTFITS[activity].word
  if (!crab.isWorking) return { mood: 'sleeping', isBlinking: false, caption: word, activity, tick: crab.tick }
  const caption = `${word}… ${duration(Date.now() - crab.turnStartedAt)}`
  return { mood: 'awake', isBlinking: crab.tick % 5 === 4, caption, activity, tick: crab.tick }
}

function paintCrab($: EngineInterface) {
  if (crab.columns === 0) return
  const cells = toBase64(crabCells(crabFrame(), crab.columns))
  void $.ui.blit({ requestId: PANE, key: 'crab', cells, columns: crab.columns, rows: CRAB_ROWS }).catch(() => {})
}

function wake($: EngineInterface) {
  crab.isWorking = true
  crab.mode = 'requesting'
  crab.tool = undefined
  crab.turnStartedAt = Date.now()
  crab.tick = 0
  crab.timer?.cancel()
  crab.timer = $.clock.every(1000, () => {
    crab.tick++
    paintCrab($)
  })
  paintCrab($)
}

function sleep($: EngineInterface) {
  crab.isWorking = false
  crab.tool = undefined
  crab.timer?.cancel()
  crab.timer = undefined
  paintCrab($)
}

async function syncAgents($: EngineInterface) {
  const live = await $.agent.list()
  if (live.length === 0) return
  await update($, agents, list => {
    const byId = new Map(list.map(a => [a.id, a]))
    let changed = false
    for (const a of live) {
      const row: AgentRow = { id: a.id, type: a.type, description: a.description, status: a.status }
      const old = byId.get(a.id)
      if (!old || old.status !== row.status || old.description !== row.description) {
        byId.set(a.id, row)
        changed = true
      }
    }
    return changed ? [...byId.values()] : list
  })
  hasActiveAgents = live.some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
}

export const register: Register = on => {
  let cwd = ''

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({ name: 'tachyons-sidebar', description: 'Toggle the session sidebar (context, limits, files, agents)' })

    const now = await $.session.usage()
    await update($, usage, () => snapOf(now.context, now.rateLimits, now.cost))
    void refreshLimits($)
    await update($, stats, s => (s.startedAt ? s : { ...s, startedAt: now.startedAt }))

    // Agents are polled only while something could change them.
    $.clock.every(5000, () => {
      if (crab.isWorking || hasActiveAgents) void syncAgents($)
    })
    // Limits are polled in the background, backing off while the endpoint refuses.
    $.clock.every(POLL_MS, () => {
      poll.ticks++
      if (poll.ticks % (1 << Math.min(poll.failures, 4)) === 0) void refreshLimits($)
    })
    void $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })

    return next(e)
  })

  on('command.run', { command: 'tachyons-sidebar' }, async $ => {
    const isUp = (await $.ui.panes()).some(p => p.id === PANE)
    if (isUp) {
      await $.ui.close({ id: PANE })
      return { text: 'Session sidebar closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })
    return { text: 'Session sidebar opened.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, u => {
      const snap = snapOf(e.context, e.rateLimits, e.cost)
      return { ...snap, limits: mergeLimits(snap.limits, poll.limits), polledAt: u?.polledAt }
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      wake($)
      await update($, stats, s => ({ ...s, turns: s.turns + 1 }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      sleep($)
      void syncAgents($)
      void refreshLimits($)
    }
    return next(e)
  })

  // The spinner says what the turn is doing; Clawd dresses for it.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (crab.mode !== e.props.mode) {
      crab.mode = e.props.mode
      paintCrab($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // The main conversation's tool picks Clawd's outfit while it runs.
    const isMain = !e.agentId && crab.isWorking
    if (isMain) {
      crab.tool = e.tool
      paintCrab($)
    }
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      if (isMain && crab.tool === e.tool) {
        crab.tool = undefined
        paintCrab($)
      }
    }
    await update($, stats, s => ({ ...s, tools: s.tools + 1 }))

    if (EDIT_TOOLS.has(e.tool) && ran.deny === undefined && !ran.isError) {
      const raw = e as unknown as { file_path?: string; notebook_path?: string }
      const path = raw.file_path ?? raw.notebook_path
      if (path) {
        await update($, files, list => {
          const old = list.find(f => f.path === path)
          const entry: FileChange = {
            path,
            edits: (old?.edits ?? 0) + 1,
            isNew: old ? old.isNew : e.tool === 'Write',
            at: Date.now(),
          }
          return [entry, ...list.filter(f => f.path !== path)].slice(0, 200)
        })
      }
    }
    if (e.tool === 'Agent') void syncAgents($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const width = Math.max(18, e.props.bodyColumns)
    const u = await read($, usage)
    const fileList = await read($, files)
    const agentList = await read($, agents)
    const s = await read($, stats)
    const { value: cache } = await $.state.get({ plugin: 'tachyons-cache', key: 'status' })
    const { value: viz } = await $.state.get({ plugin: 'tachyons-visualize', key: 'status' })
    const isVisualizing = viz?.isRunning === true
    const bodyRows = Math.max(8, e.props.scroll.bodyRows)

    const pct =
      u?.contextPercent ?? (u?.contextTokens && u.contextWindow ? (u.contextTokens / u.contextWindow) * 100 : undefined)
    const active = agentList.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    const totalEdits = fileList.reduce((n, f) => n + f.edits, 0)
    const fixedRows = CRAB_ROWS + 16 + (u?.limits.length ?? 0) * 2 + 1 + LOGO_ROWS + (cache ? 4 : 0) + (isVisualizing ? 4 : 0)
    const spare = Math.max(2, bodyRows - fixedRows)
    const agentRoom = Math.min(agentList.length, Math.max(1, Math.floor(spare / 2)))
    const fileRoom = Math.max(1, spare - agentRoom)

    const lines: Line[] = []
    const blank = () => lines.push([])
    // `◉ TITLE ──────── meta`: the rule fills the row and the figure sits at its right end.
    const heading = (icon: string, title: string, meta?: string) => {
      const head: Line = [span(`${icon} `, INK.claude), span(title.toUpperCase())]
      const tail = meta ? ` ${meta}` : ''
      head.push(span(' ' + '─'.repeat(Math.max(1, width - widthOf(head) - tail.length - 1)), INK.faint))
      if (meta) head.push(span(tail, INK.muted))
      lines.push(head)
    }
    const meterLine = (percent: number, cells: number): Line => {
      const [full, empty] = meter(percent, cells)
      const line: Line = [...full].map((ch, i) => span(ch, heat(i / Math.max(1, cells - 1))))
      line.push(span(empty, INK.faint))
      return line
    }
    // A row with `left` against the left edge and `right` against the right one.
    const spread = (left: Line, right: Line): Line => [
      ...left,
      span(' '.repeat(Math.max(1, width - widthOf(left) - widthOf(right)))),
      ...right,
    ]

    blank()
    heading('◉', 'Context', pct === undefined ? undefined : `${Math.round(pct)}%`)
    if (pct === undefined) lines.push([span('waiting for the first reply', INK.muted)])
    else {
      lines.push(meterLine(pct, width))
      lines.push([
        span(compact(u?.contextTokens ?? 0)),
        span(` of ${compact(u?.contextWindow ?? 0)} tokens`, INK.muted),
      ])
    }

    blank()
    heading('◷', 'Limits')
    if (!u || u.limits.length === 0) lines.push([span('waiting for the first reply', INK.muted)])
    const labelWidth = Math.min(10, Math.max(7, ...(u?.limits ?? []).map(l => limitLabel(l.kind).length + 1)))
    for (const l of u?.limits ?? []) {
      const label = fit(limitLabel(l.kind), labelWidth - 1).padEnd(labelWidth)
      const pctText = `${Math.round(l.percentUsed)}%`.padStart(5)
      lines.push([
        span(label, INK.muted),
        ...meterLine(l.percentUsed, Math.max(4, width - label.length - pctText.length)),
        span(pctText, l.percentUsed >= 85 ? INK.error : l.percentUsed >= 60 ? INK.warning : INK.text),
      ])
      if (l.resetsAt) lines.push([span(' '.repeat(label.length)), span('↻ ', INK.faint), span(resetLabel(l.resetsAt), INK.faint)])
    }
    if (u?.polledAt) lines.push([span(`refreshed ${clockTime(u.polledAt)}`, INK.faint)])
    if (u?.costUsd !== undefined) lines.push([span(`$${u.costUsd.toFixed(2)}`), span(' spent this session', INK.muted)])

    if (cache) {
      blank()
      heading('↻', 'Cache', cache.isEnabled ? `${cache.pings}/${cache.maxPings} pings` : 'off')
      if (!cache.isEnabled) lines.push([span('keep-alive off', INK.muted)])
      else if (cache.isBusy) lines.push([span('turn running, cache in use', INK.muted)])
      else if (cache.lastError) lines.push([span(cache.lastError, INK.error)])
      else if (cache.nextAt) {
        const line: Line = [span('● ', INK.success), span('warm', INK.success)]
        if (cache.lastReadTokens) line.push(span(` · ${compact(cache.lastReadTokens)} read`, INK.muted))
        line.push(span(` · next ${clockTime(cache.nextAt)}`, INK.muted))
        lines.push(line)
      } else if (cache.pings >= cache.maxPings) lines.push([span('○ ', INK.warning), span('stopped, idle too long', INK.muted)])
      else lines.push([span('waiting for the first reply', INK.muted)])
    }

    if (viz && isVisualizing) {
      blank()
      heading('◈', 'Visualize', viz.port ? `:${viz.port}` : undefined)
      lines.push([span('● ', INK.success), span('live', INK.success), span(` · ${fit(viz.screen ?? 'waiting', width - 9)}`, INK.muted)])
      lines.push([
        span(`${viz.screens}`),
        span(` screen${viz.screens === 1 ? '' : 's'} · `, INK.muted),
        span(`${viz.clicks}`),
        span(` click${viz.clicks === 1 ? '' : 's'}`, INK.muted),
      ])
    }

    blank()
    heading('✎', 'Files', fileList.length ? `${fileList.length} · ${totalEdits} edits` : undefined)
    if (fileList.length === 0) lines.push([span('nothing changed yet', INK.muted)])
    for (const f of fileList.slice(0, fileRoom)) {
      const count = f.edits > 1 ? `×${f.edits}` : ''
      const [dir, name] = splitPath(shortPath(f.path, cwd), width - 2 - (count ? count.length + 1 : 0))
      lines.push(
        spread(
          [span(f.isNew ? '+ ' : '~ ', f.isNew ? INK.success : INK.warning), span(dir, INK.faint), span(name)],
          [span(count, INK.muted)],
        ),
      )
    }
    if (fileList.length > fileRoom) lines.push([span(`  … ${fileList.length - fileRoom} more`, INK.faint)])

    blank()
    heading('◇', 'Agents', agentList.length ? `${agentList.length} · ${active} active` : undefined)
    if (agentList.length === 0) lines.push([span('none spawned yet', INK.muted)])
    for (const a of agentList.slice(-agentRoom)) {
      const [glyph, color] = AGENT_GLYPH[a.status] ?? ['?', INK.muted]
      lines.push([
        span(`${glyph} `, color),
        span(a.type, INK.claude),
        span(` ${fit(a.description, Math.max(1, width - a.type.length - 3))}`, INK.muted),
      ])
    }
    if (agentList.length > agentRoom) lines.push([span(`  … ${agentList.length - agentRoom} earlier`, INK.faint)])

    blank()
    lines.push([span('─'.repeat(width), INK.faint)])
    lines.push(
      spread(
        [span(`${s.turns}`), span(` turn${s.turns === 1 ? '' : 's'} · `, INK.muted), span(`${s.tools}`), span(` tool${s.tools === 1 ? '' : 's'}`, INK.muted)],
        s.startedAt ? [span('◷ ', INK.claude), span(duration(Date.now() - s.startedAt), INK.muted)] : [],
      ),
    )

    if (e.surface === 'terminal') {
      const { Box, Raster } = $.ui.resolve(e)
      crab.columns = width
      // Fill every row of the body so the dock's tint never shows through.
      const statsRows = Math.min(256, Math.max(lines.length, bodyRows - CRAB_ROWS))
      const cells = cellsOf(lines, width, statsRows)
      // The logo sits at the bottom centre, where the body has room under the stats.
      const logoTop = statsRows - LOGO_ROWS
      if (logoTop > lines.length) {
        paintPixels(cells, width, LOGO_24, LOGO_COLORS, logoTop)
        paintCentered(cells, width, logoTop + LOGO_24.length / 2, 'southstar21.dev', LOGO_COLORS.r!)
      }
      return (
        <Box flexDirection="column">
          <Raster key="crab" columns={width} rows={CRAB_ROWS} cells={toBase64(crabCells(crabFrame(), width))} />
          <Raster key="stats" columns={width} rows={statsRows} cells={toBase64(cells)} />
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="claude">{crab.isWorking ? `(\\/)(°,,,°)(\\/)  ${crabFrame().caption}` : '(\\/)(-,,,-)(\\/)  zzz'}</Text>
        {lines.map(line => (
          <Text wrap="truncate-end">
            {line.length === 0 ? ' ' : line.map(part => <Text color={hex(part.color)}>{part.text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { AgentRow, FileChange, UsageSnap } from '../types'
import { CRAB_ROWS, crabCells, toBase64 } from './crab'
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
const MODE_WORDS: Record<string, string> = {
  requesting: 'thinking',
  thinking: 'pondering',
  responding: 'writing',
  'tool-input': 'planning',
  'tool-use': 'crafting',
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

/** Filled and empty halves of a meter, `width` cells in all. */
export function meter(percent: number, width: number): [string, string] {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return ['━'.repeat(filled), '╌'.repeat(Math.max(0, width - filled))]
}

function level(percent: number): number {
  return percent >= 85 ? INK.error : percent >= 60 ? INK.warning : INK.claude
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
  turnStartedAt: 0,
  tick: 0,
  columns: 0,
  timer: undefined as Timer | undefined,
}
let hasActiveAgents = false

function crabFrame(): CrabFrame {
  if (!crab.isWorking) return { mood: 'sleeping', isBlinking: false, caption: 'napping' }
  const caption = `${MODE_WORDS[crab.mode] ?? 'working'}… ${duration(Date.now() - crab.turnStartedAt)}`
  return { mood: 'awake', isBlinking: crab.tick % 5 === 4, caption }
}

function paintCrab($: EngineInterface) {
  if (crab.columns === 0) return
  const cells = toBase64(crabCells(crabFrame(), crab.columns))
  void $.ui.blit({ requestId: PANE, key: 'crab', cells, columns: crab.columns, rows: CRAB_ROWS }).catch(() => {})
}

function wake($: EngineInterface) {
  crab.isWorking = true
  crab.mode = 'requesting'
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
    await update($, stats, s => (s.startedAt ? s : { ...s, startedAt: now.startedAt }))

    // Agents are polled only while something could change them.
    $.clock.every(5000, () => {
      if (crab.isWorking || hasActiveAgents) void syncAgents($)
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
    await update($, usage, () => snapOf(e.context, e.rateLimits, e.cost))
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
    }
    return next(e)
  })

  // The spinner says what the turn is doing; the caption names it.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    crab.mode = e.props.mode
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
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
    const fixedRows = CRAB_ROWS + 16 + (u?.limits.length ?? 0) * 2 + LOGO_ROWS + (cache ? 4 : 0) + (isVisualizing ? 4 : 0)
    const spare = Math.max(2, bodyRows - fixedRows)
    const agentRoom = Math.min(agentList.length, Math.max(1, Math.floor(spare / 2)))
    const fileRoom = Math.max(1, spare - agentRoom)

    const lines: Line[] = []
    const blank = () => lines.push([])
    const heading = (icon: string, title: string, meta?: string) => {
      const head: Line = [span(`${icon} `, INK.claude), span(title.toUpperCase())]
      if (meta) head.push(span(` ${meta}`, INK.muted))
      head.push(span(' ' + '─'.repeat(Math.max(0, width - widthOf(head) - 1)), INK.faint))
      lines.push(head)
    }
    const meterLine = (percent: number, cells: number): Line => {
      const [full, empty] = meter(percent, cells)
      return [span(full, level(percent)), span(empty, INK.faint)]
    }

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
    for (const l of u?.limits ?? []) {
      const label = (LIMIT_NAMES[l.kind] ?? l.kind).padEnd(7)
      const pctText = `${Math.round(l.percentUsed)}%`.padStart(5)
      lines.push([
        span(label, INK.muted),
        ...meterLine(l.percentUsed, Math.max(4, width - label.length - pctText.length)),
        span(pctText),
      ])
      if (l.resetsAt) lines.push([span(' '.repeat(label.length) + resetLabel(l.resetsAt), INK.faint)])
    }
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
      const count = f.edits > 1 ? ` ×${f.edits}` : ''
      const [dir, name] = splitPath(shortPath(f.path, cwd), width - 2 - count.length)
      lines.push([
        span(f.isNew ? '+ ' : '~ ', f.isNew ? INK.success : INK.warning),
        span(dir, INK.muted),
        span(name),
        span(count, INK.muted),
      ])
    }
    if (fileList.length > fileRoom) lines.push([span(`  +${fileList.length - fileRoom} more`, INK.muted)])

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
    if (agentList.length > agentRoom) lines.push([span(`  +${agentList.length - agentRoom} earlier`, INK.muted)])

    blank()
    lines.push([span('─'.repeat(width), INK.faint)])
    lines.push([
      span(`${s.turns} turns · ${s.tools} tools${s.startedAt ? ` · ${duration(Date.now() - s.startedAt)}` : ''}`, INK.muted),
    ])

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
        <Text color="claude">{crab.isWorking ? '(\\/)(°,,,°)(\\/)  working…' : '(\\/)(-,,,-)(\\/)  zzz'}</Text>
        {lines.map(line => (
          <Text wrap="truncate-end">
            {line.length === 0 ? ' ' : line.map(part => <Text color={hex(part.color)}>{part.text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })
}

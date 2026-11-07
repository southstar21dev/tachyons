import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentProgress, CiProgress, CommandProgress } from '../types'
import {
  ciRunIdOf,
  ffmpegInputOf,
  kindOf,
  labelOf,
  median,
  parseFfmpegProgress,
  parseGhRun,
  parseTaskNotification,
  shortCommand,
  withProgressFile,
} from './commands'
import { clock, duration, fit, remaining } from './format'

const COMMAND = 'tachyons-progress'
// A finished row stays this long, so the person sees it end.
const LINGER_MS = 8000
const HISTORY_KEY = 'history'
const HISTORY_KEEP = 8
const MAX_ROWS = 8
const METER = 12
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const agents = atom({ plugin: 'tachyons-progress', key: 'agents' } as const, [])
const commands = atom({ plugin: 'tachyons-progress', key: 'commands' } as const, [])
const isHidden = atom({ plugin: 'tachyons-progress', key: 'isHidden' } as const, false)
const now = atom({ plugin: 'tachyons-progress', key: 'now' } as const, 0)

type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** One row of the band, its columns already cut to width. */
export type Row = {
  glyph: Span
  name: string
  detail: string
  /** 0..1 while something says how far; undefined draws no meter. */
  fraction?: number
  /** The short figure beside the meter: `64%`, `3/7`, `done`. */
  stat: Span
  info: Span[]
}

const SPINNER = ['◜', '◠', '◝', '◞', '◡', '◟']
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const STATUS_GLYPH: Record<string, [string, string]> = {
  pending: ['○', 'subtle'],
  waiting: ['◔', 'warning'],
  idle: ['◌', 'subtle'],
  completed: ['✓', 'success'],
  failed: ['✗', 'error'],
  killed: ['✗', 'error'],
}
const JOB_GLYPH: Record<string, [string, string]> = {
  queued: ['○', 'subtle'],
  running: ['◐', 'claude'],
  done: ['✓', 'success'],
  failed: ['✗', 'error'],
  skipped: ['–', 'subtle'],
}

/** A meter `width` cells wide with eighth-block ends: the filled and the empty part. */
export function blocks(fraction: number, width: number): [string, string] {
  const f = Math.min(1, Math.max(0, fraction))
  const cells = f * width
  const whole = Math.floor(cells)
  const part = EIGHTHS[Math.round((cells - whole) * 8) % 8] ?? ''
  const filled = '█'.repeat(whole) + (whole < width ? part : '')
  return [filled, '░'.repeat(Math.max(0, width - filled.length))]
}

/** A meter with no fraction to show: a three-cell block sliding across it, one cell a second. */
export function sliding(at: number, width: number): [string, string, string] {
  const span = Math.min(3, width)
  const travel = Math.max(1, width - span)
  const step = Math.floor(at / 1000) % (travel * 2)
  const left = step < travel ? step : travel * 2 - step
  return ['░'.repeat(left), '█'.repeat(span), '░'.repeat(Math.max(0, width - left - span))]
}

/** How far along a row is, 0..1, or undefined when nothing says. */
export function fractionOf(row: CommandProgress | AgentProgress, at: number): number | undefined {
  if ('kind' in row) {
    if (row.ci && row.ci.total > 0) return row.ci.status === 'completed' ? 1 : Math.min(0.97, row.ci.done / row.ci.total)
    if (row.render?.durationMs) return row.render.isDone ? 1 : Math.min(0.99, row.render.outMs / row.render.durationMs)
  }
  if (row.estimateMs) return Math.min(0.97, (at - row.startedAt) / row.estimateMs)
  return undefined
}

function runningGlyph(at: number, status: string): Span {
  if (status === 'running') return { text: SPINNER[Math.floor(at / 1000) % SPINNER.length]!, color: 'claude' }
  const [text, color] = STATUS_GLYPH[status] ?? ['?', 'subtle']
  return { text, color }
}

/** `~40s left`, or how far over the estimate the row has run. */
function leftSpan(estimateMs: number | undefined, elapsed: number): Span {
  if (!estimateMs) return { text: 'first run, no estimate', dim: true }
  const left = estimateMs - elapsed
  return left >= 0 ? { text: `~${duration(left)} left`, dim: true } : { text: `${duration(-left)} over estimate`, color: 'warning' }
}

/** The rows of the band for the progress given, at the moment `at`. */
export function rowsOf(agentRows: AgentProgress[], commandRows: CommandProgress[], at: number): Row[] {
  const rows: Row[] = []
  const dot: Span = { text: ' · ', dim: true }

  for (const a of agentRows) {
    const elapsed = (a.endedAt ?? at) - a.startedAt
    const tools: Span = { text: `${a.tools} tool${a.tools === 1 ? '' : 's'}`, dim: true }
    if (a.endedAt) {
      rows.push({
        glyph: runningGlyph(at, a.status),
        name: a.type || 'agent',
        detail: a.description,
        stat: { text: a.status === 'completed' ? 'done' : a.status, color: a.status === 'completed' ? 'success' : 'error' },
        info: [{ text: duration(elapsed) }, dot, tools],
      })
      continue
    }
    const fraction = fractionOf(a, at)
    rows.push({
      glyph: runningGlyph(at, a.status),
      name: a.type || 'agent',
      detail: a.description,
      fraction,
      stat: fraction === undefined ? { text: '', dim: true } : { text: `${Math.round(fraction * 100)}%`, bold: true },
      info: [{ text: duration(elapsed), bold: true }, dot, a.status === 'waiting' ? { text: 'waiting on you', color: 'warning' } : leftSpan(a.estimateMs, elapsed), dot, tools],
    })
  }

  for (const c of commandRows) {
    const elapsed = (c.endedAt ?? at) - c.startedAt
    const status = c.endedAt ? (c.isError ? 'failed' : 'completed') : 'running'
    const glyph = runningGlyph(at, status)
    const background: Span[] = c.isBackground && !c.endedAt ? [dot, { text: 'background', dim: true }] : []

    if (c.endedAt) {
      rows.push({
        glyph,
        name: c.label,
        detail: c.kind === 'ci' ? 'CI' : c.kind === 'render' ? 'render' : c.command,
        stat: c.isError ? { text: 'failed', color: 'error' } : { text: 'done', color: 'success' },
        info: [{ text: duration(elapsed) }],
      })
      continue
    }
    const fraction = fractionOf(c, at)

    if (c.kind === 'ci' && c.ci) {
      const ci = c.ci
      const info: Span[] = []
      if (ci.error) info.push({ text: ci.error, color: 'warning' })
      else {
        const shown = ci.jobs.slice(0, 5)
        for (const j of shown) {
          const [jg, jc] = JOB_GLYPH[j.status] ?? ['?', 'subtle']
          info.push({ text: `${jg} `, color: jc }, { text: `${fit(j.name, 12)} `, dim: true })
        }
        if (ci.jobs.length > shown.length) info.push({ text: `+${ci.jobs.length - shown.length} `, dim: true })
      }
      info.push(dot, { text: duration(elapsed), bold: true }, ...background)
      rows.push({
        glyph,
        name: c.label,
        detail: ci.runId ? `CI run ${ci.runId}` : 'CI',
        fraction,
        stat: ci.total ? { text: `${ci.done}/${ci.total}`, bold: true, color: ci.conclusion === 'failure' ? 'error' : undefined } : { text: '…', dim: true },
        info,
      })
    } else if (c.kind === 'render' && c.render) {
      const r = c.render
      const info: Span[] = [{ text: r.durationMs ? `${clock(r.outMs)} / ${clock(r.durationMs)}` : clock(r.outMs), bold: true }]
      if (r.fps) info.push(dot, { text: `${r.fps} fps`, dim: true })
      if (r.speed) info.push(dot, { text: `${r.speed}×`, dim: true })
      info.push(dot, { text: duration(elapsed) })
      const left = fraction !== undefined ? remaining(fraction, elapsed) : undefined
      if (left !== undefined) info.push(dot, { text: `~${duration(left)} left`, dim: true })
      info.push(...background)
      rows.push({
        glyph,
        name: c.label,
        detail: 'render',
        fraction,
        stat: fraction === undefined ? { text: '…', dim: true } : { text: `${Math.round(fraction * 100)}%`, bold: true },
        info,
      })
    } else {
      rows.push({
        glyph,
        name: c.label,
        detail: c.command,
        fraction,
        stat: fraction === undefined ? { text: '', dim: true } : { text: `${Math.round(fraction * 100)}%`, bold: true },
        info: [{ text: duration(elapsed), bold: true }, dot, leftSpan(c.estimateMs, elapsed), ...background],
      })
    }
  }
  return rows
}

// Module state: reset by a reload, while `$.state` and `$.store` carry on.
let cwd = ''
let tmpDir = '/tmp'
let history: Record<string, number[]> = {}
let seq = 0
let ticks = 0
let isTurnRunning = false
let ticker: Timer | undefined
const pollers = new Map<string, Timer>()

const estimateFor = (label: string) => median(history[label] ?? [])
const hasLive = (a: AgentProgress[], c: CommandProgress[]) => a.some(x => !x.endedAt) || c.some(x => !x.endedAt)

async function remember($: EngineInterface, label: string, ms: number) {
  if (ms < 1000) return
  history = { ...history, [label]: [...(history[label] ?? []), ms].slice(-HISTORY_KEEP) }
  await $.store.set(HISTORY_KEY, history).catch(() => {})
}

async function syncAgents($: EngineInterface) {
  const live = await $.agent.list().catch(() => [])
  if (live.length === 0) return
  const at = Date.now()
  await update($, agents, list => {
    const byId = new Map(list.map(a => [a.id, a]))
    let changed = false
    for (const a of live) {
      const old = byId.get(a.id)
      const isActive = ACTIVE.has(a.status)
      if (!old) {
        if (!isActive) continue
        byId.set(a.id, {
          id: a.id,
          type: a.type,
          description: a.description,
          status: a.status,
          startedAt: at,
          tools: 0,
          estimateMs: estimateFor(`agent:${a.type}`),
        })
        changed = true
        continue
      }
      const next: AgentProgress = {
        ...old,
        type: a.type,
        description: a.description,
        status: a.status,
        estimateMs: old.estimateMs ?? estimateFor(`agent:${a.type}`),
        endedAt: old.endedAt ?? (isActive ? undefined : at),
      }
      if (next.type !== old.type || next.description !== old.description || next.status !== old.status || next.endedAt !== old.endedAt) {
        byId.set(a.id, next)
        changed = true
      }
    }
    return changed ? [...byId.values()] : list
  })
}

async function patchCommand($: EngineInterface, id: string, fn: (c: CommandProgress) => CommandProgress) {
  await update($, commands, list => list.map(c => (c.id === id ? fn(c) : c)))
}

async function finishCommand($: EngineInterface, id: string, isError: boolean) {
  pollers.get(id)?.cancel()
  pollers.delete(id)
  const at = Date.now()
  let done: CommandProgress | undefined
  await update($, commands, list =>
    list.map(c => {
      if (c.id !== id || c.endedAt) return c
      done = { ...c, endedAt: at, isError }
      return done
    }),
  )
  if (done && !isError) await remember($, done.label, at - done.startedAt)
}

async function readCi($: EngineInterface, id: string, runId: string | undefined): Promise<string | undefined> {
  if (!runId) {
    const branch = await $.process
      .run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 5000 })
      .catch(() => undefined)
    const argv = ['gh', 'run', 'list', '--limit', '1', '--json', 'databaseId']
    const name = branch?.stdout.trim()
    if (branch?.exitCode === 0 && name && name !== 'HEAD') argv.push('--branch', name)
    const listed = await $.process.run(argv, { cwd, timeoutMs: 15000 })
    const first = (JSON.parse(listed.stdout || '[]') as { databaseId?: number }[])[0]
    if (!first?.databaseId) throw new Error('no run found')
    runId = String(first.databaseId)
  }
  const viewed = await $.process.run(['gh', 'run', 'view', runId, '--json', 'status,conclusion,jobs'], { cwd, timeoutMs: 15000 })
  if (viewed.exitCode !== 0) throw new Error(viewed.stderr.trim().split('\n')[0] || `gh exited ${viewed.exitCode}`)
  const ci = parseGhRun(viewed.stdout, runId)
  await patchCommand($, id, c => ({ ...c, ci }))
  return runId
}

/** Asks `gh` every 10 seconds where the run stands, while the command runs. */
function pollCi($: EngineInterface, id: string, command: string) {
  let runId = ciRunIdOf(command)
  let isBusy = false
  const tick = async () => {
    if (isBusy) return
    isBusy = true
    try {
      runId = await readCi($, id, runId)
    } catch (err) {
      const message = fit(String((err as Error).message ?? err), 40)
      await patchCommand($, id, c => ({
        ...c,
        ci: { runId, status: 'unknown', done: 0, total: 0, jobs: [], ...(c.ci?.total ? c.ci : {}), error: message },
      }))
    } finally {
      isBusy = false
    }
  }
  pollers.set(id, $.clock.every(10_000, () => void tick()))
  $.clock.after(1500, () => void tick())
}

async function probeDuration($: EngineInterface, command: string): Promise<number | undefined> {
  const input = ffmpegInputOf(command)
  if (!input) return undefined
  const probed = await $.process
    .run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { cwd, timeoutMs: 15000 })
    .catch(() => undefined)
  const seconds = Number(probed?.stdout.trim())
  return probed?.exitCode === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined
}

async function readRender($: EngineInterface, id: string, file: string, durationMs: number | undefined) {
  const text = await $.fs.read(file).catch(() => '')
  const parsed = text ? parseFfmpegProgress(text) : undefined
  await patchCommand($, id, c => ({ ...c, render: { outMs: 0, isDone: false, ...c.render, ...parsed, durationMs } }))
}

/** Reads ffmpeg's `-progress` file once a second, while the command runs. */
function pollRender($: EngineInterface, id: string, command: string, file: string) {
  let durationMs: number | undefined
  let hasProbed = false
  const tick = async () => {
    if (!hasProbed) {
      hasProbed = true
      durationMs = await probeDuration($, command)
    }
    await readRender($, id, file, durationMs)
  }
  pollers.set(id, $.clock.every(1000, () => void tick()))
}

async function tickBand($: EngineInterface) {
  ticks++
  const a = await read($, agents)
  const c = await read($, commands)
  const at = Date.now()
  const stale = (endedAt?: number) => endedAt !== undefined && at - endedAt > LINGER_MS
  if (a.some(x => stale(x.endedAt))) await update($, agents, list => list.filter(x => !stale(x.endedAt)))
  if (c.some(x => stale(x.endedAt))) await update($, commands, list => list.filter(x => !stale(x.endedAt)))
  if (ticks % 3 === 0 && (isTurnRunning || a.some(x => !x.endedAt))) await syncAgents($)
  if (hasLive(a, c) || a.some(x => x.endedAt) || c.some(x => x.endedAt)) await update($, now, () => at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    tmpDir = (await $.env.get('TMPDIR').catch(() => undefined)) || '/tmp'
    const stored = await $.store.get(HISTORY_KEY).catch(() => undefined)
    if (stored && typeof stored === 'object') history = stored as Record<string, number[]>
    await $.command.register({ name: COMMAND, description: 'Toggle the progress band above the prompt (agents, commands, CI, renders)' })

    ticker?.cancel()
    ticker = $.clock.every(1000, () => void tickBand($))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    return { text: hidden ? 'Progress band hidden.' : 'Progress band shown.' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) isTurnRunning = true
    else {
      const at = Date.now()
      const id = e.agentId
      await update($, agents, list =>
        list.some(a => a.id === id)
          ? list.map(a => (a.id === id && a.endedAt ? { ...a, endedAt: undefined, status: 'running', startedAt: at } : a))
          : [...list, { id, type: '', description: fit(e.text.replace(/\s+/g, ' '), 60), status: 'running', startedAt: at, tools: 0 }],
      )
      void syncAgents($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) isTurnRunning = false
    else {
      const at = Date.now()
      const id = e.agentId
      let done: AgentProgress | undefined
      await update($, agents, list =>
        list.map(a => {
          if (a.id !== id || a.endedAt) return a
          done = { ...a, endedAt: at, status: e.reason === 'answer' ? 'completed' : 'failed' }
          return done
        }),
      )
      if (done && e.reason === 'answer') await remember($, `agent:${done.type}`, at - done.startedAt)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const agentId = e.agentId
      await update($, agents, list => list.map(a => (a.id === agentId ? { ...a, tools: a.tools + 1 } : a)))
    }
    if (e.tool !== 'Bash') return next(e)

    const raw = e as unknown as { command?: string; tool_use_id?: string }
    const command = raw.command ?? ''
    const id = raw.tool_use_id ?? `bash-${++seq}`
    const kind = kindOf(command)
    const label = labelOf(command)
    let input = e
    let progressFile: string | undefined
    if (kind === 'render') {
      progressFile = `${tmpDir.replace(/\/$/, '')}/tachyons-progress/${id.replace(/[^\w-]/g, '_')}.txt`
      input = { ...e, command: withProgressFile(command, progressFile) } as typeof e
    }
    const row: CommandProgress = {
      id,
      label,
      command: shortCommand(command, 120),
      kind,
      startedAt: Date.now(),
      isBackground: false,
      estimateMs: estimateFor(label),
    }
    await update($, commands, list => [...list.filter(c => c.id !== id), row].slice(-24))
    if (kind === 'ci') pollCi($, id, command)
    if (kind === 'render' && progressFile) pollRender($, id, command, progressFile)

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(input)
    } catch (err) {
      await finishCommand($, id, true)
      throw err
    }
    const result = ran.deny === undefined ? (ran.result as { backgroundTaskId?: string } | undefined) : undefined
    if (result?.backgroundTaskId) {
      const taskId = result.backgroundTaskId
      await patchCommand($, id, c => ({ ...c, isBackground: true, taskId }))
    } else {
      await finishCommand($, id, ran.deny !== undefined || ran.isError === true)
    }
    return ran
  })

  // A background command ends with a task notification folded into the conversation.
  on('session.append', async ($, e, next) => {
    const content = (e.message as { content?: unknown }).content
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map(b => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('\n')
          : ''
    const note = parseTaskNotification(text)
    if (note) {
      const list = await read($, commands)
      const hit = list.find(c => c.taskId === note.taskId && !c.endedAt)
      if (hit) await finishCommand($, hit.id, note.status !== 'completed')
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const at = (await read($, now)) || Date.now()
    const a = await read($, agents)
    const c = await read($, commands)
    if (a.length === 0 && c.length === 0) return next(e)

    const order = <T extends { startedAt: number; endedAt?: number }>(rows: T[]) =>
      [...rows].sort((x, y) => Number(!!x.endedAt) - Number(!!y.endedAt) || x.startedAt - y.startedAt)
    const rows = rowsOf(order(a), order(c), at)
    const shown = rows.slice(0, MAX_ROWS)
    const running = a.filter(x => !x.endedAt).length + c.filter(x => !x.endedAt).length
    const done = rows.length - running

    // Columns: the frame and its padding take four cells; the glyph, name, meter and stat are fixed.
    const width = Math.max(40, e.props.bodyColumns)
    const inner = width - 4
    const nameWidth = 13
    const meterWidth = inner >= 70 ? METER : 8
    const statWidth = 5
    const fixed = 2 + nameWidth + 1 + meterWidth + 1 + statWidth + 2
    const detailWidth = inner >= 96 ? Math.min(30, Math.floor((inner - fixed) * 0.4)) : inner >= 72 ? 16 : 0
    const infoWidth = Math.max(10, inner - fixed - (detailWidth ? detailWidth + 1 : 0))

    const { Box, Text } = $.ui.resolve(e)
    const spans = (parts: Span[]) =>
      parts.map(part => (
        <Text color={part.color} dimColor={part.dim} bold={part.bold}>
          {part.text}
        </Text>
      ))
    const summary = [running ? `${running} running` : '', done ? `${done} finished` : ''].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column" width={width} borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row">
          <Text color="claude" bold>
            ◉ progress
          </Text>
          <Text dimColor>{`  ${summary}`}</Text>
        </Box>
        {shown.map(row => (
          <Box flexDirection="row">
            <Box width={2}>
              <Text color={row.glyph.color}>{row.glyph.text}</Text>
            </Box>
            <Box width={nameWidth + 1}>
              <Text wrap="truncate-end" bold>
                {fit(row.name, nameWidth)}
              </Text>
            </Box>
            {detailWidth ? (
              <Box width={detailWidth + 1}>
                <Text wrap="truncate-end" dimColor>
                  {fit(row.detail, detailWidth)}
                </Text>
              </Box>
            ) : null}
            <Box width={meterWidth + 1}>
              {row.fraction === undefined ? (
                row.stat.text === 'done' || row.stat.text === 'failed' ? (
                  <Text dimColor>{'·'.repeat(meterWidth)}</Text>
                ) : (
                  <Text>
                    <Text dimColor>{sliding(at, meterWidth)[0]}</Text>
                    <Text color="claude">{sliding(at, meterWidth)[1]}</Text>
                    <Text dimColor>{sliding(at, meterWidth)[2]}</Text>
                  </Text>
                )
              ) : (
                <Text>
                  <Text color={row.fraction >= 1 ? 'success' : 'claude'}>{blocks(row.fraction, meterWidth)[0]}</Text>
                  <Text dimColor>{blocks(row.fraction, meterWidth)[1]}</Text>
                </Text>
              )}
            </Box>
            <Box width={statWidth + 2}>
              <Text color={row.stat.color} dimColor={row.stat.dim} bold={row.stat.bold}>
                {row.stat.text.padStart(statWidth)}
              </Text>
            </Box>
            <Box width={infoWidth}>
              <Text wrap="truncate-end">{spans(row.info)}</Text>
            </Box>
          </Box>
        ))}
        {rows.length > shown.length ? <Text dimColor>{`  +${rows.length - shown.length} more`}</Text> : null}
      </Box>
    )
  })
}

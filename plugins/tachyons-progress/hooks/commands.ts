import type { CiJob, CiProgress, CommandKind, RenderProgress } from '../types'

// Tools whose first word says little on its own: the subcommand joins the label.
const SUBCOMMAND_TOOLS = new Set([
  'gh', 'git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'cargo', 'go', 'make', 'docker', 'kubectl',
  'pytest', 'python', 'python3', 'uv', 'poetry', 'mvn', 'gradle', 'xcodebuild', 'swift', 'dotnet',
  'terraform', 'pulumi', 'aws', 'gcloud', 'az', 'flutter', 'rtk',
])
// gh keeps two words after itself: `gh run watch`, `gh pr checks`.
const THREE_WORD_TOOLS = new Set(['gh', 'git', 'docker', 'kubectl', 'aws', 'gcloud', 'az'])

/** The first simple command of a line: no leading `cd x &&`, env assignments or wrappers. */
export function firstCommand(command: string): string {
  let text = command.trim()
  // Drop leading segments that only move or set up: `cd dir &&`, `export X=1;`, `X=1`.
  for (;;) {
    const m = /^(?:cd\s+\S+|export\s+\S+|\w+=\S*)\s*(?:&&|;)\s*/.exec(text)
    if (!m) break
    text = text.slice(m[0].length)
  }
  text = text.replace(/^(?:\w+=\S*\s+)+/, '')
  // Wrappers that run something else: show the something else.
  text = text.replace(/^(?:sudo|time|nohup|env|caffeinate\s+-\S+|caffeinate)\s+/, '')
  return text
}

/** The short name of a command used to remember how long it takes: `npm test`, `gh run watch`. */
export function labelOf(command: string): string {
  const words = firstCommand(command).split(/\s+/).filter(Boolean)
  const head = words[0] ?? ''
  const name = head.split('/').pop() ?? head
  if (!SUBCOMMAND_TOOLS.has(name)) return name || 'command'
  const sub = words.slice(1).filter(w => !w.startsWith('-'))
  const take = THREE_WORD_TOOLS.has(name) ? 2 : 1
  return [name, ...sub.slice(0, take)].join(' ')
}

export function kindOf(command: string): CommandKind {
  if (/(^|&&|\|\|?|;|\(|\n)[ \t]*ffmpeg\s/.test(command)) return 'render'
  if (/\bgh\s+(?:run\s+(?:watch|view)|pr\s+checks)\b/.test(command)) return 'ci'
  return 'shell'
}

const SLEEP_UNIT_MS: Record<string, number> = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/**
 * How long the `sleep`s of a line wait in all, when it has any: `sleep 150; curl …` waits 150 s.
 * A loop repeats its sleep an unknown number of times, so a line with one gives no figure.
 */
export function sleepMsOf(command: string): number | undefined {
  if (/(^|&&|\|\|?|;|\(|\n)[ \t]*(?:while|until|for)\s/.test(command)) return undefined
  let total = 0
  let found = false
  const re = /(?:^|&&|\|\|?|;|\(|\n)[ \t]*sleep[ \t]+((?:\d+(?:\.\d+)?[smhd]?[ \t]*)+)/g
  for (let m = re.exec(command); m; m = re.exec(command)) {
    for (const arg of m[1]!.trim().split(/\s+/)) {
      const parsed = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(arg)
      if (!parsed) continue
      total += Number(parsed[1]) * SLEEP_UNIT_MS[parsed[2]!]!
      found = true
    }
  }
  return found ? Math.round(total) : undefined
}

/** The run id named on the line (`gh run watch 123`, `--run 123`), if any. */
export function ciRunIdOf(command: string): string | undefined {
  return /\bgh\s+run\s+(?:watch|view)\s+(\d+)/.exec(command)?.[1]
}

/** `ffmpeg …` with `-progress FILE -nostats` added, so the run reports where it is. */
export function withProgressFile(command: string, file: string): string {
  if (/\s-progress\s/.test(command)) return command
  // Only where ffmpeg starts a command (line start, `&&`, `||`, `;`, `|`, `(`), never the word inside text.
  return command.replace(/(^|&&|\|\|?|;|\(|\n)([ \t]*)ffmpeg(\s)/g, `$1$2ffmpeg -progress '${file}' -nostats$3`)
}

/** The first `-i <path>` of an ffmpeg line, unquoted. */
export function ffmpegInputOf(command: string): string | undefined {
  const m = /\s-i\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command)
  return m?.[1] ?? m?.[2] ?? m?.[3]
}

function hmsToMs(text: string): number | undefined {
  const m = /^(-?)(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return undefined
  const ms = (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000
  return m[1] ? 0 : Math.round(ms)
}

/** An ffmpeg time: `90`, `1.5`, `01:30`, `00:01:30.5`, `500ms`, `2s`. */
function ffmpegTimeToMs(text: string): number | undefined {
  const t = text.replace(/^["']|["']$/g, '')
  let m = /^(\d+(?:\.\d+)?)(ms|us|s)?$/.exec(t)
  if (m) return Math.round(Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 'us' ? 0.001 : 1000))
  m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(t)
  if (m) return Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000)
  return hmsToMs(t)
}

/**
 * How much of the input an ffmpeg line writes, from its full length: `-ss` skips the start,
 * `-t` caps the length, `-to` stops at a time. Ignores options it cannot read.
 */
export function ffmpegSpanMs(command: string, inputMs: number | undefined): number | undefined {
  const opt = (name: string) => {
    const m = new RegExp(`\\s-${name}\\s+(\\S+)`).exec(command)
    return m ? ffmpegTimeToMs(m[1]!) : undefined
  }
  const start = opt('ss') ?? 0
  const length = opt('t')
  const to = opt('to')
  let span = inputMs !== undefined ? Math.max(0, inputMs - start) : undefined
  if (to !== undefined) span = Math.min(span ?? Infinity, Math.max(0, to - start))
  if (length !== undefined) span = Math.min(span ?? Infinity, length)
  return span && Number.isFinite(span) ? span : undefined
}

/** The last block of an ffmpeg `-progress` file: key=value lines ending in `progress=…`. */
export function parseFfmpegProgress(text: string): RenderProgress | undefined {
  const lines = text.split('\n')
  const fields = new Map<string, string>()
  let last: Map<string, string> | undefined
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    if (line.startsWith('progress=')) {
      last = new Map(fields)
      fields.clear()
    }
  }
  const block = last ?? (fields.size ? fields : undefined)
  if (!block) return undefined
  const outTime = block.get('out_time')
  const outUs = block.get('out_time_us') ?? block.get('out_time_ms')
  const fromTime = outTime ? hmsToMs(outTime) : undefined
  const outMs = fromTime ?? (outUs && Number(outUs) > 0 ? Math.round(Number(outUs) / 1000) : 0)
  const fps = Number(block.get('fps'))
  return {
    outMs,
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps) : undefined,
    speed: block.get('speed')?.replace(/x$/, '') || undefined,
    isDone: block.get('progress') === 'end',
  }
}

function jobStatus(status: string, conclusion: string | undefined): CiJob['status'] {
  if (status === 'completed') {
    if (conclusion === 'success' || conclusion === 'neutral') return 'done'
    if (conclusion === 'skipped' || conclusion === 'cancelled') return 'skipped'
    return 'failed'
  }
  return status === 'in_progress' ? 'running' : 'queued'
}

/** `gh run view --json status,conclusion,jobs` as job rows and a count. */
export function parseGhRun(json: string, runId?: string): CiProgress {
  const raw = JSON.parse(json) as {
    status?: string
    conclusion?: string
    jobs?: { name?: string; status?: string; conclusion?: string }[]
  }
  const jobs: CiJob[] = (raw.jobs ?? []).map(j => ({
    name: j.name ?? 'job',
    status: jobStatus(j.status ?? 'queued', j.conclusion ?? undefined),
  }))
  const done = jobs.filter(j => j.status === 'done' || j.status === 'failed' || j.status === 'skipped').length
  return { runId, status: raw.status ?? 'queued', conclusion: raw.conclusion || undefined, done, total: jobs.length, jobs }
}

/** The task id and status of a `<task-notification>` row, if the text is one. */
export function parseTaskNotification(text: string): { taskId: string; status: string } | undefined {
  if (!text.includes('task-notification')) return undefined
  const taskId = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1]
  return taskId && status ? { taskId, status } : undefined
}

/** One line of a command, collapsed and cut to `width`. */
export function shortCommand(command: string, width: number): string {
  const text = firstCommand(command).replace(/\s+/g, ' ')
  return text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text
}

/** The middle value, or undefined for an empty list. */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

export type AgentProgress = {
  id: string
  type: string
  description: string
  status: string
  startedAt: number
  endedAt?: number
  /** Tool calls the agent has made so far. */
  tools: number
  /** Median duration of earlier agents of the same type, when any ran. */
  estimateMs?: number
}

export type CiJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'
export type CiJob = { name: string; status: CiJobStatus }
export type CiProgress = {
  runId?: string
  /** The run's status as `gh` reports it: queued, in_progress, completed. */
  status: string
  conclusion?: string
  done: number
  total: number
  jobs: CiJob[]
  error?: string
}

export type RenderProgress = {
  /** Output written so far, in milliseconds of media time. */
  outMs: number
  /** The input's length, when ffprobe could read it. */
  durationMs?: number
  fps?: number
  speed?: string
  isDone: boolean
}

export type CommandKind = 'shell' | 'ci' | 'render'
export type CommandProgress = {
  id: string
  /** The command's short name used for history: `npm test`, `gh run watch`, `ffmpeg`. */
  label: string
  /** The command line, cut for display. */
  command: string
  kind: CommandKind
  startedAt: number
  endedAt?: number
  isBackground: boolean
  taskId?: string
  isError?: boolean
  /** Median duration of earlier runs of the same label, when any ran. */
  estimateMs?: number
  ci?: CiProgress
  render?: RenderProgress
}

export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export type PlanTask = {
  id: string
  subject: string
  /** What the task reads as while it runs: `Building the login screen`. */
  activeForm?: string
  status: PlanStatus
}
/** The task list Claude keeps with TodoWrite or TaskCreate and TaskUpdate. */
export type PlanProgress = {
  tasks: PlanTask[]
  startedAt: number
  /** When the last task was ticked off; the row lingers a moment after. */
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'tachyons-progress': {
      agents: AgentProgress[]
      commands: CommandProgress[]
      plan: PlanProgress | null
      isHidden: boolean
      /** The clock the band reads, written once a second while anything runs. */
      now: number
    }
  }
}

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
  /** `$.agent.list` has shown this agent; once it drops off the list, the agent is gone. */
  isListed?: boolean
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

/** Where an adb command's device stands: `searching` until adb lists one it could mean. */
export type AdbState = 'searching' | 'connected' | 'reconnecting' | 'unauthorized' | 'disconnected' | 'unknown'
export type DeviceTransport = 'wifi' | 'usb' | 'emulator' | 'tcp'
/** The Android device an adb command talks to, as `adb devices -l` shows it every few seconds. */
export type DeviceProgress = {
  /** The transport serial followed: `192.168.0.110:36007`, `emulator-5554`. */
  serial?: string
  /** The phone's own name (Settings, About phone), the emulator's AVD, or its model. */
  name?: string
  model?: string
  /** The `device:` field of `adb devices -l`, with the model it tells one phone from another. */
  board?: string
  transport?: DeviceTransport
  state: AdbState
  /** adb's own word for the state: `device`, `offline`, `connecting`. */
  adbState?: string
  /** When the state began. */
  since: number
  /** Times it went from connected to anything else. */
  drops: number
  /** The serial it had before wireless debugging brought it back on a new port. */
  movedFrom?: string
  /** Why the last look failed, or why no device could be picked. */
  error?: string
}

/** A phone adb lists (USB or wireless debugging), with a row of its own whatever runs on it. */
export type PhoneProgress = DeviceProgress & {
  /** The serial it was first seen under; it keeps the row when wireless debugging moves port. */
  id: string
  /** `Android 16 · API 36`. */
  os?: string
}

export type CommandKind = 'shell' | 'ci' | 'render' | 'adb'
export type CommandProgress = {
  id: string
  /** The command's short name used for history: `npm test`, `gh run watch`, `ffmpeg`. */
  label: string
  /** The command line, cut for display. */
  command: string
  /** The line as it ran (cut to 1000), to know it again in the engine's list of background work. */
  runCommand?: string
  /** The subagent that ran it; undefined for the main thread. */
  agentId?: string
  kind: CommandKind
  startedAt: number
  endedAt?: number
  isBackground: boolean
  taskId?: string
  isError?: boolean
  /** Median duration of earlier runs of the same label, when any ran; the line's own `sleep`s when it has them. */
  estimateMs?: number
  /** The estimate is the line's `sleep`s, not history: the run is not remembered under its label. */
  isSleepEstimate?: boolean
  /** A background command the engine no longer tracks, gone without a task notification. */
  isLost?: boolean
  ci?: CiProgress
  render?: RenderProgress
  /** The devices an adb command talks to, in the order the line names them. */
  devices?: DeviceProgress[]
}

/** A running Android emulator or iOS (watchOS, tvOS, visionOS) simulator. */
export type EmulatorProgress = {
  /** `android:<pid>` or `ios:<udid>`. */
  id: string
  platform: 'android' | 'ios'
  /** The AVD (`Medium Phone`) or the simulator's name (`iPhone 16 Pro`). */
  name: string
  /** `emulator-5554`, or the simulator's UDID. */
  serial: string
  state: 'booting' | 'booted' | 'running' | 'shutting-down'
  /** `Android 16 · API 36`, `iOS 18.2`. */
  os?: string
  startedAt: number
  /** When it was gone from the last look; the row lingers a moment after. */
  endedAt?: number
  /** The emulator process's resident memory; not known for simulators. */
  rssKb?: number
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
      emulators: EmulatorProgress[]
      phones: PhoneProgress[]
      isHidden: boolean
      /** The clock the band reads, written once a second while anything runs. */
      now: number
    }
  }
}

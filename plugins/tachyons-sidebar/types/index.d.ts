export type FileChange = {
  path: string
  edits: number
  isNew: boolean
  at: number
  /** Lines added and removed across this session's edits (absent on rows stored before they were counted). */
  added?: number
  removed?: number
}
export type AgentRow = { id: string; type: string; description: string; status: string }
export type LimitRow = { kind: string; percentUsed: number; resetsAt?: string }
export type UsageSnap = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: LimitRow[]
  costUsd?: number
  /** When the usage endpoint last answered, so the Limits section can say how fresh it is. */
  polledAt?: number
}
export type Stats = { tools: number; turns: number; startedAt: number }
export type CommitRow = { hash: string; subject: string; at: number; added: number; removed: number }
/** Commits on HEAD that no remote has yet, newest first; `total` counts past the rows kept. */
export type LocalCommits = { rows: CommitRow[]; total: number }

declare module 'claude-code' {
  interface PluginState {
    'tachyons-sidebar': {
      files: FileChange[]
      agents: AgentRow[]
      usage: UsageSnap | null
      stats: Stats
      /** Null outside a git repository. */
      commits: LocalCommits | null
    }
  }
}

// tachyons-cache's status, as that mod's own contract declares it; the sidebar only reads it.
export type CacheStatus = {
  isEnabled: boolean
  isBusy: boolean
  pings: number
  maxPings: number
  intervalMs: number
  nextAt?: number
  lastAt?: number
  lastReadTokens?: number
  lastError?: string
}

declare module 'claude-code' {
  interface PluginState {
    'tachyons-cache': { status: CacheStatus }
  }
}

// tachyons-visualize's status, as that plugin's own contract declares it; the sidebar only reads it.
export type VisualizeStatus = {
  isRunning: boolean
  sessionDir?: string
  port?: number
  url?: string
  screen?: string
  screens: number
  clicks: number
}

declare module 'claude-code' {
  interface PluginState {
    'tachyons-visualize': { status: VisualizeStatus }
  }
}

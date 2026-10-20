export type FileChange = { path: string; edits: number; isNew: boolean; at: number }
export type AgentRow = { id: string; type: string; description: string; status: string }
export type LimitRow = { kind: string; percentUsed: number; resetsAt?: string }
export type UsageSnap = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: LimitRow[]
  costUsd?: number
}
export type Stats = { tools: number; turns: number; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'tachyons-sidebar': {
      files: FileChange[]
      agents: AgentRow[]
      usage: UsageSnap | null
      stats: Stats
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

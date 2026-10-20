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

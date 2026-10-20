export type VisualizeStatus = {
  isRunning: boolean
  sessionDir?: string
  port?: number
  url?: string
  /** The newest screen's file name without `.html`. */
  screen?: string
  screens: number
  /** Clicks recorded on the newest screen. */
  clicks: number
}

declare module 'claude-code' {
  interface PluginState {
    'tachyons-visualize': { status: VisualizeStatus }
  }
}

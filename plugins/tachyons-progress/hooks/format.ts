/** `42s`, `1m 05s`, `1h 03m`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** `00:41` or `1:02:05`, for media time. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Filled and empty halves of a meter, `width` cells in all. */
export function meter(fraction: number, width: number): [string, string] {
  const f = Math.min(1, Math.max(0, fraction))
  const filled = Math.round(f * width)
  return ['━'.repeat(filled), '╌'.repeat(Math.max(0, width - filled))]
}

/** Time left from how far along and how long so far; undefined until there is something to go on. */
export function remaining(fraction: number, elapsedMs: number): number | undefined {
  if (!(fraction > 0.02) || elapsedMs <= 0) return undefined
  return Math.max(0, Math.round((elapsedMs / fraction) * (1 - fraction)))
}

export function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text
}

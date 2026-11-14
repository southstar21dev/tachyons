import type { EmulatorProgress } from '../types'

/** One process of `ps -axo pid=,etime=,rss=,command=`. */
export type Proc = { pid: number; upMs: number; rssKb: number; command: string }

/** A running Android emulator, as its qemu process shows it. */
export type AndroidEmulator = {
  pid: number
  avd: string
  /** `emulator-5554`, from `-port`; the emulator's default when it has none. */
  serial: string
  upMs: number
  rssKb: number
  /** The SDK's adb, next to the emulator that runs: the same adb the SDK's tools use. */
  adb?: string
}

/** A simulator `simctl` lists as not shut down. */
export type Simulator = { udid: string; name: string; state: string; os?: string }

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in milliseconds. */
export function etimeToMs(text: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim())
  if (!m) return 0
  const [, d, h, mm, ss] = m
  return ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mm) * 60 + Number(ss)) * 1000
}

export function parsePs(text: string): Proc[] {
  const out: Proc[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line)
    if (m) out.push({ pid: Number(m[1]), upMs: etimeToMs(m[2]!), rssKb: Number(m[3]), command: m[4]! })
  }
  return out
}

/** The emulators of `ps`: each `qemu-system-*` (or older `emulator64-*`) started with `-avd NAME` or `@NAME`. */
export function androidEmulatorsOf(procs: Proc[]): AndroidEmulator[] {
  const out: AndroidEmulator[] = []
  for (const p of procs) {
    const exe = p.command.split(/\s+/)[0] ?? ''
    if (!/\/(?:qemu-system-[\w-]+|emulator64-[\w-]+)$/.test(exe)) continue
    const avd = /\s(?:-avd\s+|@)(\S+)/.exec(p.command)?.[1]
    if (!avd) continue
    const port = /\s-port\s+(\d+)/.exec(p.command)?.[1] ?? '5554'
    const sdk = /^(.*)\/emulator\//.exec(exe)?.[1]
    out.push({ pid: p.pid, avd, serial: `emulator-${port}`, upMs: p.upMs, rssKb: p.rssKb, ...(sdk ? { adb: `${sdk}/platform-tools/adb` } : {}) })
  }
  return out
}

/** The simulators' own launchd: one per booted simulator, the cheap sign that `simctl` has any to show. */
export function simulatorProcsOf(procs: Proc[]): Proc[] {
  // Started by CoreSimulator as a bare `launchd_sim <device>/launchd_bootstrap.plist`; by a path in older Xcodes.
  return procs.filter(p => /^(?:\S*\/)?launchd_sim(?:\s|$)/.test(p.command))
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-18-2` as `iOS 18.2`. */
export function runtimeName(key: string): string | undefined {
  const m = /SimRuntime\.(iOS|watchOS|tvOS|xrOS|visionOS)-(\d+)-(\d+)/.exec(key)
  if (!m) return undefined
  return `${m[1] === 'xrOS' ? 'visionOS' : m[1]} ${m[2]}.${m[3]}`
}

/** The simulators of `xcrun simctl list devices -j` that are not shut down. */
export function parseSimctl(json: string): Simulator[] {
  const raw = JSON.parse(json) as { devices?: Record<string, { udid?: string; name?: string; state?: string }[]> }
  const out: Simulator[] = []
  for (const [runtime, list] of Object.entries(raw.devices ?? {})) {
    for (const d of list) {
      if (!d.udid || !d.state || d.state === 'Shutdown') continue
      const os = runtimeName(runtime)
      out.push({ udid: d.udid, name: d.name ?? 'Simulator', state: d.state, ...(os ? { os } : {}) })
    }
  }
  return out
}

/** `getprop sys.boot_completed; getprop ro.build.version.release; getprop ro.build.version.sdk`. */
export function androidBootOf(output: string): { isBooted: boolean; os?: string } {
  const [done, release, sdk] = output.split('\n').map(l => l.trim())
  const os = release ? `Android ${release}${sdk ? ` · API ${sdk}` : ''}` : undefined
  return { isBooted: done === '1', ...(os ? { os } : {}) }
}

/** `1.5 GB`, `640 MB`. */
export function memory(kb: number): string {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`
}

/**
 * The emulator list after a look: rows seen again keep their start (ps rounds to the second),
 * rows no longer seen end now and linger like any other.
 */
export function mergeEmulators(old: EmulatorProgress[], seen: EmulatorProgress[], at: number): EmulatorProgress[] {
  const byId = new Map(old.map(e => [e.id, e]))
  const out: EmulatorProgress[] = []
  for (const e of seen) {
    const was = byId.get(e.id)
    const startedAt = was && !was.endedAt && Math.abs(was.startedAt - e.startedAt) < 5000 ? was.startedAt : e.startedAt
    out.push({ ...e, startedAt, os: e.os ?? was?.os })
    byId.delete(e.id)
  }
  for (const e of byId.values()) out.push(e.endedAt ? e : { ...e, endedAt: at })
  return out
}

import type { AdbState, DeviceProgress, DeviceTransport } from '../types'

/** One line of `adb devices -l`. */
export type AdbDevice = {
  serial: string
  /** As adb says it: `device`, `offline`, `unauthorized`, `connecting`, `no permissions (…)`. */
  state: string
  model?: string
  product?: string
  /** The board name (`device:` field), not the transport. */
  board?: string
  usb?: string
  transportId?: string
}

/** What an adb line runs and which device it asks for. */
export type AdbCall = {
  /** The adb binary as written: `adb`, `~/Library/Android/sdk/platform-tools/adb`. */
  bin: string
  /** The subcommand: `logcat`, `shell`, `install`. */
  sub: string
  /** `-s SERIAL`, `--one-device SERIAL` or `ANDROID_SERIAL=` on the line. */
  serial?: string
  /** `-t ID`. */
  transportId?: string
  /** `-d` (the one USB device) or `-e` (the one emulator). */
  only?: 'usb' | 'emulator'
  /** `-H`, `-P`, `-L`: how to reach the same adb server. */
  server: string[]
}

// Subcommands that talk to the adb server, not to a device: nothing to follow.
const HOST_SUBCOMMANDS = new Set([
  'devices', 'connect', 'disconnect', 'pair', 'start-server', 'kill-server', 'reconnect', 'version', 'help',
  'mdns', 'keygen', 'track-devices', 'server', 'nodaemon', 'attach', 'detach',
])
const OPTIONS_WITH_VALUE = new Set(['-s', '-t', '-H', '-P', '-L', '--one-device'])

/** Shell words, quotes taken off: enough to read adb's options. */
function words(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3]!)
  return out
}

type AdbArgs = Omit<AdbCall, 'bin' | 'sub'> & { sub?: string }

/** adb's options and subcommand from the words after `adb`. */
function readArgs(args: string[]): AdbArgs {
  const call: AdbArgs = { server: [] }
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (OPTIONS_WITH_VALUE.has(w)) {
      const value = args[++i]
      if (value === undefined) break
      if (w === '-s' || w === '--one-device') call.serial = value
      else if (w === '-t') call.transportId = value
      else call.server.push(w, value)
    } else if (w === '-d') call.only = 'usb'
    else if (w === '-e') call.only = 'emulator'
    else if (w.startsWith('-')) continue
    else {
      call.sub = w
      break
    }
  }
  return call
}

/** `adb logcat` from the words of a line that starts with adb (any path to it). */
export function adbLabelOf(lineWords: string[]): string {
  const sub = readArgs(lineWords.slice(1)).sub
  return sub ? `adb ${sub}` : 'adb'
}

// A shell variable set on the line: `A=~/…/adb`, `D="192.168.0.5:5555"`, `export ANDROID_SERIAL=x`.
const ASSIGNMENT = /(?:^|[\s;&|({])(?:export[ \t]+|local[ \t]+)?([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|()]*))/g

/**
 * The line with the variables it sets put in where it reads them: `A=~/sdk/adb; D=x; $A -s $D logcat`
 * reads as `… ~/sdk/adb -s x logcat`. A variable set twice to different values, or to one
 * that runs something (`$(…)`), is left as written: nothing on the line says which it holds.
 */
export function expandLineVariables(command: string): string {
  const values = new Map<string, Set<string>>()
  ASSIGNMENT.lastIndex = 0
  for (let m = ASSIGNMENT.exec(command); m; m = ASSIGNMENT.exec(command)) {
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    values.set(m[1]!, (values.get(m[1]!) ?? new Set()).add(value))
  }
  let text = command
  for (const [name, set] of values) {
    if (set.size !== 1) continue
    const value = [...set][0]!
    if (!value || value.includes('$') || value.includes('`')) continue
    text = text.replace(new RegExp(`\\$(?:\\{${name}\\}|${name}(?!\\w))`, 'g'), () => value)
  }
  return text
}

// adb where a command starts (also inside `{ … }`, a loop body or `$( … )`), by any path to it,
// with any `VAR=x` before it.
const ADB_CALL =
  /(?:^|&&|\|\|?|;|\(|\{|\n|\b(?:do|then|else)[ \t])[ \t]*((?:\w+=\S*[ \t]+)*)((?:[^\s;&|()<>'"{}]*\/)?adb)(?=[ \t]|$)([^\n;&|)}]*)/g

/**
 * Every device an adb line talks to, once each, in the order the line first names them.
 * Server-only calls (`adb devices`, `adb connect`) name none. A line naming no device at all
 * gives one call without a serial: the single device adb would pick.
 */
export function adbCallsOf(command: string): AdbCall[] {
  const text = expandLineVariables(command.replace(/\\\n/g, ' '))
  const exported = /(?:^|[\s;&])(?:export[ \t]+)?ANDROID_SERIAL=(?:"([^"]+)"|'([^']+)'|([^\s;&]+))/.exec(text)
  const lineSerial = exported ? (exported[1] ?? exported[2] ?? exported[3]) : undefined
  // With `adb() { … }` on the line, a bare `adb` calls that function: its body names the device.
  const isAdbFunction = /(?:^|[\s;&|({])(?:function[ \t]+)?adb[ \t]*\(\)/.test(text)
  const calls: AdbCall[] = []
  const seen = new Set<string>()
  ADB_CALL.lastIndex = 0
  for (let m = ADB_CALL.exec(text); m; m = ADB_CALL.exec(text)) {
    // A function named adb (`adb() { … }`) is a definition, not a call.
    if (/^[ \t]*\(\)/.test(m[3]!) || (isAdbFunction && m[2] === 'adb')) continue
    const { sub, ...args } = readArgs(words(m[3]!))
    if (!sub || HOST_SUBCOMMANDS.has(sub)) continue
    const serial = args.serial ?? (args.only || args.transportId ? undefined : lineSerial)
    const key = `${serial ?? ''}|${args.only ?? ''}|${args.transportId ?? ''}|${args.server.join(' ')}`
    if (seen.has(key)) continue
    seen.add(key)
    calls.push({ ...args, sub, bin: m[2]!, ...(serial ? { serial } : {}) })
  }
  return calls
}

/** The first device call of an adb line, or undefined when it has none. */
export function adbCallOf(command: string): AdbCall | undefined {
  return adbCallsOf(command)[0]
}

/** The rows of `adb devices -l`. */
export function parseAdbDevices(text: string): AdbDevice[] {
  const out: AdbDevice[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('*') || /^List of devices/.test(trimmed) || trimmed.startsWith('adb ')) continue
    const parts = trimmed.split(/\s+/)
    const serial = parts[0]!
    const state: string[] = []
    const fields = new Map<string, string>()
    for (const part of parts.slice(1)) {
      const kv = /^(usb|product|model|device|transport_id):(.*)$/.exec(part)
      if (kv) fields.set(kv[1]!, kv[2]!)
      else if (fields.size === 0) state.push(part)
    }
    if (state.length === 0) continue
    const field = (key: string, name: keyof AdbDevice) => (fields.get(key) ? { [name]: fields.get(key) } : {})
    out.push({
      serial,
      state: state.join(' '),
      ...field('model', 'model'),
      ...field('product', 'product'),
      ...field('device', 'board'),
      ...field('usb', 'usb'),
      ...field('transport_id', 'transportId'),
    })
  }
  return out
}

/** How the device is reached, from its serial: an address or mDNS name is wireless debugging. */
export function transportOf(d: Pick<AdbDevice, 'serial'>): DeviceTransport {
  if (d.serial.startsWith('emulator-')) return 'emulator'
  if (/\._adb(?:-tls-connect)?\._tcp\.?$/.test(d.serial)) return 'wifi'
  const host = /^(.+):\d+$/.exec(d.serial)?.[1]
  if (host) return host === 'localhost' || host.startsWith('127.') ? 'tcp' : 'wifi'
  return 'usb'
}

/** adb's word for a device's state, as one of ours. */
function stateOf(adbState: string): AdbState {
  if (adbState === 'device') return 'connected'
  if (adbState === 'unauthorized' || adbState.startsWith('no permissions')) return 'unauthorized'
  return 'reconnecting'
}

/** The devices the line could mean when it names none. */
function candidates(listed: AdbDevice[], call: AdbCall): AdbDevice[] {
  if (call.transportId) return listed.filter(d => d.transportId === call.transportId)
  if (call.only === 'usb') return listed.filter(d => transportOf(d) === 'usb')
  if (call.only === 'emulator') return listed.filter(d => transportOf(d) === 'emulator')
  return listed
}

/**
 * Where the command's device stands after a look at `adb devices -l`.
 *
 * It follows one device once it knows which: by serial while listed, and, when wireless
 * debugging comes back on a new port (a new serial), to the one wireless device of the
 * same model and board. Not listed at all is disconnected; listed but not usable
 * (offline, connecting, authorizing) is reconnecting.
 */
export function nextDevice(old: DeviceProgress | undefined, listed: AdbDevice[], call: AdbCall, at: number): DeviceProgress {
  const base: DeviceProgress = old ?? { state: 'searching', since: at, drops: 0, ...(call.serial ? { serial: call.serial } : {}) }
  const moveTo = (state: AdbState, patch: Partial<DeviceProgress>): DeviceProgress => {
    const next: DeviceProgress = { ...base, ...patch, state, since: state === base.state ? base.since : at }
    delete next.error
    if (base.state === 'connected' && state !== 'connected') next.drops = base.drops + 1
    return next
  }

  // `-s $D` with $D set outside the line (a loop, the environment): no telling which phone.
  if (base.serial?.includes('$')) return { ...moveTo('unknown', {}), error: `device set by ${base.serial}` }
  let serial = base.serial
  let hit = serial ? listed.find(d => d.serial === serial) : undefined
  if (!serial) {
    const pool = candidates(listed, call)
    if (pool.length === 0) return moveTo('searching', {})
    if (pool.length > 1) return { ...moveTo('unknown', {}), error: `${pool.length} devices, none named` }
    hit = pool[0]!
    serial = hit.serial
  }

  let movedFrom = base.movedFrom
  if (!hit && base.model && base.transport === 'wifi') {
    const same = listed.filter(
      d => d.serial !== serial && d.state === 'device' && transportOf(d) === 'wifi' && d.model === base.model && d.board === base.board,
    )
    if (same.length === 1) {
      movedFrom = serial
      hit = same[0]!
      serial = hit.serial
    }
  }
  if (!hit) return moveTo('disconnected', { serial })
  const next = moveTo(stateOf(hit.state), {
    serial,
    adbState: hit.state,
    transport: transportOf(hit),
    ...(hit.model ? { model: hit.model } : {}),
    ...(hit.board ? { board: hit.board } : {}),
    ...(movedFrom ? { movedFrom } : {}),
  })
  // A new serial is the same phone only when it moved there; any other is named afresh.
  if (serial !== base.serial && movedFrom !== base.serial) delete next.name
  return next
}

/**
 * The phone's name from `settings get global device_name; getprop ro.boot.qemu.avd_name;
 * getprop ro.product.marketname` (one line each), else its model: `Pixel 8 Pro`.
 */
export function deviceNameOf(shellOutput: string, model: string | undefined): string | undefined {
  const [given, avd, market] = shellOutput.split('\n').map(l => l.trim())
  const usable = (s: string | undefined) => (s && s !== 'null' && !/^(?:\/system\/bin\/sh|error|Exception)/.test(s) ? s : undefined)
  return usable(given) ?? usable(avd)?.replace(/_/g, ' ') ?? usable(market) ?? model?.replace(/_/g, ' ')
}

/** The script `deviceInfoOf` reads: the phone's names, then its Android version. */
export const DEVICE_INFO_SCRIPT =
  'settings get global device_name; getprop ro.boot.qemu.avd_name; getprop ro.product.marketname; getprop ro.build.version.release; getprop ro.build.version.sdk'

/** The name and `Android 16 · API 36` of a device from `DEVICE_INFO_SCRIPT`'s output. */
export function deviceInfoOf(shellOutput: string, model: string | undefined): { name?: string; os?: string } {
  const lines = shellOutput.split('\n').map(l => l.trim())
  const name = deviceNameOf(lines.slice(0, 3).join('\n'), model)
  const [release, sdk] = [lines[3], lines[4]]
  const os = release && /^[\w.]+$/.test(release) ? `Android ${release}${sdk && /^\d+$/.test(sdk) ? ` · API ${sdk}` : ''}` : undefined
  return { ...(name ? { name } : {}), ...(os ? { os } : {}) }
}

/**
 * The phones adb lists after a look, emulators left out (they have rows of their own).
 * A phone already known keeps its row through drops and a new wireless port; one no longer
 * listed reads disconnected. A serial no known phone claims starts a row.
 */
export function nextPhones(old: (DeviceProgress & { id: string })[], listed: AdbDevice[], at: number): (DeviceProgress & { id: string })[] {
  const phones = listed.filter(d => transportOf(d) !== 'emulator')
  const claimed = new Set<string>()
  const out: (DeviceProgress & { id: string })[] = []
  for (const p of old) {
    // Only an unclaimed listing can be followed: two rows never take the same phone.
    const open = phones.filter(d => !claimed.has(d.serial))
    const next = { ...nextDevice(p, open, { bin: 'adb', sub: 'shell', server: [], serial: p.serial }, at), id: p.id }
    if (next.serial && next.state !== 'disconnected') claimed.add(next.serial)
    out.push(next)
  }
  for (const d of phones) {
    if (claimed.has(d.serial)) continue
    claimed.add(d.serial)
    out.push({ ...nextDevice(undefined, [d], { bin: 'adb', sub: 'shell', server: [], serial: d.serial }, at), id: d.serial })
  }
  return out
}

/** What the band names the device by: its name, else its model, else its serial. */
export function deviceLabelOf(d: DeviceProgress): string | undefined {
  const name = d.name ?? d.model?.replace(/_/g, ' ')
  if (name) return d.transport && d.transport !== 'emulator' ? `${name} · ${d.transport}` : name
  return d.serial
}

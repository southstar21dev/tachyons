// Clawd, drawn as half-block pixels: each Raster cell holds two pixels stacked
// (▀ with the top as foreground and the bottom as background). It sits still:
// awake while a turn runs (blinking now and then), asleep otherwise.

export type CrabMood = 'sleeping' | 'awake'

const DEFAULT = 0x01000000
const PALETTE: Record<string, number> = {
  o: 0xd97757, // body
  s: 0xb85f40, // belly shade
  c: 0xe8916f, // claws
  e: 0x2b1d18, // eyes
  b: 0xf4a6a0, // blush
}
const SPRITE_W = 16
const SPRITE_H = 10
const FX_ROWS = 1 // a cell row above the crab for its Zz
export const CRAB_ROWS = FX_ROWS + SPRITE_H / 2 + 1 // + caption row

const AWAKE = [
  '.c............c.',
  'ccc..........ccc',
  '.o..oooooooo..o.',
  '.o.oooooooooo.o.',
  '.oooooooooooooo.',
  '...oooooooooo...',
  '...oboooooobo...',
  '...ssssssssss...',
  '...o.o....o.o...',
  '..o..o....o..o..',
]
const ASLEEP = [
  '................',
  '................',
  '....oooooooo....',
  '...oooooooooo...',
  '...oooooooooo...',
  '..cooooooooooc..',
  '...oboooooobo...',
  '...ssssssssss...',
  '...o.o....o.o...',
  '................',
]

function spriteRows(mood: CrabMood, isBlinking: boolean): string[] {
  const rows = [...(mood === 'sleeping' ? ASLEEP : AWAKE)]
  const put = (row: number, col: number) => {
    const r = rows[row]!
    rows[row] = r.slice(0, col) + 'e' + r.slice(col + 1)
  }
  // Two-pixel eyes when awake, a one-pixel closed line when asleep or blinking.
  for (const col of [5, 10]) {
    if (mood === 'awake' && !isBlinking) put(4, col)
    put(5, col)
  }
  return rows
}

export type CrabFrame = { mood: CrabMood; isBlinking: boolean; caption: string }

/** The Raster cells for one frame, `columns` wide and CRAB_ROWS tall. */
export function crabCells(frame: CrabFrame, columns: number): Uint32Array {
  const { mood, isBlinking, caption } = frame
  const x = Math.max(0, Math.floor((columns - SPRITE_W) / 2))
  const sprite = spriteRows(mood, isBlinking)
  const top = FX_ROWS * 2

  const pixel = (py: number, px: number): number | null => {
    const sy = py - top
    const sx = px - x
    if (sy < 0 || sy >= SPRITE_H || sx < 0 || sx >= SPRITE_W) return null
    return PALETTE[sprite[sy]![sx]!] ?? null
  }

  const out = new Uint32Array(columns * CRAB_ROWS * 3)
  const set = (i: number, ch: number, fg: number, bg: number) => {
    out[i * 3] = ch
    out[i * 3 + 1] = fg
    out[i * 3 + 2] = bg
  }

  for (let row = 0; row < CRAB_ROWS - 1; row++) {
    for (let col = 0; col < columns; col++) {
      const i = row * columns + col
      const up = pixel(row * 2, col)
      const down = pixel(row * 2 + 1, col)
      if (up === null && down === null) set(i, 0x20, DEFAULT, DEFAULT)
      else if (down === null) set(i, 0x2580, up!, DEFAULT)
      else if (up === null) set(i, 0x2584, down, DEFAULT)
      else set(i, 0x2580, up, down)
    }
  }

  if (mood === 'sleeping') {
    const zz: [number, number, string, number][] = [
      [1, x + 14, 'z', 0x8a8a8a],
      [0, x + 15, 'z', 0x9a9a9a],
      [0, x + 17, 'Z', 0xaaaaaa],
    ]
    for (const [row, col, ch, color] of zz) {
      if (col < columns && out[(row * columns + col) * 3] === 0x20) set(row * columns + col, ch.charCodeAt(0), color, DEFAULT)
    }
  }

  const row = CRAB_ROWS - 1
  const text = caption.length > columns ? caption.slice(0, columns) : caption
  const start = Math.floor((columns - text.length) / 2)
  const color = mood === 'sleeping' ? 0x8a8a8a : 0xd97757
  for (let col = 0; col < columns; col++) {
    const ch = col >= start && col < start + text.length ? text.charCodeAt(col - start) : 0x20
    set(row * columns + col, ch, ch === 0x20 ? DEFAULT : color, DEFAULT)
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    bytes[i * 4] = w & 0xff
    bytes[i * 4 + 1] = (w >>> 8) & 0xff
    bytes[i * 4 + 2] = (w >>> 16) & 0xff
    bytes[i * 4 + 3] = (w >>> 24) & 0xff
  }
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    s += B64[a >> 2]
    s += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    s += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    s += c === undefined ? '=' : B64[c & 63]
  }
  return s
}

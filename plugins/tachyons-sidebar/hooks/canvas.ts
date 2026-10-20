// Text laid into Raster cells. Every cell's background is the terminal's own
// default, so the pane shows the same background as the main conversation
// instead of the dock's tint.

export const DEFAULT = 0x01000000

/** Colors chosen to read on light and dark backgrounds alike. */
export const INK = {
  text: DEFAULT, // the terminal's own foreground
  muted: 0x8a8a8a,
  faint: 0x6f6f6f,
  claude: 0xd97757,
  success: 0x3fa45b,
  warning: 0xd39a2c,
  error: 0xe5484d,
} as const

export type Span = { text: string; color: number }
export type Line = Span[]

export const span = (text: string, color: number = INK.text): Span => ({ text, color })

// Code points the cell grid takes as one printable width-1 character. Others
// (wide, combining, astral, controls) are drawn as '?', so no path refuses the tree.
function isSafe(cp: number): boolean {
  return (
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa1 && cp <= 0x2ff && cp !== 0xad) ||
    (cp >= 0x370 && cp <= 0x52f) ||
    (cp >= 0x2010 && cp <= 0x2027) ||
    (cp >= 0x2030 && cp <= 0x205e) ||
    (cp >= 0x2190 && cp <= 0x21ff) ||
    (cp >= 0x2500 && cp <= 0x25ff) ||
    cp === 0x270e ||
    cp === 0x2713 ||
    cp === 0x2717
  )
}

export function cellsOf(lines: Line[], columns: number, rows: number): Uint32Array {
  const out = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < columns * rows; i++) {
    out[i * 3] = 0x20
    out[i * 3 + 1] = DEFAULT
    out[i * 3 + 2] = DEFAULT
  }
  for (let row = 0; row < Math.min(rows, lines.length); row++) {
    const chars: { cp: number; color: number }[] = []
    for (const s of lines[row]!) {
      for (const ch of s.text) {
        const cp = ch.codePointAt(0)!
        chars.push({ cp: isSafe(cp) ? cp : 0x3f, color: s.color })
      }
    }
    if (chars.length > columns) {
      chars.length = columns
      chars[columns - 1] = { cp: 0x2026, color: INK.muted }
    }
    chars.forEach(({ cp, color }, col) => {
      const i = (row * columns + col) * 3
      out[i] = cp
      out[i + 1] = cp === 0x20 ? DEFAULT : color
    })
  }
  return out
}

/** The printed length of a line. */
export const widthOf = (line: Line) => line.reduce((n, s) => n + [...s.text].length, 0)

/** `#rrggbb` for a Text color, or undefined for the terminal's own. */
export const hex = (color: number) =>
  color === DEFAULT ? undefined : '#' + color.toString(16).padStart(6, '0')

/** Paints a pixel picture (one string per pixel row, '.' empty) as half-blocks into `out`, from cell row `top`. */
export function paintPixels(
  out: Uint32Array,
  columns: number,
  rows: string[],
  colors: Record<string, number>,
  top: number,
): void {
  const width = rows[0]?.length ?? 0
  const left = Math.floor((columns - width) / 2)
  const at = (y: number, x: number) => colors[rows[y]?.[x] ?? '.'] ?? null
  for (let y = 0; y < rows.length; y += 2) {
    for (let x = 0; x < width; x++) {
      const col = left + x
      if (col < 0 || col >= columns) continue
      const up = at(y, x)
      const down = at(y + 1, x)
      if (up === null && down === null) continue
      const i = ((top + y / 2) * columns + col) * 3
      if (i < 0 || i + 2 >= out.length) continue
      if (down === null) out.set([0x2580, up!, DEFAULT], i)
      else if (up === null) out.set([0x2584, down, DEFAULT], i)
      else out.set([0x2580, up, down], i)
    }
  }
}

/** Writes `text` centred on cell row `row` of `out`. */
export function paintCentered(out: Uint32Array, columns: number, row: number, text: string, color: number): void {
  const chars = [...text].slice(0, columns)
  const left = Math.floor((columns - chars.length) / 2)
  chars.forEach((ch, k) => {
    const cp = ch.codePointAt(0)!
    const i = (row * columns + left + k) * 3
    if (i >= 0 && i + 2 < out.length) out.set([cp, cp === 0x20 ? DEFAULT : color, DEFAULT], i)
  })
}

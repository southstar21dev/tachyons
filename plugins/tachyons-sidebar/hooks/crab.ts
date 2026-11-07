// Clawd, drawn as half-block pixels: each Raster cell holds two pixels stacked
// (▀ with the top as foreground and the bottom as background). Asleep between
// turns in a nightcap; during one it wears a hat and holds a tool for what it
// is doing, blinks now and then and bobs gently. The face is the same throughout.

export type CrabMood = 'sleeping' | 'awake'

/** What Clawd is up to: each has its own hat, tool and caption. */
export type CrabActivity =
  | 'sleeping'
  | 'requesting'
  | 'thinking'
  | 'responding'
  | 'planning'
  | 'shell'
  | 'editing'
  | 'reading'
  | 'browsing'
  | 'delegating'
  | 'working'

const DEFAULT = 0x01000000
const PALETTE: Record<string, number> = {
  o: 0xd97757, // body
  s: 0xb85f40, // belly shade
  c: 0xe8916f, // claws
  e: 0x2b1d18, // eyes
  w: 0xffffff, // eye sparkle, paper, pompom
  b: 0xf4a6a0, // blush
  m: 0x7a2e22, // mouth
  // hats and tools
  n: 0x5b7fd6, // nightcap blue
  N: 0x8fa9ec, // nightcap stripe
  p: 0x5fb3e8, // propeller blade
  q: 0xe5484d, // beanie red
  Q: 0x3fa45b, // beanie green
  Y: 0xf2c12e, // hard hat yellow
  y: 0xffe27a, // highlight gold, star
  V: 0x8a5cd6, // wizard purple
  R: 0xc8475a, // beret red
  h: 0x8b5a2b, // brown: wood, leather
  H: 0xb07a45, // light brown check
  K: 0xd8c48f, // khaki
  W: 0xf3f3f3, // captain white
  k: 0x45455a, // charcoal
  r: 0xd9534f, // band red, flag
  g: 0x9aa4b1, // steel
  L: 0xbfe6ff, // glass
  B: 0x3f7fd9, // ocean
  G: 0x56b870, // land
  T: 0x1f3a7a, // navy mortarboard
  t: 0xe8c39e, // pencil wood
  P: 0xf49ac1, // eraser pink
}

const SPRITE_W = 20
const SPRITE_H = 12
const FX_ROWS = 1 // a cell row above Clawd for Zz, sparkles and the bob
export const CRAB_ROWS = FX_ROWS + SPRITE_H / 2 + 1 // + caption row

// Rows 5..11: Clawd, 12 pixels wide at columns 4..15. Rows 0..4 are left to hats and tools.
const BODY = [
  '......oooooooo......',
  '.....oooooooooo.....',
  '.....ooeooooeoo.....',
  '....cooeooooeooc....',
  '.....obooooooob.....',
  '.....ssssssssss.....',
  '.....o.o....o.o.....',
]
const BODY_TOP = 5
// The right claw reaches out a pixel to hold a tool, whose stem stands just past it.
const CLAW_ROW = BODY_TOP + 3
const STEM_COL = 17

/** A hat: rows 0..4, its brim on the head's top row. */
const HATS: Record<string, string[]> = {
  nightcap: [
    '....................',
    '........nnnn........',
    '......nnNNnnnn......',
    '.....nnNNnnNNnnnn...',
    '.....NNNNNNNNNN..yy.',
  ],
  propeller: [
    '.....ppppkkpppp.....',
    '.........kk.........',
    '.......qqqQQQ.......',
    '......qqqqQQQQ......',
    '.....yyyyyyyyyy.....',
  ],
  wizard: [
    '..........VV........',
    '.........VVV........',
    '........VVyVV.......',
    '.......VVVVVVV......',
    '....VVVVVVVVVVVV....',
  ],
  tophat: [
    '....................',
    '......kkkkkkkk......',
    '......kkkkkkkk......',
    '......rrrrrrrr......',
    '....kkkkkkkkkkkk....',
  ],
  mortarboard: [
    '....................',
    '.....TTTTTTTTTT.....',
    '...TTTTTTTTTTTTTT...',
    '......TTTTTTTT.y....',
    '......TTTTTTTT.y....',
  ],
  hardhat: [
    '....................',
    '.........yY.........',
    '.......YYyYYY.......',
    '......YYYyYYYY......',
    '....YYYYYYYYYYYY....',
  ],
  beret: [
    '....................',
    '.........R..........',
    '.......RRRRRRR......',
    '.....RRRRRRRRRRR....',
    '......kkkkkkkk......',
  ],
  deerstalker: [
    '....................',
    '.........hh.........',
    '.......hHhHhH.......',
    '......HhHhHhHh......',
    '....hhhhhhhhhhhh....',
  ],
  pith: [
    '....................',
    '........KKKK........',
    '......KKKKKKKK......',
    '......hhhhhhhh......',
    '...KKKKKKKKKKKKKK...',
  ],
  captain: [
    '....................',
    '.....gggggggggg.....',
    '....gWWWWWWWWWWg....',
    '.....gWWWyyWWWg.....',
    '.....kkkkkkkkkk.....',
  ],
}

/** A tool held beside the right claw: its pixels, bottom row on the claw's row, and which column is its stem. */
type Tool = { stem: number; rows: string[] }
const TOOLS: Record<string, Tool> = {
  wand: { stem: 1, rows: ['.y.', 'yyy', '.y.', '.h.', '.h.'] },
  wandTwinkle: { stem: 1, rows: ['y.y', '.w.', 'y.y', '.h.', '.h.'] },
  quill: { stem: 0, rows: ['..gW', '.gWW', '.gW.', 'gW..', 'k...'] },
  clipboard: { stem: 1, rows: ['.gg.', 'hwwh', 'hggh', 'hwwh', 'hhhh'] },
  hammer: { stem: 1, rows: ['ggg', 'ggg', '.h.', '.h.', '.h.'] },
  screwdriver: { stem: 1, rows: ['.g.', '.g.', 'rrr', 'rrr', '.r.'] },
  pencil: { stem: 0, rows: ['.k', 'tt', 'YY', 'YY', 'PP'] },
  magnifier: { stem: 1, rows: ['.gg.', 'gLLg', 'gLLg', '.gg.', '.h..'] },
  globe: { stem: 1, rows: ['.BB.', 'BGGB', 'BBGB', '.BB.', '.h..'] },
  flag: { stem: 0, rows: ['grr', 'grr', 'g..', 'g..', 'g..'] },
}

/** Each activity's hat, tool and the word under it. */
export const OUTFITS: Record<CrabActivity, { hat: string; tool?: string; word: string }> = {
  sleeping: { hat: 'nightcap', word: 'napping' },
  requesting: { hat: 'propeller', word: 'thinking' },
  thinking: { hat: 'wizard', tool: 'wand', word: 'pondering' },
  responding: { hat: 'tophat', tool: 'quill', word: 'writing' },
  planning: { hat: 'mortarboard', tool: 'clipboard', word: 'planning' },
  shell: { hat: 'hardhat', tool: 'hammer', word: 'tinkering' },
  editing: { hat: 'beret', tool: 'pencil', word: 'editing' },
  reading: { hat: 'deerstalker', tool: 'magnifier', word: 'sleuthing' },
  browsing: { hat: 'pith', tool: 'globe', word: 'exploring' },
  delegating: { hat: 'captain', tool: 'flag', word: 'delegating' },
  working: { hat: 'hardhat', tool: 'screwdriver', word: 'crafting' },
}

const SHELL = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell'])
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'LSP'])
const WEB = new Set(['WebFetch', 'WebSearch'])
const TEAM = new Set(['Agent', 'Task', 'SendMessage'])

/** What Clawd is doing, from the spinner's mode and the tool running, if any. */
export function activityOf(isWorking: boolean, mode: string, tool?: string): CrabActivity {
  if (!isWorking) return 'sleeping'
  if (tool) {
    if (SHELL.has(tool)) return 'shell'
    if (EDIT.has(tool)) return 'editing'
    if (READ.has(tool)) return 'reading'
    if (WEB.has(tool) || tool.startsWith('mcp__plugin_playwright') || tool.includes('browser')) return 'browsing'
    if (TEAM.has(tool)) return 'delegating'
    return 'working'
  }
  switch (mode) {
    case 'thinking':
      return 'thinking'
    case 'responding':
      return 'responding'
    case 'tool-input':
      return 'planning'
    case 'tool-use':
      return 'working'
    default:
      return 'requesting'
  }
}

/** The sprite's pixel rows for one frame, SPRITE_W wide and SPRITE_H tall. */
export function spriteRows(activity: CrabActivity, isBlinking: boolean, tick = 0): string[] {
  const outfit = OUTFITS[activity]
  const rows = [...Array.from({ length: BODY_TOP }, () => '.'.repeat(SPRITE_W)), ...BODY]
  const put = (row: number, col: number, ch: string) => {
    const r = rows[row]
    if (r === undefined || col < 0 || col >= SPRITE_W || ch === '.') return
    rows[row] = r.slice(0, col) + ch + r.slice(col + 1)
  }
  // A blink closes each eye to its lower dot, never all the way.
  if (isBlinking) {
    put(CLAW_ROW - 1, 7, 'o')
    put(CLAW_ROW - 1, 12, 'o')
  }

  // The propeller turns: blades out, then edge on.
  const hat = [...HATS[outfit.hat]!]
  if (outfit.hat === 'propeller' && tick % 2 === 1) hat[0] = '.......ppkkpp.......'
  hat.forEach((line, row) => [...line].forEach((ch, col) => put(row, col, ch)))

  const toolName = outfit.tool === 'wand' && tick % 2 === 1 ? 'wandTwinkle' : outfit.tool
  const tool = toolName ? TOOLS[toolName] : undefined
  if (tool) {
    const top = CLAW_ROW - tool.rows.length + 1
    put(CLAW_ROW, STEM_COL - 1, 'c')
    tool.rows.forEach((line, i) => [...line].forEach((ch, k) => put(top + i, STEM_COL - tool.stem + k, ch)))
  }
  return rows
}

export type CrabFrame = {
  mood: CrabMood
  isBlinking: boolean
  caption: string
  /** Defaults to `sleeping` asleep and `requesting` awake. */
  activity?: CrabActivity
  /** Seconds into the turn: turns the propeller, twinkles the wand, bobs Clawd. */
  tick?: number
}

/** The Raster cells for one frame, `columns` wide and CRAB_ROWS tall. */
export function crabCells(frame: CrabFrame, columns: number): Uint32Array {
  const { mood, isBlinking, caption, tick = 0 } = frame
  const activity = frame.activity ?? (mood === 'sleeping' ? 'sleeping' : 'requesting')
  const x = Math.floor((columns - SPRITE_W) / 2)
  const sprite = spriteRows(activity, isBlinking, tick)
  // Awake, Clawd bobs up a pixel every other second.
  const top = FX_ROWS * 2 - (mood === 'awake' && tick % 2 === 1 ? 1 : 0)

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

  // Floating letters around the head: Zz asleep, a sparkle now and then awake.
  const marks: [number, number, string, number][] =
    mood === 'sleeping'
      ? [
          [1, x + 2, 'z', 0x8a8a8a],
          [0, x + 1, 'z', 0x9a9a9a],
          [0, x - 1, 'Z', 0xaaaaaa],
        ]
      : tick % 4 === 2
        ? [[0, x + 3, '+', 0xffe27a]]
        : []
  for (const [row, col, ch, color] of marks) {
    if (col >= 0 && col < columns && out[(row * columns + col) * 3] === 0x20) set(row * columns + col, ch.charCodeAt(0), color, DEFAULT)
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

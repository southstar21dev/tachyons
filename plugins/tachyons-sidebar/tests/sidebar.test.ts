import { expect, test } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { cellsOf, paintPixels, span } from '../hooks/canvas'
import { LOGO_32, LOGO_COLORS } from '../hooks/logo'
import { CRAB_ROWS, OUTFITS, activityOf, crabCells, spriteRows, toBase64 } from '../hooks/crab'
import type { CrabActivity } from '../hooks/crab'
import { heat, limitLabel, mergeLimits, meter, parseUsage, shortPath } from '../hooks/register'

const PANE_PROPS = {
  title: 'Session',
  isFocused: false,
  bodyColumns: 32,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('bar and paths format', async () => {
  expect(meter(50, 10)).toEqual(['━━━━━', '─────'])
  expect(meter(25, 10)).toEqual(['━━╸', '───────'])
  expect(meter(150, 4)).toEqual(['━━━━', ''])
  expect(heat(0)).toBe(0x4fb37a)
  expect(heat(1)).toBe(0xe5484d)
  expect(shortPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  expect(shortPath('/x/y/z/a.ts', '/repo')).toBe('…/z/a.ts')
})

test('usage endpoint windows become limit rows, fable included', async () => {
  const body = JSON.stringify({
    seven_day_fable: { utilization: 12.34, resets_at: '2026-11-12T00:00:00Z' },
    seven_day: { utilization: 40, resets_at: null },
    five_hour: { utilization: 7, resets_at: '2026-11-10T20:00:00Z' },
    seven_day_opus: null,
    extra_usage: { is_enabled: false },
  })
  const rows = parseUsage(body)
  expect(rows.map(r => r.kind)).toEqual(['five_hour', 'seven_day', 'seven_day_fable'])
  expect(rows[2]).toEqual({ kind: 'seven_day_fable', percentUsed: 12.3, resetsAt: '2026-11-12T00:00:00Z' })
  const scoped = parseUsage(
    JSON.stringify({
      five_hour: { utilization: 94, resets_at: null },
      limits: [
        { kind: 'session', percent: 94 },
        { kind: 'weekly_scoped', percent: 37, resets_at: '2026-11-10T22:59:59Z', scope: { model: { id: null, display_name: 'Fable' } } },
      ],
    }),
  )
  expect(scoped).toEqual([
    { kind: 'five_hour', percentUsed: 94 },
    { kind: 'seven_day_fable', percentUsed: 37, resetsAt: '2026-11-10T22:59:59Z' },
  ])
  expect(parseUsage('nope')).toEqual([])
  expect(limitLabel('seven_day_fable')).toBe('7d fable')
  expect(limitLabel('five_hour')).toBe('5-hour')
  expect(mergeLimits([{ kind: 'five_hour', percentUsed: 1 }, { kind: 'spend_limit', percentUsed: 3 }], rows).map(r => [r.kind, r.percentUsed])).toEqual([
    ['five_hour', 7], ['spend_limit', 3], ['seven_day', 40], ['seven_day_fable', 12.3],
  ])
})

test('sidebar shows edited files and usage', async ($, on) => {
  on('tool.call', () => ({ result: {} as never }))
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.tool.call({ tool: 'Write', file_path: '/tmp/new.ts', content: 'x' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/old.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/old.ts', old_string: 'b', new_string: 'c' } as never)
  await $.session.measure({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
    changed: ['context', 'rateLimits'],
  })

  const terminal = await $.ui.mount({
    plugin: 'tachyons-sidebar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tachyons-sidebar',
    props: PANE_PROPS,
  })
  // On the terminal the whole body is painted cells, on the terminal's own background.
  expect(await terminal.find({ type: 'Raster', key: 'crab' })).toBeDefined()
  expect(await terminal.find({ type: 'Raster', key: 'stats' })).toBeDefined()
  await terminal.unmount()

  const ui = await $.ui.mount({
    plugin: 'tachyons-sidebar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'tachyons-sidebar',
    props: PANE_PROPS,
  })
  expect(await ui.find({ type: 'Text', text: /2 · 3 edits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /new\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5-hour.*42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /50k of 200k tokens/ })).toBeDefined()
  await ui.unmount()
})

test('crab frames fill the raster in every mood', async () => {
  for (const mood of ['sleeping', 'awake'] as const) {
    for (const isBlinking of [false, true]) {
      const cells = crabCells({ mood, isBlinking, caption: 'napping' }, 30)
      expect(cells.length).toBe(30 * CRAB_ROWS * 3)
      expect(toBase64(cells).length).toBe(Math.ceil((cells.length * 4) / 3) * 4)
    }
  }
  expect(toBase64(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
})

test('clawd dresses for what it is doing', async () => {
  expect(activityOf(false, 'responding', 'Bash')).toBe('sleeping')
  expect(activityOf(true, 'requesting')).toBe('requesting')
  expect(activityOf(true, 'thinking')).toBe('thinking')
  expect(activityOf(true, 'responding')).toBe('responding')
  expect(activityOf(true, 'tool-input')).toBe('planning')
  expect(activityOf(true, 'tool-use', 'Bash')).toBe('shell')
  expect(activityOf(true, 'tool-use', 'Edit')).toBe('editing')
  expect(activityOf(true, 'tool-use', 'Grep')).toBe('reading')
  expect(activityOf(true, 'tool-use', 'WebSearch')).toBe('browsing')
  expect(activityOf(true, 'tool-use', 'Agent')).toBe('delegating')
  expect(activityOf(true, 'tool-use', 'mcp__x__y')).toBe('working')
  const seen = new Set<string>()
  for (const activity of Object.keys(OUTFITS) as CrabActivity[]) {
    for (const tick of [0, 1]) {
      const rows = spriteRows(activity, false, tick)
      expect(rows.length).toBe(12)
      expect(rows.every(r => r.length === 20)).toBe(true)
      seen.add(rows.slice(0, 5).join('|'))
    }
    const mood = activity === 'sleeping' ? 'sleeping' : 'awake'
    expect(crabCells({ mood, isBlinking: false, caption: 'x', activity, tick: 3 }, 30).length).toBe(30 * CRAB_ROWS * 3)
  }
  // Every outfit but the two hard hats looks different up top.
  expect(seen.size).toBeGreaterThan(Object.keys(OUTFITS).length)
})

test('canvas cuts long lines and replaces wide characters', async () => {
  const cells = cellsOf([[span('ab漢😀cdef')]], 5, 1)
  const chars = [0, 1, 2, 3, 4].map(i => String.fromCodePoint(cells[i * 3]!))
  expect(chars.join('')).toBe('ab??…')
})

test('the logo is painted centred at the row asked', async () => {
  const cells = cellsOf([], 36, 10)
  paintPixels(cells, 36, LOGO_32, LOGO_COLORS, 2)
  const at = (row: number, col: number) => cells[(row * 36 + col) * 3]!
  // Rows above it stay blank; its first pixel row starts 2 cells in (centred: (36 - 32) / 2).
  expect([...Array(36).keys()].every(col => at(1, col) === 0x20)).toBe(true)
  expect(at(2, 2 + 9)).toBe(0x2580)
})

const cacheMod = {
  name: 'tachyons-cache',
  register: (on => {
    on('session.measure', async ($, e, next) => {
      await $.state.set({ plugin: 'tachyons-cache', key: 'status' }, {
        isEnabled: true,
        isBusy: false,
        pings: 3,
        maxPings: 12,
        intervalMs: 270_000,
        nextAt: Date.now() + 270_000,
        lastReadTokens: 41_000,
      })
      return next(e)
    })
  }) as Register,
}

test('sidebar shows the tachyons-cache status', { plugins: [cacheMod] }, async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({
    plugin: 'tachyons-sidebar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'tachyons-sidebar',
    props: PANE_PROPS,
  })
  expect(await ui.find({ type: 'Text', text: /CACHE.*3\/12 pings/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /warm · 41k read · next \d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

const liveVisualize = {
  name: 'tachyons-visualize',
  register: (on => {
    on('session.measure', async ($, e, next) => {
      await $.state.set({ plugin: 'tachyons-visualize', key: 'status' }, {
        isRunning: true,
        port: 50384,
        screen: 'layout-v2',
        screens: 2,
        clicks: 1,
      })
      return next(e)
    })
  }) as Register,
}

const stoppedVisualize = {
  name: 'tachyons-visualize',
  register: (on => {
    on('session.measure', async ($, e, next) => {
      await $.state.set({ plugin: 'tachyons-visualize', key: 'status' }, {
        isRunning: false,
        port: 50384,
        screen: 'layout-v2',
        screens: 2,
        clicks: 1,
      })
      return next(e)
    })
  }) as Register,
}

test('sidebar shows tachyons-visualize while it runs', { plugins: [liveVisualize] }, async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({
    plugin: 'tachyons-sidebar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'tachyons-sidebar',
    props: PANE_PROPS,
  })
  expect(await ui.find({ type: 'Text', text: /VISUALIZE ─+ :50384/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /live · layout-v2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 screens · 1 click$/ })).toBeDefined()
  await ui.unmount()
})

test('sidebar hides tachyons-visualize once it stops', { plugins: [stoppedVisualize] }, async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({
    plugin: 'tachyons-sidebar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'tachyons-sidebar',
    props: PANE_PROPS,
  })
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /VISUALIZE/ })).toBeUndefined()
  await ui.unmount()
})

import { expect, test } from 'claude-code/testing'

import {
  ciRunIdOf,
  ffmpegInputOf,
  firstCommand,
  kindOf,
  labelOf,
  median,
  parseFfmpegProgress,
  parseGhRun,
  parseTaskNotification,
  withProgressFile,
} from '../hooks/commands'
import { clock, duration, meter, remaining } from '../hooks/format'
import { blocks, planFromTodos, planRow, rowsOf, sliding } from '../hooks/register'

// The test environment has a timer; the API types do not name it.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
}

test('commands get a short label and a kind', async () => {
  expect(firstCommand('cd app && FOO=1 npm test -- --watch')).toBe('npm test -- --watch')
  expect(labelOf('cd app && npm test')).toBe('npm test')
  expect(labelOf('gh run watch 123 --exit-status')).toBe('gh run watch')
  expect(labelOf('/usr/local/bin/ffmpeg -i in.mp4 out.mp4')).toBe('ffmpeg')
  expect(labelOf('cargo build --release')).toBe('cargo build')
  expect(labelOf('ls -la')).toBe('ls')
  expect(kindOf('gh run watch 123')).toBe('ci')
  expect(kindOf('gh pr checks --watch')).toBe('ci')
  expect(kindOf('ffmpeg -i a.mov b.mp4')).toBe('render')
  expect(kindOf('npm test')).toBe('shell')
  expect(ciRunIdOf('gh run watch 4567 --exit-status')).toBe('4567')
  expect(ciRunIdOf('gh pr checks')).toBeUndefined()
})

test('ffmpeg lines get a progress file and give up their input', async () => {
  expect(withProgressFile('ffmpeg -i "my clip.mov" -c:v libx264 out.mp4', '/t/p.txt')).toBe(
    "ffmpeg -progress '/t/p.txt' -nostats -i \"my clip.mov\" -c:v libx264 out.mp4",
  )
  expect(withProgressFile('ffmpeg -progress x -i a b', '/t/p.txt')).toBe('ffmpeg -progress x -i a b')
  expect(withProgressFile('cd clips && ffmpeg -i a.mov b.mp4', '/t/p.txt')).toBe("cd clips && ffmpeg -progress '/t/p.txt' -nostats -i a.mov b.mp4")
  // The word inside text, as in a heredoc or an echo, is left alone.
  const heredoc = "cat > README.md <<'EOF'\n│ ◠ ff" + "mpeg        render\nEOF"
  expect(withProgressFile(heredoc, '/t/p.txt')).toBe(heredoc)
  expect(kindOf(heredoc)).toBe('shell')
  expect(kindOf("echo 'run ff" + "mpeg later'")).toBe('shell')
  expect(ffmpegInputOf('ffmpeg -y -i "my clip.mov" out.mp4')).toBe('my clip.mov')
  expect(ffmpegInputOf("ffmpeg -i 'a.mov' out.mp4")).toBe('a.mov')
  expect(ffmpegInputOf('ffmpeg -i a.mov out.mp4')).toBe('a.mov')
})

test('ffmpeg progress and gh run output parse', async () => {
  const progress = ['frame=10', 'fps=24.5', 'out_time=00:00:05.500000', 'speed=1.5x', 'progress=continue', 'frame=20', 'fps=25.1', 'out_time=00:00:10.000000', 'speed=1.6x', 'progress=end', ''].join('\n')
  expect(parseFfmpegProgress(progress)).toEqual({ outMs: 10_000, fps: 25, speed: '1.6', isDone: true })
  expect(parseFfmpegProgress('out_time_us=2500000\nprogress=continue\n')).toEqual({ outMs: 2500, fps: undefined, speed: undefined, isDone: false })
  expect(parseFfmpegProgress('')).toBeUndefined()

  const run = parseGhRun(
    JSON.stringify({
      status: 'in_progress',
      conclusion: '',
      jobs: [
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'test', status: 'in_progress', conclusion: '' },
        { name: 'lint', status: 'queued', conclusion: '' },
        { name: 'docs', status: 'completed', conclusion: 'skipped' },
      ],
    }),
    '42',
  )
  expect(run.done).toBe(2)
  expect(run.total).toBe(4)
  expect(run.jobs.map(j => j.status)).toEqual(['done', 'running', 'queued', 'skipped'])
  expect(run.conclusion).toBeUndefined()

  expect(parseTaskNotification('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>')).toEqual({ taskId: 'b1', status: 'completed' })
  expect(parseTaskNotification('plain text')).toBeUndefined()
})

test('formatting', async () => {
  expect(duration(42_000)).toBe('42s')
  expect(duration(65_000)).toBe('1m 05s')
  expect(duration(3_780_000)).toBe('1h 03m')
  expect(clock(41_000)).toBe('00:41')
  expect(clock(3_725_000)).toBe('1:02:05')
  expect(meter(0.5, 10)).toEqual(['━━━━━', '╌╌╌╌╌'])
  expect(remaining(0.25, 10_000)).toBe(30_000)
  expect(remaining(0, 10_000)).toBeUndefined()
  expect(median([5, 1, 3])).toBe(3)
  expect(median([1, 2, 3, 4])).toBe(3)
  expect(median([])).toBeUndefined()
})

test('rows show agents, CI jobs and renders', async () => {
  const at = 100_000
  const rows = rowsOf(
    [
      { id: 'a1', type: 'Explore', description: 'find auth handlers', status: 'running', startedAt: at - 72_000, tools: 9, estimateMs: 112_000 },
      { id: 'a2', type: 'claude', description: 'write tests', status: 'completed', startedAt: at - 200_000, endedAt: at - 77_000, tools: 14 },
    ],
    [
      {
        id: 'c1', label: 'gh run watch', command: 'gh run watch 42', kind: 'ci', startedAt: at - 130_000, isBackground: false,
        ci: { runId: '42', status: 'in_progress', done: 3, total: 7, jobs: [{ name: 'build', status: 'done' }, { name: 'test', status: 'running' }, { name: 'lint', status: 'queued' }] },
      },
      {
        id: 'c2', label: 'ffmpeg', command: 'ffmpeg -i in.mp4 out.mp4', kind: 'render', startedAt: at - 62_000, isBackground: true,
        render: { outMs: 41_000, durationMs: 52_000, fps: 24, speed: '1.4', isDone: false },
      },
      { id: 'c3', label: 'npm test', command: 'npm test', kind: 'shell', startedAt: at - 80_000, isBackground: false, estimateMs: 60_000 },
      { id: 'c4', label: 'cargo build', command: 'cargo build --release', kind: 'shell', startedAt: at - 50_000, endedAt: at - 8_000, isBackground: false, isError: true },
    ],
    at,
  )
  const info = rows.map(r => r.info.map(p => p.text).join(''))
  expect(rows.map(r => `${r.name}|${r.detail}|${r.stat.text}`)).toEqual([
    'Explore|find auth handlers|64%',
    'claude|write tests|done',
    'gh run watch|CI run 42|3/7',
    'ffmpeg|render|79%',
    'npm test|npm test|97%',
    'cargo build|cargo build --release|failed',
  ])
  expect(info).toEqual([
    '1m 12s · ~40s left · 9 tools',
    '2m 03s · 14 tools',
    '✓ build ◐ test ○ lint  · 2m 10s',
    '00:41 / 00:52 · 24 fps · 1.4× · 1m 02s · ~17s left · background',
    '1m 20s · 20s over estimate',
    '42s',
  ])
  expect(rows[0]!.glyph.color).toBe('claude')
  expect(rows[5]!.glyph).toEqual({ text: '✗', color: 'error' })
  expect(rows[4]!.info[2]!.color).toBe('warning')
  expect(blocks(0.5, 10)).toEqual(['━━━━━', '─────'])
  expect(blocks(0.375, 4)).toEqual(['━╸', '──'])
  expect(blocks(1, 3)).toEqual(['━━━', ''])
  expect(sliding(0, 10)).toEqual(['', '━━━', '───────'])
  expect(sliding(3000, 10)).toEqual(['───', '━━━', '────'])
  expect(sliding(7000, 10)).toEqual(['───────', '━━━', ''])
  expect(sliding(9000, 10)).toEqual(['─────', '━━━', '──'])
})

test('the band shows a running command, then its end', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async () => {
    await gate
    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })

  const running = $.tool.call({ tool: 'Bash', command: 'cd app && npm test', tool_use_id: 'toolu_1' } as never)
  await new Promise<void>(resolve => setTimeout(() => resolve(), 50))

  const live = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await live.find({ type: 'Text', text: /◉ progress/ })).toBeDefined()
  expect(await live.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  expect(await live.find({ type: 'Text', text: /^npm test$/ })).toBeDefined()
  expect(await live.find({ type: 'Text', text: /first run, no estimate/ })).toBeDefined()
  await live.unmount()

  release()
  await running

  const after = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await after.find({ type: 'Text', text: /1 finished/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /^ done$/ })).toBeDefined()
  await after.unmount()
})

test('the band yields to a survey and to the toggle', async ($, on) => {
  // The engine's own band, drawn when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Text } = $.ui.resolve({ surface: 'terminal', component: 'AbovePrompt' } as never)
    return h(Text, {}, 'engine band') as never
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'toolu_2' } as never)

  const survey = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: /ls/ })).toBeUndefined()
  expect(await survey.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await survey.unmount()

  await $.command.run({ command: 'tachyons-progress' } as never)
  const hidden = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ type: 'Text', text: /ls/ })).toBeUndefined()
  await hidden.unmount()
})

test('a render command is given a progress file', async ($, on) => {
  let seen = ''
  let made = ''
  on('fs.write', ($, e) => {
    made = e.path
    return { value: undefined }
  })
  on('tool.call', ($, e) => {
    seen = (e as unknown as { command: string }).command
    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })
  await $.tool.call({ tool: 'Bash', command: 'ffmpeg -i in.mp4 out.mp4', tool_use_id: 'toolu_3' } as never)
  expect(seen).toMatch(/^ffmpeg -progress '.*tachyons-progress\/toolu_3\.txt' -nostats -i in\.mp4 out\.mp4$/)
  expect(made).toMatch(/tachyons-progress\/toolu_3\.txt$/)
})

test('a render command runs as written when the progress file cannot be made', async ($, on) => {
  let seen = ''
  on('fs.write', () => {
    throw new Error('EACCES')
  })
  on('tool.call', ($, e) => {
    seen = (e as unknown as { command: string }).command
    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })
  await $.tool.call({ tool: 'Bash', command: 'ffmpeg -i in.mp4 out.mp4', tool_use_id: 'toolu_4' } as never)
  expect(seen).toBe('ffmpeg -i in.mp4 out.mp4')
})

test('a plan row counts tasks done and names the one under way', async () => {
  const p = planFromTodos(
    null,
    [
      { content: 'Set up project', status: 'completed', activeForm: 'Setting up project' },
      { content: 'Build login screen', status: 'in_progress', activeForm: 'Building login screen' },
      { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
    ],
    1000,
  )!
  const row = planRow(p, 5000)
  expect(row.name).toBe('plan')
  expect(row.detail).toBe('1 of 3 tasks')
  expect(row.stat.text).toBe('1/3')
  expect(row.fraction).toBe(1 / 3)
  expect(row.info.map(s => s.text).join('')).toBe('✓◐○  Building login screen')

  const done = planFromTodos(p, p.tasks.map(t => ({ content: t.subject, status: 'completed' as const })), 61_000)!
  expect(done.endedAt).toBe(61_000)
  expect(planRow(done, 61_000).stat.text).toBe('done')
  expect(planFromTodos(p, [], 2000)).toBeNull()
})

test('the band follows TaskCreate and TaskUpdate', async ($, on) => {
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => {
    const subject = (e as unknown as { subject: string }).subject
    return { result: { task: { id: String(++n), subject } } as never }
  })
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => {
    const taskId = (e as unknown as { taskId: string }).taskId
    return { result: { success: true, taskId, updatedFields: ['status'] } as never }
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Scaffold app', description: 'x', activeForm: 'Scaffolding app' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Add auth', description: 'x', activeForm: 'Adding auth' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)

  const band = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: /^plan$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^1 of 2 tasks$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1\/2/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Adding auth/ })).toBeDefined()
  await band.unmount()
})

import { expect, mock, test } from 'claude-code/testing'

import { adbCallOf, adbCallsOf, deviceInfoOf, deviceLabelOf, expandLineVariables, nextPhones, deviceNameOf, nextDevice, parseAdbDevices, transportOf } from '../hooks/adb'

import {
  ciRunIdOf,
  ffmpegInputOf,
  ffmpegSpanMs,
  firstCommand,
  kindOf,
  labelOf,
  median,
  parseFfmpegProgress,
  parseGhRun,
  parseTaskNotification,
  sleepMsOf,
  withProgressFile,
} from '../hooks/commands'
import { clock, duration, meter, remaining } from '../hooks/format'
import { androidBootOf, androidEmulatorsOf, etimeToMs, memory, mergeEmulators, parsePs, parseSimctl, runtimeName, simulatorProcsOf } from '../hooks/emulators'
import { blocks, emulatorRow, phoneRow, planFromTodos, planRow, rowsOf, sliding } from '../hooks/register'

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

test('a line that sleeps is estimated by its sleeps', async () => {
  expect(sleepMsOf('sleep 150; printf "sitemap"')).toBe(150_000)
  expect(sleepMsOf('cd app && sleep 2m && curl x')).toBe(120_000)
  expect(sleepMsOf('sleep 1m 30s; ls')).toBe(90_000)
  expect(sleepMsOf('sleep 5 && sleep 0.5')).toBe(5500)
  expect(sleepMsOf('while ! curl -s x; do sleep 5; done')).toBeUndefined()
  expect(sleepMsOf('npm test')).toBeUndefined()
  expect(sleepMsOf('echo "no sleep 5 here"')).toBeUndefined()
})

test('a sleeping command shows its sleep as the estimate', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async () => {
    await gate
    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })
  const running = $.tool.call({ tool: 'Bash', command: 'sleep 150; echo done', tool_use_id: 'toolu_s' } as never)
  await new Promise<void>(resolve => setTimeout(() => resolve(), 50))
  const live = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await live.find({ type: 'Text', text: /~2m 30s left|~2m 29s left/ })).toBeDefined()
  await live.unmount()
  release()
  await running
})

test('a background command the engine no longer tracks leaves the band', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    const id = (e as unknown as { tool_use_id: string }).tool_use_id
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `task_${id}` } as never }
  })
  on('classic.Stop', () => ({}) as never)
  on('tool.call', { tool: 'TaskStop' }, ($, e) => {
    const taskId = (e as unknown as { task_id: string }).task_id
    return { result: { message: 'stopped', task_id: taskId, task_type: 'local_bash' } as never }
  })
  await $.tool.call({ tool: 'Bash', command: 'python3 -m http.server 8731', tool_use_id: 'b1', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'python3 -m http.server 8843', tool_use_id: 'b2', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', tool_use_id: 'b3', run_in_background: true } as never)

  const before = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await before.find({ type: 'Text', text: /3 running/ })).toBeDefined()
  await before.unmount()

  // b1 died on its own: the stop's in-flight list no longer has it.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [
    { id: 'task_b2', type: 'shell', status: 'running', description: 'server' },
    { id: 'task_b3', type: 'shell', status: 'running', description: 'dev' },
  ] } as never)
  // b2 was stopped.
  await $.tool.call({ tool: 'TaskStop', task_id: 'task_b2' } as never)

  const after = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await after.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /2 finished/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /ended/ })).toBeDefined()
  await after.unmount()
})

test('an ffmpeg line measures only the part it writes', async () => {
  expect(ffmpegSpanMs('ffmpeg -i in.mp4 out.mp4', 60_000)).toBe(60_000)
  expect(ffmpegSpanMs('ffmpeg -ss 10 -i in.mp4 out.mp4', 60_000)).toBe(50_000)
  expect(ffmpegSpanMs('ffmpeg -i in.mp4 -t 5 out.mp4', 60_000)).toBe(5000)
  expect(ffmpegSpanMs('ffmpeg -ss 00:00:10 -i in.mp4 -to 00:00:30 out.mp4', 60_000)).toBe(20_000)
  expect(ffmpegSpanMs('ffmpeg -i - -t 1:30 out.mp4', undefined)).toBe(90_000)
  expect(ffmpegSpanMs('ffmpeg -i - out.mp4', undefined)).toBeUndefined()
})

const bandText = async ($: any) => {
  const band = await $.ui.mount({ plugin: 'tachyons-progress', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  return band
}

test('a refused command leaves no row; an interrupted one ends without failing', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    const command = (e as unknown as { command: string }).command
    if (command.startsWith('rm')) return { deny: 'no' } as never
    return { result: { stdout: '', stderr: '', interrupted: true } as never }
  })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'd1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'd2' } as never)
  const band = await bandText($)
  expect(await band.find({ type: 'Text', text: /rm -rf/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /ended/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /failed/ })).toBeUndefined()
  await band.unmount()
})

test('a notification after a sweep restores how the command went', async ($, on) => {
  on('classic.Stop', () => ({}) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } as never }))
  await $.tool.call({ tool: 'Bash', command: 'npm run build', tool_use_id: 'n1', run_in_background: true } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  let band = await bandText($)
  expect(await band.find({ type: 'Text', text: /ended/ })).toBeDefined()
  await band.unmount()
  await $.session.append({ message: { role: 'user', content: [{ type: 'text', text: '<task-notification><task-id>bg1</task-id><status>failed</status></task-notification>' }] } } as never)
  band = await bandText($)
  expect(await band.find({ type: 'Text', text: /failed/ })).toBeDefined()
  await band.unmount()
})

test('a listed command keeps its row though its id is spelled differently', async ($, on) => {
  on('classic.Stop', () => ({}) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg2' } as never }))
  await $.tool.call({ tool: 'Bash', command: 'python3 -m http.server 9000', tool_use_id: 'k1', run_in_background: true } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [
    { id: 'other-id', type: 'shell', status: 'running', description: 'x', command: 'python3 -m http.server 9000' },
  ] } as never)
  const band = await bandText($)
  expect(await band.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  await band.unmount()
})

test("a subagent's TodoWrite leaves the plan alone", async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Text } = $.ui.resolve({ surface: 'terminal', component: 'AbovePrompt' } as never)
    return h(Text, {}, 'engine band') as never
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} as never }))
  await $.tool.call({ tool: 'TodoWrite', agentId: 'sub1', todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] } as never)
  const band = await bandText($)
  expect(await band.find({ type: 'Text', text: /^plan$/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await band.unmount()
})

const DEVICES = [
  'List of devices attached',
  '192.168.0.110:36007    device product:m3qxxx model:SM_S948B device:m3q transport_id:45',
  'R5CT1234ABC            unauthorized usb:1-1 transport_id:7',
  'emulator-5554          offline product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:44',
  '',
].join('\n')

test('adb lines get a label, a kind and the device they ask for', async () => {
  expect(labelOf('~/Library/Android/sdk/platform-tools/adb -s 192.168.0.110:36007 logcat -v time')).toBe('adb logcat')
  expect(labelOf('adb -d shell am start -n x/.Main')).toBe('adb shell')
  expect(kindOf('~/Library/Android/sdk/platform-tools/adb -s 192.168.0.110:36007 logcat')).toBe('adb')
  expect(kindOf('adb devices -l')).toBe('shell')
  expect(kindOf('adb connect 192.168.0.110:36007')).toBe('shell')
  expect(kindOf('echo "run adb logcat later"')).toBe('shell')
  expect(kindOf('./gradlew installDebug && adb -s emulator-5554 shell am start -n x/.Main')).toBe('adb')

  expect(adbCallOf('~/Library/Android/sdk/platform-tools/adb -s "192.168.0.110:36007" logcat')).toEqual({
    bin: '~/Library/Android/sdk/platform-tools/adb', sub: 'logcat', serial: '192.168.0.110:36007', server: [],
  })
  expect(adbCallOf('ANDROID_SERIAL=emulator-5554 adb -P 5038 install app.apk')).toEqual({
    bin: 'adb', sub: 'install', serial: 'emulator-5554', server: ['-P', '5038'],
  })
  expect(adbCallOf('adb -e logcat')).toEqual({ bin: 'adb', sub: 'logcat', only: 'emulator', server: [] })
  expect(adbCallOf('adb devices && adb -t 45 logcat')).toEqual({ bin: 'adb', sub: 'logcat', transportId: '45', server: [] })
  expect(adbCallOf('adb kill-server')).toBeUndefined()
})

test('adb devices -l parses, and serials say how a device is reached', async () => {
  const listed = parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\n' + DEVICES)
  expect(listed.map(d => `${d.serial}|${d.state}|${d.model ?? ''}|${d.board ?? ''}|${d.transportId ?? ''}`)).toEqual([
    '192.168.0.110:36007|device|SM_S948B|m3q|45',
    'R5CT1234ABC|unauthorized|||7',
    'emulator-5554|offline|sdk_gphone64_arm64|emu64a|44',
  ])
  expect(parseAdbDevices('List of devices attached\nABC  no permissions (missing udev rules?); see [http://x] usb:1-2\n')[0]!.state).toBe(
    'no permissions (missing udev rules?); see [http://x]',
  )
  expect(transportOf({ serial: '192.168.0.110:36007' })).toBe('wifi')
  expect(transportOf({ serial: 'adb-R5CT1234ABC-x1Yz._adb-tls-connect._tcp' })).toBe('wifi')
  expect(transportOf({ serial: 'localhost:5555' })).toBe('tcp')
  expect(transportOf({ serial: 'emulator-5554' })).toBe('emulator')
  expect(transportOf({ serial: 'R5CT1234ABC' })).toBe('usb')
  expect(deviceNameOf("Nocturnal's S26 Ultra\n\n\n", 'SM_S948B')).toBe("Nocturnal's S26 Ultra")
  expect(deviceNameOf('null\nMedium_Phone\n', 'sdk_gphone64_arm64')).toBe('Medium Phone')
  expect(deviceNameOf('\n\n', 'Pixel_8_Pro')).toBe('Pixel 8 Pro')
})

test('a device is followed through drops, reconnects and a new port', async () => {
  const call = adbCallOf('adb -s 192.168.0.110:36007 logcat')!
  const phone = (serial: string, state: string) => `${serial}  ${state} product:m3qxxx model:SM_S948B device:m3q transport_id:45`
  let d = nextDevice(undefined, parseAdbDevices(phone('192.168.0.110:36007', 'device')), call, 1000)
  expect(d).toEqual({ serial: '192.168.0.110:36007', state: 'connected', since: 1000, drops: 0, adbState: 'device', transport: 'wifi', model: 'SM_S948B', board: 'm3q' })
  d = { ...d, name: "Nocturnal's S26 Ultra" }
  expect(deviceLabelOf(d)).toBe("Nocturnal's S26 Ultra · wifi")

  d = nextDevice(d, parseAdbDevices(phone('192.168.0.110:36007', 'offline')), call, 5000)
  expect([d.state, d.since, d.drops]).toEqual(['reconnecting', 5000, 1])
  d = nextDevice(d, [], call, 9000)
  expect([d.state, d.since, d.drops]).toEqual(['disconnected', 9000, 1])
  // Wireless debugging came back on another port: the same phone, so the same name.
  d = nextDevice(d, parseAdbDevices(phone('192.168.0.110:41233', 'device')), call, 12_000)
  expect([d.state, d.serial, d.movedFrom, d.name, d.drops]).toEqual(['connected', '192.168.0.110:41233', '192.168.0.110:36007', "Nocturnal's S26 Ultra", 1])

  // No device named and several listed: adb itself would refuse, so the band says why.
  const any = adbCallOf('adb logcat')!
  expect(nextDevice(undefined, parseAdbDevices(DEVICES), any, 0).error).toBe('3 devices, none named')
  expect(nextDevice(undefined, parseAdbDevices(DEVICES), adbCallOf('adb -e logcat')!, 0).serial).toBe('emulator-5554')
  expect(nextDevice(undefined, [], any, 0).state).toBe('searching')
})

test('an adb row names its phone and says whether it is there', async () => {
  const at = 100_000
  const base = { label: 'adb logcat', command: 'adb -s 192.168.0.110:36007 logcat', kind: 'adb' as const, isBackground: true, startedAt: at - 60_000 }
  const device = { serial: '192.168.0.110:36007', name: "Nocturnal's S26 Ultra", transport: 'wifi' as const, model: 'SM_S948B', drops: 0 }
  const rows = rowsOf(
    [],
    [
      { ...base, id: 'a1', estimateMs: 10_000, devices: [{ ...device, state: 'connected', since: at - 60_000 }] },
      { ...base, id: 'a2', devices: [{ ...device, state: 'reconnecting', adbState: 'offline', since: at - 4000, drops: 1 }] },
      { ...base, id: 'a3', devices: [{ ...device, state: 'disconnected', since: at - 42_000, drops: 1 }] },
      { ...base, id: 'a4', endedAt: at - 1000, isError: true, devices: [{ ...device, state: 'disconnected', since: at - 3000, drops: 1 }] },
      {
        ...base, id: 'a5',
        devices: [
          { ...device, state: 'connected', since: at - 60_000 },
          { serial: '192.168.0.223:42549', name: "Nocturnal's S23 Ultra", transport: 'wifi' as const, state: 'disconnected', since: at - 5000, drops: 1 },
        ],
      },
    ],
    at,
  )
  expect(rows.map(r => r.detail)).toEqual([
    ...Array(4).fill("Nocturnal's S26 Ultra · wifi"),
    "Nocturnal's S26 Ultra + Nocturnal's S23 Ultra",
  ])
  // A device row has no estimate: it runs as long as it is wanted.
  expect(rows.map(r => r.info.map(p => p.text).join(''))).toEqual([
    '● connected · 1m 00s · background',
    '◌ reconnecting 4s · 1m 00s · background',
    '✗ disconnected 42s · 1m 00s · background',
    '59s · ✗ disconnected 2s',
    '● connected  ✗ disconnected 5s · 1m 00s · background',
  ])
  expect(rows[0]!.fraction).toBeUndefined()
  expect(rows[0]!.stat.text).toBe('')
  expect(rows.map(r => r.glyph.color)).toEqual(['claude', 'warning', 'error', 'error', 'error'])
})

test('the band follows the phone of a background adb command', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/t' })
  let listing = '192.168.0.110:36007    device product:m3qxxx model:SM_S948B device:m3q transport_id:45'
  const ran: string[][] = []
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    if (e.argv[0] !== '/Users/t/Library/Android/sdk/platform-tools/adb') throw new Error('ENOENT')
    if (e.argv.includes('devices')) return { value: { exitCode: 0, stdout: `List of devices attached\n${listing}\n`, stderr: '' } } as never
    return { value: { exitCode: 0, stdout: "Nocturnal's S26 Ultra\n\n\n", stderr: '' } } as never
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bgadb' } as never }))
  await $.tool.call({ tool: 'Bash', command: '~/Library/Android/sdk/platform-tools/adb -s 192.168.0.110:36007 logcat', tool_use_id: 'adb1', run_in_background: true } as never)
  await clock.settle()

  let band = await bandText($)
  expect(await band.find({ type: 'Text', text: /^adb logcat$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Nocturnal's S26 Ultra/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /● connected/ })).toBeDefined()
  await band.unmount()
  expect(ran[0]).toEqual(['/Users/t/Library/Android/sdk/platform-tools/adb', 'devices', '-l'])

  listing = '192.168.0.110:36007    offline product:m3qxxx model:SM_S948B device:m3q transport_id:45'
  await clock.advance(3000)
  band = await bandText($)
  expect(await band.find({ type: 'Text', text: /◌ reconnecting/ })).toBeDefined()
  await band.unmount()

  listing = ''
  await clock.advance(3000)
  band = await bandText($)
  expect(await band.find({ type: 'Text', text: /✗ disconnected/ })).toBeDefined()
  await band.unmount()
})

test('adb lines that reach adb and the phone through variables and functions', async () => {
  const sdk = '~/Library/Android/sdk/platform-tools/adb'
  expect(expandLineVariables('A=~/sdk/adb; D="192.168.0.5:5555"; $A -s ${D} logcat')).toBe('A=~/sdk/adb; D="192.168.0.5:5555"; ~/sdk/adb -s 192.168.0.5:5555 logcat')
  // Set twice to different values, or to something that runs: left as written.
  expect(expandLineVariables('D=a; D=b; adb -s $D logcat')).toBe('D=a; D=b; adb -s $D logcat')
  expect(expandLineVariables('T=$(gh auth token); echo $T')).toBe('T=$(gh auth token); echo $T')

  const s26 = `A=${sdk}; D=192.168.0.110:36007; S=/tmp/x; \\\n$A -s $D shell am start -n x/.Main && $A -s $D logcat -d`
  expect(labelOf(s26)).toBe('adb shell')
  expect(kindOf(s26)).toBe('adb')
  expect(adbCallsOf(s26).map(c => c.serial)).toEqual(['192.168.0.110:36007'])

  const both = `A=${sdk}; ev() { $A -s 192.168.0.223:42549 shell "$@"; }; ev getprop; $A -s 192.168.0.110:36007 logcat`
  expect(adbCallsOf(both).map(c => c.serial)).toEqual(['192.168.0.223:42549', '192.168.0.110:36007'])
  expect(adbCallsOf(`adb() { ${sdk} -s 192.168.0.110:36007 "$@"; }; adb logcat`).map(c => c.serial)).toEqual(['192.168.0.110:36007'])
  expect(adbCallsOf(`for D in a b; do ${sdk} -s $D logcat -d; done`).map(c => c.serial)).toEqual(['$D'])
  expect(nextDevice(undefined, [], adbCallsOf(`for D in a b; do adb -s $D logcat; done`)[0]!, 0).error).toBe('device set by $D')
  expect(adbCallsOf('adb devices -l; adb connect 192.168.0.110:36007')).toEqual([])
})

const PS = [
  '  2763    19:31:18  46368 /Applications/Claude.app/Contents/MacOS/Claude --type=utility',
  '48543    05:17:47 1598528 /Users/t/Library/Android/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd Medium_Phone -memory 1536 -gpu host -port 5556 -no-snapshot-load',
  // As CoreSimulator starts it today: no path, the device folder its only argument.
  '51000 1-02:03:04  18576 launchd_sim /Users/t/Library/Developer/CoreSimulator/Devices/0C550FB1-9E0A-4F91-B9B7-28115AB382CD/data/var/run/launchd_bootstrap.plist',
  '51001       00:31  24240 /Library/Developer/CoreSimulator/Volumes/iOS_23F77/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.5.simruntime/Contents/Resources/RuntimeRoot/usr/libexec/UserEventAgent (System)',
  '',
].join('\n')

test('emulators and simulators are found in ps and simctl', async () => {
  expect(etimeToMs('05:17:47')).toBe((5 * 3600 + 17 * 60 + 47) * 1000)
  expect(etimeToMs('01:02')).toBe(62_000)
  expect(etimeToMs('1-02:03:04')).toBe(((24 + 2) * 3600 + 3 * 60 + 4) * 1000)
  const procs = parsePs(PS)
  expect(procs.length).toBe(4)
  expect(simulatorProcsOf(parsePs('77 00:10 1 /Applications/Xcode.app/x/sbin/launchd_sim /Users/t/Devices/X/data\n')).length).toBe(1)
  expect(androidEmulatorsOf(procs)).toEqual([
    { pid: 48543, avd: 'Medium_Phone', serial: 'emulator-5556', upMs: etimeToMs('05:17:47'), rssKb: 1598528, adb: '/Users/t/Library/Android/sdk/platform-tools/adb' },
  ])
  expect(simulatorProcsOf(procs).map(p => p.pid)).toEqual([51000])
  expect(runtimeName('com.apple.CoreSimulator.SimRuntime.iOS-18-2')).toBe('iOS 18.2')
  expect(runtimeName('com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4')).toBe('iOS 27.2')
  expect(runtimeName('com.apple.CoreSimulator.SimRuntime.xrOS-2-0')).toBe('visionOS 2.0')
  const sims = parseSimctl(JSON.stringify({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
      { udid: '0C550FB1-9E0A-4F91-B9B7-28115AB382CD', name: 'iPhone 16 Pro', state: 'Booted', isAvailable: true },
      { udid: 'AAAA', name: 'iPad Air', state: 'Shutdown', isAvailable: true },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-2': [{ udid: 'BBBB', name: 'Apple Watch Series 10', state: 'Booting' }],
  } }))
  expect(sims).toEqual([
    { udid: '0C550FB1-9E0A-4F91-B9B7-28115AB382CD', name: 'iPhone 16 Pro', state: 'Booted', os: 'iOS 18.2' },
    { udid: 'BBBB', name: 'Apple Watch Series 10', state: 'Booting', os: 'watchOS 11.2' },
  ])
  expect(androidBootOf('1\n17\n37\n')).toEqual({ isBooted: true, os: 'Android 17 · API 37' })
  expect(androidBootOf('\n\n\n')).toEqual({ isBooted: false })
  expect(memory(1598528)).toBe('1.5 GB')
  expect(memory(90000)).toBe('88 MB')
})

test('emulator rows show what runs, its OS, uptime and memory, then end', async () => {
  const at = 1_000_000
  const emu = { id: 'android:1', platform: 'android' as const, name: 'Medium Phone', serial: 'emulator-5554', state: 'booted' as const, os: 'Android 17 · API 37', startedAt: at - 3_780_000, rssKb: 1598528 }
  const sim = { id: 'ios:X', platform: 'ios' as const, name: 'iPhone 16 Pro', serial: 'X', state: 'booting' as const, os: 'iOS 18.2', startedAt: at - 12_000 }
  const text = (r: ReturnType<typeof emulatorRow>) => r.info.map(p => p.text).join('')
  const a = emulatorRow(emu, at)
  expect([a.name, a.detail, a.stat.text, a.hasNoMeter, a.glyph.text]).toEqual(['emulator', 'Medium Phone', 'on', true, '●'])
  expect(text(a)).toBe('Android 17 · API 37 · emulator-5554 · up 1h 03m · 1.5 GB')
  const b = emulatorRow(sim, at)
  expect([b.name, b.detail, b.stat.text, b.hasNoMeter, b.glyph.color]).toEqual(['simulator', 'iPhone 16 Pro', '…', false, 'warning'])
  expect(text(b)).toBe('booting 12s · iOS 18.2 · up 12s')

  // ps rounds to the second: a start that moves a little stays put; one gone ends now.
  const merged = mergeEmulators([emu, sim], [{ ...emu, startedAt: emu.startedAt + 900, os: undefined }], at)
  expect(merged.map(e => [e.id, e.startedAt, e.os, e.endedAt])).toEqual([
    ['android:1', emu.startedAt, 'Android 17 · API 37', undefined],
    ['ios:X', sim.startedAt, 'iOS 18.2', at],
  ])
  expect(text(emulatorRow(merged[1]!, at + 2000))).toBe('stopped after 12s')
})

test('a session shows the emulators and simulators running on the machine', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/t', TMPDIR: '/tmp/' })
  mock.store(on)
  let ps = PS
  const asked: string[] = []
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    asked.push(argv.slice(0, 2).join(' '))
    if (argv[0] === 'ps') return { value: { exitCode: 0, stdout: ps, stderr: '' } } as never
    if (argv[0] === 'xcrun') {
      const devices = { 'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [{ udid: '0C550FB1-9E0A-4F91-B9B7-28115AB382CD', name: 'iPhone 16 Pro', state: 'Booted' }] }
      return { value: { exitCode: 0, stdout: JSON.stringify({ devices }), stderr: '' } } as never
    }
    if (argv[0] === '/Users/t/Library/Android/sdk/platform-tools/adb') return { value: { exitCode: 0, stdout: '1\n17\n37\n', stderr: '' } } as never
    throw new Error('ENOENT')
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ cwd: '/work', source: 'startup' } as never)
  await clock.settle()

  let band = await bandText($)
  expect(await band.find({ type: 'Text', text: /^emulator$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Medium Phone$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Android 17 · API 37 · emulator-5556 · up 5h 17m · 1\.5 GB/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^simulator$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /iOS 18\.2 · up 1h 03m|iOS 18\.2 · up 26h/ })).toBeDefined()
  await band.unmount()

  // Booted once: the next look runs ps alone.
  asked.length = 0
  await clock.advance(5000)
  expect(asked).toEqual(['ps -axo'])

  ps = ''
  await clock.advance(5000)
  band = await bandText($)
  expect(await band.find({ type: 'Text', text: /stopped after/ })).toBeDefined()
  await band.unmount()
})

test('every phone adb lists has a row, followed through drops and new ports', async () => {
  const s26 = (serial: string, state = 'device') => `${serial}  ${state} product:m3qxxx model:SM_S948B device:m3q transport_id:45`
  const s23 = '192.168.0.223:42549  device product:dm3qxxx model:SM_S918B device:dm3q transport_id:13'
  const emu = 'emulator-5554  device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:44'
  let list = nextPhones([], parseAdbDevices([s26('192.168.0.110:36007'), s23, emu].join('\n')), 0)
  expect(list.map(p => `${p.id}|${p.state}`)).toEqual(['192.168.0.110:36007|connected', '192.168.0.223:42549|connected'])

  list = nextPhones(list, parseAdbDevices([s26('192.168.0.110:36007', 'offline'), s23].join('\n')), 3000)
  expect(list.map(p => p.state)).toEqual(['reconnecting', 'connected'])
  list = nextPhones(list, parseAdbDevices(s23), 6000)
  expect(list.map(p => p.state)).toEqual(['disconnected', 'connected'])
  // Back on a new port: the same row, not a second S26.
  list = nextPhones(list, parseAdbDevices([s23, s26('192.168.0.110:41001')].join('\n')), 9000)
  expect(list.map(p => `${p.id}|${p.serial}|${p.state}|${p.drops}`)).toEqual([
    '192.168.0.110:36007|192.168.0.110:41001|connected|1',
    '192.168.0.223:42549|192.168.0.223:42549|connected|0',
  ])

  expect(deviceInfoOf("Nocturnal's S26 Ultra\n\n\n17\n37\n", 'SM_S948B')).toEqual({ name: "Nocturnal's S26 Ultra", os: 'Android 17 · API 37' })
  const row = phoneRow({ ...list[0]!, name: "Nocturnal's S26 Ultra", os: 'Android 17 · API 37' }, 9000)
  expect([row.name, row.detail, row.stat.text, row.glyph.text]).toEqual(['phone', "Nocturnal's S26 Ultra", 'on', '●'])
  expect(row.info.map(p => p.text).join('')).toBe('● connected · reconnected 1× · Android 17 · API 37 · 192.168.0.110:41001')
  const gone = phoneRow({ ...list[1]!, state: 'disconnected', since: 0 }, 75_000)
  expect([gone.stat.text, gone.glyph.color, gone.info[0]!.text]).toEqual(['off', 'error', '✗ disconnected 1m 15s'])
})

test('a session shows the phones adb lists while its server runs', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/t' })
  mock.store(on)
  const adb = '/Users/t/Library/Android/sdk/platform-tools/adb'
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    if (argv[0] === 'ps') return { value: { exitCode: 0, stdout: ' 8545 01-21:15:01  9000 adb -L tcp:5037 fork-server server --reply-fd 4\n', stderr: '' } } as never
    if (argv[0] !== adb) throw new Error('ENOENT')
    if (argv[1] === 'devices') {
      const out = 'List of devices attached\n192.168.0.110:36007 device product:m3qxxx model:SM_S948B device:m3q transport_id:45\n192.168.0.223:42549 device product:dm3qxxx model:SM_S918B device:dm3q transport_id:13\n'
      return { value: { exitCode: 0, stdout: out, stderr: '' } } as never
    }
    const name = argv[2] === '192.168.0.110:36007' ? "Nocturnal's S26 Ultra" : "Nocturnal's S23 Ultra"
    return { value: { exitCode: 0, stdout: `${name}\n\n\n17\n37\n`, stderr: '' } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ cwd: '/work', source: 'startup' } as never)
  await clock.settle()
  const band = await bandText($)
  expect(await band.find({ type: 'Text', text: /^Nocturnal's S26 Ultra$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Nocturnal's S23 Ultra$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /● connected · Android 17 · API 37 · 192\.168\.0\.110:36007/ })).toBeDefined()
  await band.unmount()
})

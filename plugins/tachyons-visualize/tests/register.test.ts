import { expect, mock, test } from 'claude-code/testing'
import type { VisualizeStatus } from '../types'

const DIR = '/repo/.tachyons/visualize/current'
const INFO = JSON.stringify({ pid: 4242, port: 50384, url: 'http://127.0.0.1:50384/?key=k' })

test('publishes a running server with its newest screen and clicks', async ($, on) => {
  mock.clock(on)
  let seen: VisualizeStatus | undefined
  on('state.set', ($, e, next) => {
    seen = e.value as VisualizeStatus
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (e.path === `${DIR}/state/server-info`) return { value: INFO }
    if (e.path === `${DIR}/state/events`) return { value: '{"choice":"a","screen":"layout-v2.html"}\n' }
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({
    value: [
      { name: 'layout.html', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
      { name: 'layout-v2.html', kind: 'file', size: 1, mtimeMs: 2, isLink: false },
    ],
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect(seen).toEqual({
    isRunning: true,
    sessionDir: DIR,
    port: 50384,
    url: 'http://127.0.0.1:50384/?key=k',
    screen: 'layout-v2',
    screens: 2,
    clicks: 1,
  })
})

test('a dead pid reads as stopped', async ($, on) => {
  mock.clock(on)
  let seen: VisualizeStatus | undefined
  on('state.set', ($, e, next) => {
    seen = e.value as VisualizeStatus
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (e.path === `${DIR}/state/server-info`) return { value: INFO }
    throw new Error('ENOENT')
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect(seen?.isRunning).toBe(false)
})

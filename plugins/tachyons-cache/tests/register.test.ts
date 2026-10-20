import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0 }
const opts = { options: { intervalSeconds: 60, maxPings: 2 } }

test('pings with a fork after the interval, and stops at maxPings', opts, async ($, on) => {
  const clock = mock.clock(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true as const, text: 'ok', usage } }
  })
  const statuses: (string | undefined)[] = []
  const published: unknown[] = []
  on('state.set', ($, e, next) => (published.push(e.value), next(e)))
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('turn.start', ($, e) => e as never)
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.advance(59_000)
  expect(forks).toBe(0)
  await clock.advance(1_000)
  expect(forks).toBe(1)
  expect(published.at(-1)).toMatchObject({ pings: 1, maxPings: 2, lastReadTokens: 40000, isBusy: false })
  await clock.advance(60_000)
  expect(forks).toBe(2)
  await clock.advance(300_000)
  expect(forks).toBe(2)
  expect(statuses).toContain('cache warm · 40k read · 1/2')
  expect(statuses.at(-1)).toBe('cache: warmed 2x, stopped')
})

test('a new turn cancels the pending ping', opts, async ($, on) => {
  const clock = mock.clock(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true as const, text: 'ok', usage } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', ($, e) => e as never)
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.advance(30_000)
  await $.turn.start({ text: 'again', turnId: 't2' })
  await clock.advance(120_000)
  expect(forks).toBe(0)
})

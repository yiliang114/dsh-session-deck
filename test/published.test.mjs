import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublished } from '../scripts/verify-published.mjs'

const pkg = {
  name: '@example/deck',
  version: '0.1.2',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  engines: { dsh: '0.2.1-rc.2' },
}
const metadata = { ...pkg, dist: { integrity: 'sha512-example' } }

function registry(responses, options = {}) {
  const calls = []
  const waits = []
  const logs = []
  return {
    calls, waits, logs,
    run: () => verifyPublished(pkg, {
      fetch: async (...args) => {
        calls.push(args)
        const response = responses.shift()
        assert.ok(response, 'Unexpected additional registry request')
        if (response instanceof Error) throw response
        return response
      },
      wait: async delay => { waits.push(delay) },
      log: message => logs.push(message),
      ...options,
    }),
  }
}

const ok = (value = metadata) => Response.json(value)
const status = code => new Response(null, { status: code })

test('retries propagation 404 then verifies exact public version without auth', async () => {
  const check = registry([status(404), ok()])
  assert.deepEqual(await check.run(), metadata)
  assert.equal(check.calls.length, 2)
  assert.deepEqual(check.waits, [15_000])
  const [url, options] = check.calls[0]
  assert.equal(url, 'https://registry.npmjs.org/%40example%2Fdeck/0.1.2')
  assert.deepEqual(options.headers, { accept: 'application/json' })
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(options.redirect, 'error')
  assert.match(check.logs[0], /attempt 1\/20/)
  assert.match(check.logs.at(-1), /@example\/deck@0.1.2.*sha512-example/)
})

test('persistent 404 exhausts the default twenty attempts with no final wait', async () => {
  const check = registry(Array.from({ length: 20 }, () => status(404)))
  await assert.rejects(check.run(), /HTTP 404.*after 20 attempts/)
  assert.equal(check.calls.length, 20)
  assert.deepEqual(check.waits, Array(19).fill(15_000))
})

for (const code of [429, 500, 503, 599]) {
  test(`retries temporary HTTP ${code}`, async () => {
    const check = registry([status(code), ok()], { delay: 7 })
    await check.run()
    assert.deepEqual(check.waits, [7])
  })
}

for (const code of [401, 403, 400, 302]) {
  test(`HTTP ${code} fails immediately`, async () => {
    const check = registry([status(code)])
    await assert.rejects(check.run(), new RegExp(`unexpected HTTP ${code}`))
    assert.equal(check.calls.length, 1)
    assert.deepEqual(check.waits, [])
  })
}

for (const [field, value, error] of [
  ['name', 'other-package', /name mismatch/],
  ['version', '0.1.1', /version mismatch/],
  ['dist', {}, /integrity is missing or empty/],
  ['dist', { integrity: ' ' }, /integrity is missing or empty/],
  ['dsh', { bundle: { patch: './wrong.yml' } }, /dsh.bundle.patch mismatch/],
  ['engines', { dsh: '0.0.0' }, /engines.dsh mismatch/],
]) {
  test(`invalid published ${field} fails without retry`, async () => {
    const check = registry([ok({ ...metadata, [field]: value })])
    await assert.rejects(check.run(), error)
    assert.equal(check.calls.length, 1)
    assert.deepEqual(check.waits, [])
  })
}

test('checks gitHead when present and permits npm to omit it', async () => {
  await registry([ok()], { expectedGitHead: 'release-sha' }).run()
  await registry([ok({ ...metadata, gitHead: 'release-sha' })], { expectedGitHead: 'release-sha' }).run()
  const check = registry([ok({ ...metadata, gitHead: 'other-sha' })], { expectedGitHead: 'release-sha' })
  await assert.rejects(check.run(), /gitHead mismatch/)
  assert.equal(check.calls.length, 1)
  assert.deepEqual(check.waits, [])
})

test('network failures are unexpected and fail without retry', async () => {
  const check = registry([new TypeError('fetch failed')])
  await assert.rejects(check.run(), /fetch failed/)
  assert.equal(check.calls.length, 1)
  assert.deepEqual(check.waits, [])
})

test('request timeout aborts the request without retry', async () => {
  let calls = 0
  // Keep the event loop alive because AbortSignal.timeout uses an unref timer.
  const keepAlive = setTimeout(() => {}, 1_000)
  try {
    await assert.rejects(verifyPublished(pkg, {
      timeout: 5,
      fetch: async (_url, { signal }) => {
        calls++
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      wait: async () => assert.fail('Timeout must not retry'),
      log: () => {},
    }), { name: 'TimeoutError' })
    assert.equal(calls, 1)
  } finally {
    clearTimeout(keepAlive)
  }
})

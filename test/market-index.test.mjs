import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPublishedRelease, updateMarketIndex } from '../scripts/update-market-index.mjs'

const pkg = {
  name: '@example/plugin', version: '0.1.4',
  dsh: { bundle: { patch: './cordis.patch.yml' } }, engines: { dsh: '0.2.1-rc.2' },
}
const time = '2026-10-23T16:00:00.000Z'
const complete = () => ({ name: pkg.name, versions: { [pkg.version]: structuredClone(pkg) }, time: { [pkg.version]: time } })
const quiet = { log() {}, delay: 0, wait: async () => {} }

test('market history retries missing version and time before using registry timestamp', async () => {
  const missingVersion = { name: pkg.name, versions: {}, time: {} }
  const missingTime = complete()
  delete missingTime.time[pkg.version]
  const responses = [missingVersion, missingTime, complete()]
  let calls = 0
  let waits = 0
  const result = await fetchPublishedRelease(pkg, {
    ...quiet, attempts: 3,
    wait: async () => { waits++ },
    fetch: async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/%40example%2Fplugin')
      assert.equal(options.headers.accept, 'application/json')
      assert.equal(options.headers.authorization, undefined)
      return Response.json(responses[calls++])
    },
  })
  assert.equal(calls, 3)
  assert.equal(waits, 2)
  assert.deepEqual(result.published, pkg)
  assert.equal(result.timestamp, Date.parse(time) / 1000)
})

test('market history retries transient HTTP failures within the bound', async () => {
  const statuses = [404, 429, 503, 200]
  const result = await fetchPublishedRelease(pkg, {
    ...quiet, attempts: statuses.length,
    fetch: async () => {
      const status = statuses.shift()
      return status === 200 ? Response.json(complete()) : new Response('', { status })
    },
  })
  assert.equal(result.published.version, pkg.version)
})

test('market history stops after bounded missing version, missing time or 404 responses', async () => {
  const missingTime = complete()
  delete missingTime.time[pkg.version]
  for (const response of [() => new Response('', { status: 404 }), () => Response.json({ name: pkg.name, versions: {} }), () => Response.json(missingTime)]) {
    let calls = 0
    await assert.rejects(fetchPublishedRelease(pkg, {
      ...quiet, attempts: 2, fetch: async () => { calls++; return response() },
    }), /not ready after 2 attempts/)
    assert.equal(calls, 2)
  }
})

test('market history fails immediately for auth errors and metadata mismatches', async () => {
  const badName = complete()
  badName.name = 'wrong'
  const badVersion = complete()
  badVersion.versions[pkg.version].version = '0.1.3'
  const badPatch = complete()
  badPatch.versions[pkg.version].dsh.bundle.patch = './wrong.yml'
  const badEngine = complete()
  badEngine.versions[pkg.version].engines.dsh = 'wrong'
  for (const response of [() => new Response('', { status: 401 }), () => new Response('', { status: 403 }), ...[badName, badVersion, badPatch, badEngine].map(value => () => Response.json(value))]) {
    let calls = 0
    await assert.rejects(fetchPublishedRelease(pkg, {
      ...quiet, attempts: 3, fetch: async () => { calls++; return response() },
    }), /unexpected HTTP|mismatch/)
    assert.equal(calls, 1)
  }
})

test('market history refuses invalid or nonpositive timestamps rather than inventing one', async () => {
  for (const value of ['not-a-date', '1970-01-01T00:00:00Z', 1234]) {
    const metadata = complete()
    metadata.time[pkg.version] = value
    await assert.rejects(fetchPublishedRelease(pkg, {
      ...quiet, fetch: async () => Response.json(metadata),
    }), /Invalid npm publication timestamp/)
  }
})

test('market update preserves other plugins and prior versions and is idempotent', () => {
  const previous = { version: '0.1.3', publishTimestamp: 100 }
  const other = { name: 'other', versions: [] }
  const index = { schemaVersion: 1, plugins: [{ name: pkg.name, versions: [previous] }, other] }
  const updated = updateMarketIndex(index, pkg, 200)
  assert.deepEqual(updated.plugins.find(entry => entry.name === 'other'), other)
  assert.deepEqual(updated.plugins.find(entry => entry.name === pkg.name).versions[0], previous)
  assert.equal(updated.schemaVersion, 1)
  assert.equal(index.plugins[0].versions.length, 1)
  assert.deepEqual(updateMarketIndex(updated, pkg, 200), updated)
})

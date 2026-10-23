import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export async function fetchPublishedRelease(pkg, {
  fetch = globalThis.fetch,
  wait = setTimeout,
  attempts = 20,
  delay = 15_000,
  timeout = 10_000,
  log = console.log,
} = {}) {
  assert.ok(Number.isInteger(attempts) && attempts > 0, 'attempts must be a positive integer')
  const identity = `${pkg.name}@${pkg.version}`
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`
  for (let attempt = 1; attempt <= attempts; attempt++) {
    log(`Reading publication history for ${identity}: attempt ${attempt}/${attempts}`)
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    })
    let pending
    if (response.status !== 200) {
      await response.body?.cancel()
      assert.ok(response.status === 404 || response.status === 429 || (response.status >= 500 && response.status <= 599),
        `Registry returned unexpected HTTP ${response.status} for ${identity}`)
      pending = `HTTP ${response.status}`
    } else {
      const metadata = await response.json()
      assert.equal(metadata.name, pkg.name, 'Registry package name mismatch')
      const published = metadata.versions?.[pkg.version]
      if (!published) {
        pending = 'version is missing from publication history'
      } else {
        assert.equal(published.name, pkg.name, 'Published package name mismatch')
        assert.equal(published.version, pkg.version, 'Published package version mismatch')
        assert.equal(published.dsh?.bundle?.patch, pkg.dsh.bundle.patch, 'Published dsh.bundle.patch mismatch')
        assert.equal(published.engines?.dsh, pkg.engines.dsh, 'Published engines.dsh mismatch')
        const time = metadata.time?.[pkg.version]
        if (time === undefined || time === null || time === '') {
          pending = 'publication timestamp is missing from history'
        } else {
          assert.equal(typeof time, 'string', 'Invalid npm publication timestamp')
          const timestamp = Math.floor(Date.parse(time) / 1000)
          assert.ok(Number.isSafeInteger(timestamp) && timestamp > 0, 'Invalid npm publication timestamp')
          return { published, timestamp }
        }
      }
    }
    if (attempt === attempts) throw new Error(`Registry history for ${identity} is not ready after ${attempts} attempts: ${pending}`)
    log(`Registry history pending (${pending}); retrying in ${delay / 1000}s`)
    await wait(delay)
  }
}

export function updateMarketIndex(index, published, timestamp) {
  const previous = index.plugins.find(plugin => plugin.name === published.name)
  const release = {
    version: published.version,
    publishTimestamp: timestamp,
    engines: { dsh: published.engines.dsh },
    source: { type: 'npm', registry: 'https://registry.npmjs.org' },
  }
  const plugin = {
    name: published.name,
    title: 'DSH Session Deck',
    description: published.description,
    author: typeof published.author === 'string' ? published.author : published.author?.name,
    homepage: published.homepage,
    repository: { url: 'https://github.com/yiliang114/dsh-session-deck' },
    versions: [...(previous?.versions ?? []).filter(version => version.version !== release.version), release],
  }
  return { ...index, plugins: [...index.plugins.filter(entry => entry.name !== published.name), plugin] }
}

export async function main() {
  // CWD stays at the checked-out release even when this helper lives in RUNNER_TEMP.
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const indexPath = resolve('market-index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const { published, timestamp } = await fetchPublishedRelease(pkg)
  writeFileSync(indexPath, `${JSON.stringify(updateMarketIndex(index, published, timestamp), null, 2)}\n`)
  console.log(`Updated market index for ${published.name}@${published.version}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}

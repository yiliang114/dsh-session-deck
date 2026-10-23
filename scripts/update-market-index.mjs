import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const indexPath = new URL('market-index.json', root)
const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const view = spec => JSON.parse(execFileSync('npm', ['view', spec, '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }))
// Only registry-confirmed releases belong in the discoverable index.
const published = view(`${pkg.name}@${pkg.version}`)
assert.equal(published.name, pkg.name)
assert.equal(published.version, pkg.version)
assert.equal(published.dsh?.bundle?.patch, pkg.dsh.bundle.patch)
assert.equal(published.engines?.dsh, pkg.engines.dsh)
const timestamp = Math.floor(Date.parse(published.time?.[pkg.version]) / 1000)
assert.ok(Number.isSafeInteger(timestamp) && timestamp > 0, 'Missing npm publication timestamp')
const previous = index.plugins.find(plugin => plugin.name === pkg.name)
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
index.plugins = [...index.plugins.filter(entry => entry.name !== pkg.name), plugin]
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log(`Updated market index for ${published.name}@${published.version}`)

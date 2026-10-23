import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
}))
const files = new Set(packed.files.map(file => file.path))
const required = [
  ...Object.values(manifest.exports),
  manifest.dsh.bundle.patch,
  'README.md',
  'LICENSE',
  'scripts/patch-sidebar-before.mjs',
]
for (const path of required) {
  assert.ok(files.has(path.replace(/^\.\//, '')), `Package is missing ${path}`)
}
for (const path of files) {
  assert.ok(/^(src\/|lib\/|scripts\/patch-sidebar-before\.mjs$|cordis\.patch\.yml$|README\.md$|package\.json$|LICENSE(?:\.[^/]+)?$)/.test(path), `Unexpected package file: ${path}`)
}
assert.equal(packed.name, manifest.name)
assert.equal(packed.version, manifest.version)
console.log(`Package verified: ${packed.name}@${packed.version} (${files.size} files)`)

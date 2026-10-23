import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { name as hostName } from '../src/host.mjs'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

test('published package, host, client loader and Cordis patch agree on package identity', () => {
  let moduleId
  vm.runInNewContext(readFileSync(new URL(pkg.exports['./client'], root), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { moduleId = entry.id } } },
  })
  assert.equal(moduleId, pkg.name)
  assert.equal(hostName, pkg.name)
  const patch = readFileSync(new URL(pkg.dsh.bundle.patch, root), 'utf8')
  assert.ok(patch.includes(`name: '${pkg.name}'`))
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.publishConfig.access, 'public')
})

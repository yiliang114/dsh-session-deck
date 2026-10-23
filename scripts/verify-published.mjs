import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export async function verifyPublished(pkg, {
  fetch = globalThis.fetch,
  wait = setTimeout,
  attempts = 20,
  delay = 15_000,
  timeout = 10_000,
  expectedGitHead,
  log = console.log,
} = {}) {
  assert.ok(Number.isInteger(attempts) && attempts > 0, 'attempts must be a positive integer')
  const identity = `${pkg.name}@${pkg.version}`
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`

  for (let attempt = 1; attempt <= attempts; attempt++) {
    log(`Verifying ${identity}: attempt ${attempt}/${attempts}`)
    // Fetch the public endpoint directly: npm configuration and auth are not used.
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    })
    if (response.status !== 200) {
      await response.body?.cancel()
      const temporary = response.status === 404 || response.status === 429 || (response.status >= 500 && response.status <= 599)
      if (!temporary) throw new Error(`Registry returned unexpected HTTP ${response.status} for ${identity}`)
      if (attempt === attempts) throw new Error(`Registry still returned HTTP ${response.status} for ${identity} after ${attempts} attempts`)
      log(`Registry HTTP ${response.status}; retrying in ${delay / 1000}s (${attempt}/${attempts})`)
      await wait(delay)
      continue
    }

    const published = await response.json()
    assert.equal(published.name, pkg.name, 'Published package name mismatch')
    assert.equal(published.version, pkg.version, 'Published package version mismatch')
    assert.ok(typeof published.dist?.integrity === 'string' && published.dist.integrity.trim(), 'Published dist.integrity is missing or empty')
    assert.equal(published.dsh?.bundle?.patch, pkg.dsh.bundle.patch, 'Published dsh.bundle.patch mismatch')
    assert.equal(published.engines?.dsh, pkg.engines.dsh, 'Published engines.dsh mismatch')
    if (expectedGitHead && published.gitHead !== undefined) {
      assert.equal(published.gitHead, expectedGitHead, 'Published gitHead mismatch')
    }
    log(`Published package verified: ${identity} (integrity: ${published.dist.integrity})`)
    return published
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  verifyPublished(pkg, { expectedGitHead: process.env.GITHUB_SHA }).catch(error => {
    console.error(`Published package verification failed: ${error.message}`)
    process.exitCode = 1
  })
}

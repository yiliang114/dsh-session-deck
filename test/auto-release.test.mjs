import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertFreshMain, assertPublishedIdentity, checkPendingReservation, childEnvironment, createRunner, latestStable,
  nextVersion, onlyMarketCommits, pushMarket, registryVersion, reserve,
} from '../scripts/auto-release.mjs'

test('version policy patches equality, preserves manual stable bumps, rejects downgrades and prereleases', () => {
  assert.equal(nextVersion('0.1.2', '0.1.2'), '0.1.3')
  assert.equal(nextVersion('0.2.0', '0.1.2'), '0.2.0')
  assert.equal(nextVersion('1.0.0', '0.9.9'), '1.0.0')
  assert.equal(nextVersion('0.1.0', null), '0.1.0')
  assert.throws(() => nextVersion('0.1.1', '0.1.2'), /downgrade/)
  for (const invalid of ['0.2.0-beta.1', '0.2.0+build', 'v0.2.0', '01.2.3']) {
    assert.throws(() => nextVersion(invalid, '0.1.2'), /stable/)
    assert.throws(() => nextVersion('0.2.0', invalid), /stable/)
  }
})

test('only HTTP 404 means absent; auth, rate limit, server and transport errors fail', async () => {
  assert.equal(await registryVersion('pkg', 'latest', async () => new Response('', { status: 404 })), null)
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registryVersion('pkg', 'latest', async () => new Response('', { status })), /only 404/)
  }
  await assert.rejects(registryVersion('pkg', 'latest', async () => { throw new Error('offline') }), /offline/)
  const metadata = { name: 'pkg', version: '0.1.2' }
  assert.deepEqual(await registryVersion('pkg', 'latest', async () => Response.json(metadata)), metadata)
})

test('latest must be the highest stable published version', async () => {
  const fetcher = versions => async url => Response.json(url.endsWith('/latest')
    ? { name: 'pkg', version: '0.1.2' }
    : { versions: Object.fromEntries(versions.map(v => [v, {}])) })
  assert.equal((await latestStable('pkg', fetcher(['0.1.1', '0.1.2', '0.2.0-beta.1']))).version, '0.1.2')
  await assert.rejects(latestStable('pkg', fetcher(['0.1.2', '0.2.0'])), /behind published stable/)
})

test('already published release is reusable only with exact local integrity and matching gitHead if present', () => {
  const pkg = { name: 'pkg', version: '0.1.3' }
  const published = { ...pkg, gitHead: 'abc', dist: { integrity: 'sha512-exact' } }
  assert.doesNotThrow(() => assertPublishedIdentity(published, pkg, 'abc', 'sha512-exact'))
  assert.throws(() => assertPublishedIdentity(published, pkg, 'abc', 'sha512-changed'), /tarball differs/)
  assert.throws(() => assertPublishedIdentity(published, pkg, 'def', 'sha512-exact'), /gitHead differs/)
  assert.doesNotThrow(() => assertPublishedIdentity({ ...published, gitHead: undefined }, pkg, 'abc', 'sha512-exact'))
})

test('package scripts receive no release credentials', () => {
  assert.deepEqual(childEnvironment({ PATH: '/bin', NPM_PUBLISH_TOKEN: 'x', NODE_AUTH_TOKEN: 'x', NPM_TOKEN: 'x', GH_TOKEN: 'x', GITHUB_TOKEN: 'x' }), { PATH: '/bin', NODE_AUTH_TOKEN: '' })
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'auto-release-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runner = cwd => {
    const run = createRunner({ cwd })
    return (command, args, options) => run(command, args, { quiet: true, ...options })
  }
  const base = runner(root)
  base('git', ['init', '--bare', 'remote.git'])
  base('git', ['clone', join(root, 'remote.git'), 'release'])
  const checkout = join(root, 'release')
  const run = runner(checkout)
  run('git', ['config', 'user.name', 'github-actions[bot]'])
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  run('git', ['checkout', '-b', 'main'])
  writeFileSync(join(checkout, 'package.json'), '{"name":"pkg","version":"0.1.2"}\n')
  writeFileSync(join(checkout, 'market-index.json'), 'initial\n')
  run('git', ['add', '.'])
  run('git', ['commit', '-m', 'initial'])
  run('git', ['push', '-u', 'origin', 'main'])
  base('git', ['clone', '--branch', 'main', join(root, 'remote.git'), 'human'])
  const humanPath = join(root, 'human')
  const human = runner(humanPath)
  human('git', ['config', 'user.name', 'Human'])
  human('git', ['config', 'user.email', 'human@example.com'])
  const commit = (who, cwd, file, text, subject) => {
    writeFileSync(join(cwd, file), text)
    who('git', ['add', file])
    who('git', ['commit', '-m', subject])
  }
  return { run, human, checkout, humanPath, commit, sha: run('git', ['rev-parse', 'HEAD']).stdout }
}

test('reservation atomically pushes main and tag, including an unchanged manual version', t => {
  const { run, sha } = fixture(t)
  const reserved = reserve(run, '0.1.2', sha)
  assert.notEqual(reserved, sha)
  assert.equal(run('git', ['ls-remote', 'origin', 'refs/heads/main']).stdout.split('\t')[0], reserved)
  assert.equal(run('git', ['ls-remote', 'origin', 'refs/tags/v0.1.2']).stdout.split('\t')[0], reserved)
})

test('stale main fails before reservation', t => {
  const { run, human, humanPath, commit, sha } = fixture(t)
  commit(human, humanPath, 'human.txt', 'new\n', 'human change')
  human('git', ['push', 'origin', 'main'])
  assert.throws(() => assertFreshMain(run, sha), /main moved/)
})

test('human movement between fetch and atomic push leaves no remote orphan tag', t => {
  const { run, human, humanPath, commit, sha } = fixture(t)
  const raced = (command, args, options) => {
    if (command === 'git' && args[0] === 'push' && args.includes('--atomic')) {
      commit(human, humanPath, 'human.txt', 'new\n', 'human change')
      human('git', ['push', 'origin', 'main'])
    }
    return run(command, args, options)
  }
  assert.throws(() => reserve(raced, '0.1.3', sha), /failed/)
  assert.equal(run('git', ['ls-remote', 'origin', 'refs/tags/v0.1.3']).stdout, '')
  assert.equal(run('git', ['ls-remote', 'origin', 'refs/heads/main']).stdout.split('\t')[0], human('git', ['rev-parse', 'HEAD']).stdout)
})

test('market push rebases onto human work, and bot completion does not conceal it', t => {
  const { run, human, checkout, humanPath, commit, sha } = fixture(t)
  commit(run, checkout, 'market-index.json', 'release\n', 'chore(release): market v0.1.3')
  assert.equal(onlyMarketCommits(run, sha), true)
  commit(human, humanPath, 'human.txt', 'new\n', 'human change')
  human('git', ['push', 'origin', 'main'])
  pushMarket(run)
  assert.equal(readFileSync(join(checkout, 'human.txt'), 'utf8'), 'new\n')
  assert.equal(onlyMarketCommits(run, sha), false)
})

test('pending reservation survives a newer manual minor bump and requires exact explicit recovery', t => {
  const { run, human, humanPath, commit, sha } = fixture(t)
  reserve(run, '0.1.2', sha)
  human('git', ['pull', '--ff-only', 'origin', 'main'])
  commit(human, humanPath, 'package.json', '{"name":"pkg","version":"0.2.0"}\n', 'manual minor bump')
  human('git', ['push', 'origin', 'main'])
  run('git', ['pull', '--ff-only', 'origin', 'main'])
  const current = run('git', ['rev-parse', 'HEAD']).stdout
  const github = completed => (command, args, options) => command === 'gh'
    ? { ok: completed, stdout: '', stderr: '' } : run(command, args, options)
  assert.throws(() => checkPendingReservation(github(false), current), /resume_tag=v0.1.2/)
  assert.equal(checkPendingReservation(github(false), current, 'v0.1.2'), 'v0.1.2')
  assert.throws(() => checkPendingReservation(github(false), current, 'v0.1.1'), /most recent reservation/)
  assert.equal(checkPendingReservation(github(true), current), 'v0.1.2')
})

test('market rebase conflicts abort cleanly without force or remote mutation', t => {
  const { run, human, checkout, humanPath, commit } = fixture(t)
  commit(run, checkout, 'market-index.json', 'release\n', 'chore(release): market v0.1.3')
  commit(human, humanPath, 'market-index.json', 'human\n', 'human edit')
  human('git', ['push', 'origin', 'main'])
  const humanSha = human('git', ['rev-parse', 'HEAD']).stdout
  assert.throws(() => pushMarket(run), /conflicts/)
  assert.equal(run('git', ['status', '--porcelain']).stdout, '')
  assert.equal(run('git', ['ls-remote', 'origin', 'refs/heads/main']).stdout.split('\t')[0], humanSha)
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyPublished } from './verify-published.mjs'

const registry = 'https://registry.npmjs.org'
const reservationPrefix = 'chore(release): reserve '
const marketPrefix = 'chore(release): market '

export function stableVersion(value) {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, `Expected stable x.y.z version, got ${value}`)
  const parts = value.split('.').map(Number)
  assert.ok(parts.every(Number.isSafeInteger), 'Version components exceed safe integer range')
  return parts
}

export function nextVersion(current, latest) {
  const parts = stableVersion(current)
  if (latest === null) return current
  const published = stableVersion(latest)
  const difference = parts.map((part, i) => part - published[i]).find(value => value !== 0) ?? 0
  assert.ok(difference >= 0, `Refusing version downgrade: package ${current}, npm latest ${latest}`)
  if (difference > 0) return current // A user's minor/major bump wins.
  assert.ok(Number.isSafeInteger(parts[2] + 1), 'Patch version exceeds safe integer range')
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

export async function registryVersion(name, version, fetcher = fetch) {
  const response = await fetcher(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  assert.equal(response.status, 200, `Registry HTTP ${response.status} for ${name}@${version}; only 404 means absent`)
  const result = await response.json()
  assert.equal(result.name, name, 'Registry package name mismatch')
  stableVersion(result.version)
  return result
}

export async function latestStable(name, fetcher = fetch) {
  const latest = await registryVersion(name, 'latest', fetcher)
  const response = await fetcher(`${registry}/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404 && latest === null) {
    await response.body?.cancel()
    return null
  }
  assert.equal(response.status, 200, `Registry HTTP ${response.status} reading version history`)
  assert.ok(latest, 'Package exists but npm latest is missing; fix dist-tags before releasing')
  const metadata = await response.json()
  const stable = Object.keys(metadata.versions ?? {}).filter(version => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  assert.ok(stable.includes(latest.version), 'Registry history is missing latest version')
  const floor = stableVersion(latest.version)
  for (const version of stable) {
    const difference = stableVersion(version).map((part, i) => part - floor[i]).find(value => value !== 0) ?? 0
    assert.ok(difference <= 0, `npm latest ${latest.version} is behind published stable ${version}; fix dist-tags before releasing`)
  }
  return latest
}

export function assertPublishedIdentity(published, pkg, sha, integrity) {
  assert.equal(published.name, pkg.name, 'Published package name mismatch')
  assert.equal(published.version, pkg.version, 'Published package version mismatch')
  assert.equal(published.dist?.integrity, integrity, 'Published tarball differs from reserved release; refusing to reuse version')
  if (published.gitHead !== undefined) assert.equal(published.gitHead, sha, 'Published gitHead differs from reserved release')
}

// Credentials are opt-in for each child; npm scripts/tests never inherit them.
export function childEnvironment(source = process.env) {
  const env = { ...source }
  for (const key of ['NPM_PUBLISH_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[key]
  env.NODE_AUTH_TOKEN = '' // setup-node's .npmrc references this variable even for public reads.
  return env
}

export function createRunner({ cwd = process.cwd(), env = process.env } = {}) {
  return (command, args, { allowFailure = false, credentials = {}, quiet = false } = {}) => {
    const result = spawnSync(command, args, {
      cwd, env: { ...childEnvironment(env), ...credentials }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    })
    if (result.error) throw result.error
    if (!quiet && result.stdout) process.stdout.write(result.stdout)
    if (result.status !== 0 && !allowFailure) {
      throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr}`)
    }
    return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr }
  }
}

export function assertFreshMain(run, expected) {
  run('git', ['fetch', 'origin', 'main'])
  assert.equal(run('git', ['rev-parse', 'origin/main'], { quiet: true }).stdout, expected,
    'main moved before publication; rerun on main (or resume the reserved tag if one was pushed)')
}

export function canReleaseTrigger(run, triggerSha, mainSha) {
  assert.match(triggerSha ?? '', /^[a-f0-9]{40,64}$/, 'Missing workflow source SHA')
  if (triggerSha === mainSha) return true
  if (!run('git', ['merge-base', '--is-ancestor', triggerSha, mainSha], { allowFailure: true, quiet: true }).ok) return false
  // Market-index commits do not change the npm package. Other newer source must
  // be released by its own queued workflow, whose OIDC identity matches it.
  return onlyMarketCommits(run, triggerSha)
}

export function assertResumeIdentity(sha, triggerSha, tag) {
  assert.equal(sha, triggerSha,
    `To publish reserved ${tag}, dispatch this workflow using ref ${tag} (gh workflow run publish.yml --ref ${tag}). The workflow OIDC source SHA must match the reserved source; then dispatch main to ship newer changes.`)
}

export function assertReservationOnMain(run, sha) {
  run('git', ['fetch', 'origin', 'main'])
  // A newer descendant is safe: publish the immutable reservation, then let the
  // queued main run release newer source. Rewritten history requires inspection.
  assert.ok(run('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { allowFailure: true, quiet: true }).ok,
    'Reserved release is no longer on main; inspect rewritten history before publishing')
}

export function reserve(run, version, expected) {
  assertFreshMain(run, expected)
  const tag = `v${version}`
  run('git', ['add', 'package.json'])
  run('git', ['commit', '--allow-empty', '-m', `${reservationPrefix}${tag}`])
  run('git', ['tag', tag])
  // Atomic push makes a rejected main update also reject the tag. Never force.
  run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`])
  return run('git', ['rev-parse', 'HEAD'], { quiet: true }).stdout
}

function packageJson() { return JSON.parse(readFileSync('package.json', 'utf8')) }
function head(run) { return run('git', ['rev-parse', 'HEAD'], { quiet: true }).stdout }
function tagSha(run, tag) {
  const result = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { quiet: true, allowFailure: true })
  return result.ok ? result.stdout : null
}
function isReservation(run, tag) {
  return run('git', ['show', '-s', '--format=%s', tag], { quiet: true }).stdout === `${reservationPrefix}${tag}`
}

export function onlyMarketCommits(run, sha) {
  // Check every intervening commit, not just HEAD: humans may have arrived during finalization.
  const commits = run('git', ['rev-list', `${sha}..HEAD`], { quiet: true }).stdout.split('\n').filter(Boolean)
  return commits.every(commit => {
    const subject = run('git', ['show', '-s', '--format=%s', commit], { quiet: true }).stdout
    const email = run('git', ['show', '-s', '--format=%ae', commit], { quiet: true }).stdout
    const paths = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], { quiet: true }).stdout
    return subject.startsWith(marketPrefix) && email === '41898282+github-actions[bot]@users.noreply.github.com' && paths === 'market-index.json'
  })
}

function releaseExists(run, tag, token) {
  return run('gh', ['release', 'view', tag, '--json', 'tagName'], {
    credentials: { GH_TOKEN: token }, allowFailure: true, quiet: true,
  }).ok
}

export function checkPendingReservation(run, mainSha, resumeTag, ghToken) {
  const subject = run('git', ['log', '-1', '--format=%s', '--grep=^chore(release): reserve v', 'HEAD'], { quiet: true }).stdout
  const tag = subject.startsWith(reservationPrefix) ? subject.slice(reservationPrefix.length) : null
  if (tag) {
    assert.match(tag, /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/)
    const sha = tagSha(run, tag)
    assert.ok(sha && isReservation(run, tag), `Reservation ${tag} has no matching tag; inspect repository history`)
    run('git', ['merge-base', '--is-ancestor', sha, mainSha])
    if (!resumeTag && sha !== mainSha && !onlyMarketCommits(run, sha) && !releaseExists(run, tag, ghToken)) {
      throw new Error(`Unfinished reservation ${tag} precedes newer main changes. Dispatch this workflow on ref ${tag} (gh workflow run publish.yml --ref ${tag}), then dispatch main to ship newer changes. A failed GitHub lookup also requires this safe recovery path.`)
    }
  }
  if (resumeTag) assert.equal(resumeTag, tag, 'Only the most recent reservation may be resumed; inspect older releases manually')
  return tag
}

async function prepare(run, ghToken) {
  const npmVersion = stableVersion(run('npm', ['--version'], { quiet: true }).stdout)
  assert.ok(npmVersion[0] > 11 || (npmVersion[0] === 11 && (npmVersion[1] > 5 || (npmVersion[1] === 5 && npmVersion[2] >= 1))), 'Trusted publishing requires npm >=11.5.1')
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    assert.ok(!existsSync(lock), `Automatic reservation currently supports the unlocked package; add lockfile version synchronization before using ${lock}`)
  }
  run('git', ['fetch', 'origin', 'main', '--tags'])
  run('git', ['checkout', '-B', 'main', 'origin/main'])
  assert.equal(run('git', ['status', '--porcelain'], { quiet: true }).stdout, '', 'Release checkout must be clean')
  const mainSha = head(run)
  assert.ok(process.env.GITHUB_ENV, 'GITHUB_ENV is required for workflow stage handoff')
  if (!process.env.RESUME_TAG && !canReleaseTrigger(run, process.env.GITHUB_SHA, mainSha)) {
    console.log('Skipping stale workflow source: newer main source must be released by its own workflow or a fresh main dispatch.')
    appendFileSync(process.env.GITHUB_ENV, 'RELEASE_SKIPPED=true\n')
    return
  }
  checkPendingReservation(run, mainSha, process.env.RESUME_TAG, ghToken)
  let pkg = packageJson()
  stableVersion(pkg.version)
  assert.ok(!pkg.private && pkg.license, 'Package must be public and licensed')
  let tag = process.env.RESUME_TAG || `v${pkg.version}`
  if (process.env.RESUME_TAG) {
    assert.match(tag, /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/)
  }
  let sha = tagSha(run, tag)
  let reuse = false
  if (sha && isReservation(run, tag)) {
    run('git', ['merge-base', '--is-ancestor', sha, mainSha])
    reuse = Boolean(process.env.RESUME_TAG) || sha === mainSha || onlyMarketCommits(run, sha)
    if (!reuse && !releaseExists(run, tag, ghToken)) {
      throw new Error(`Unfinished reservation ${tag} precedes newer main changes. Dispatch this workflow on ref ${tag} (gh workflow run publish.yml --ref ${tag}), then dispatch main to ship newer changes. A failed GitHub lookup also requires this safe recovery path.`)
    }
  } else if (process.env.RESUME_TAG) {
    throw new Error(`${tag} is not an automatic release reservation; refusing resume`)
  }
  if (reuse) {
    if (process.env.RESUME_TAG) assertResumeIdentity(sha, process.env.GITHUB_SHA, tag)
    run('git', ['checkout', '--detach', sha])
    pkg = packageJson()
    assert.equal(tag, `v${pkg.version}`)
  }
  // No token is available to these package scripts. Verification precedes reservation.
  run('npm', ['run', 'verify'])
  if (!reuse) {
    const latest = await latestStable(pkg.name)
    const version = nextVersion(pkg.version, latest?.version ?? null)
    tag = `v${version}`
    assert.equal(tagSha(run, tag), null, `Tag ${tag} already exists; inspect or resume its reservation`)
    const existing = await registryVersion(pkg.name, version)
    assert.equal(existing, null, `${version} already exists in npm outside this reservation; refusing to overwrite`)
    // Preserve formatting of the user's manifest apart from the version field.
    const text = readFileSync('package.json', 'utf8')
    writeFileSync('package.json', text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))
    sha = reserve(run, version, mainSha)
    pkg = packageJson()
  }
  appendFileSync(process.env.GITHUB_ENV, `RELEASE_SHA=${sha}\nRELEASE_TAG=${tag}\nRELEASE_REUSED=${reuse}\n`)
  console.log(`Reserved ${pkg.name}@${pkg.version} at ${sha}`)
}

function releaseContext(run) {
  const pkg = packageJson()
  const { RELEASE_SHA: sha, RELEASE_TAG: tag } = process.env
  assert.match(sha ?? '', /^[a-f0-9]{40,64}$/)
  assert.equal(head(run), sha, 'Checkout must remain at the exact reservation')
  assert.equal(tag, `v${pkg.version}`)
  assert.equal(tagSha(run, tag), sha)
  assert.ok(isReservation(run, tag), 'Release tag is not a reservation')
  return { pkg, sha, tag }
}

function packIntegrity(run) {
  const result = run('npm', ['pack', '--ignore-scripts', '--json'], { quiet: true })
  const [packed] = JSON.parse(result.stdout)
  assert.ok(packed.integrity, 'npm pack did not return integrity')
  return packed.integrity
}

async function publish(run, npmToken) {
  const { pkg, sha } = releaseContext(run)
  const integrity = packIntegrity(run)
  const existing = await registryVersion(pkg.name, pkg.version)
  if (existing) {
    assertPublishedIdentity(existing, pkg, sha, integrity)
    console.log(`Exact reserved release ${pkg.version} already exists; skipping npm publish`)
  } else {
    assertReservationOnMain(run, sha)
    if (process.env.RELEASE_REUSED === 'true') assertResumeIdentity(sha, process.env.GITHUB_SHA, `v${pkg.version}`)
    // Keep GITHUB_SHA unchanged: npm checks it against the OIDC certificate.
    // A fresh reservation's version bump is a build transformation of that source.
    const credentials = npmToken ? { NODE_AUTH_TOKEN: npmToken } : {}
    // npm lifecycle scripts are disabled; only this child receives npm credentials.
    run('npm', ['publish', '--access', 'public', '--provenance', '--ignore-scripts'], { credentials })
  }
  const published = await verifyPublished(pkg, { expectedGitHead: sha })
  assertPublishedIdentity(published, pkg, sha, integrity)
}

export function pushMarket(run, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    run('git', ['fetch', 'origin', 'main'])
    const rebased = run('git', ['rebase', 'origin/main'], { allowFailure: true })
    if (!rebased.ok) {
      run('git', ['rebase', '--abort'], { allowFailure: true })
      throw new Error('Market update conflicts with newer main changes; resolve manually and retry the reserved tag. Nothing was force-pushed.')
    }
    if (run('git', ['push', 'origin', 'HEAD:refs/heads/main'], { allowFailure: true }).ok) return
  }
  throw new Error('main kept moving or push was denied; retry the reserved tag to finish the market update')
}

async function finalize(run, ghToken) {
  const { pkg, sha, tag } = releaseContext(run)
  // This stage independently verifies before allowing any discoverability writes.
  const published = await verifyPublished(pkg, { expectedGitHead: sha })
  assertPublishedIdentity(published, pkg, sha, packIntegrity(run))
  run('node', [fileURLToPath(new URL('./update-market-index.mjs', import.meta.url))])
  run('git', ['add', 'market-index.json'])
  const changed = !run('git', ['diff', '--cached', '--quiet'], { allowFailure: true }).ok
  if (changed) {
    run('git', ['commit', '-m', `${marketPrefix}${tag}`])
    pushMarket(run)
  }
  if (!releaseExists(run, tag, ghToken)) {
    const previous = run('git', ['describe', '--tags', '--abbrev=0', `${sha}^`], { quiet: true, allowFailure: true })
    const repository = process.env.GITHUB_REPOSITORY
    assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/)
    const reference = previous.ok
      ? `https://github.com/${repository}/compare/${previous.stdout}...${tag}`
      : `https://github.com/${repository}/releases/tag/${tag}`
    const notes = `Published ${pkg.name}@${pkg.version} to npm.\n\nChanges: ${reference}\n`
    const notesPath = resolve(process.env.RUNNER_TEMP || '.git', 'auto-release-notes.md')
    writeFileSync(notesPath, notes)
    run('gh', ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesPath], {
      credentials: { GH_TOKEN: ghToken },
    })
  }
  console.log(`Completed ${tag}. If resumed from a tag, dispatch main to ship any newer changes.`)
}

export async function main() {
  const npmToken = process.env.NPM_PUBLISH_TOKEN
  const ghToken = process.env.GH_TOKEN
  delete process.env.NPM_PUBLISH_TOKEN
  delete process.env.GH_TOKEN
  const run = createRunner()
  const stage = process.argv[2]
  if (stage === 'prepare') await prepare(run, ghToken)
  else if (stage === 'publish') await publish(run, npmToken)
  else if (stage === 'finalize') await finalize(run, ghToken)
  else throw new Error('Usage: node scripts/auto-release.mjs prepare|publish|finalize')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}

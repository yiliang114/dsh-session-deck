# Releasing DSH Session Deck

[User guide](../README.md) · [中文使用指南](../README.zh-CN.md)

This guide describes automatic releases for **`@yiliang114/dsh-session-deck`**. The supported DSH version remains exactly **0.2.1-rc.2**. A release is complete only after its registry version is verified, the custom market index is updated, and its GitHub Release is created.

Track the actual result using [Release CI](https://github.com/yiliang114/dsh-session-deck/actions/workflows/publish.yml), the [npm package](https://www.npmjs.com/package/@yiliang114/dsh-session-deck), and the [latest GitHub Release](https://github.com/yiliang114/dsh-session-deck/releases/latest).

## Automatic releases from main

Push reviewed changes to `main` normally. The [publish workflow](../.github/workflows/publish.yml) serializes releases and checks the current branch when the job starts. If newer human commits have arrived, an outdated queued run skips; the latest eligible run releases the accumulated changes. Bot market-index commits alone do not make a run stale.

GitHub signs the workflow's original event SHA. npm provenance keeps that SHA as the build input; the automated version commit records the generated version separately. Never override `GITHUB_SHA` to claim a different input: npm rejects a provenance digest that disagrees with GitHub's certificate.

The release sequence is:

1. Check the latest `main` and run `npm run verify` before reserving a release.
2. Select the next stable version. Normally increment the patch number: `0.1.2` becomes `0.1.3`. Preserve an explicitly selected stable version greater than the previous release, such as `0.2.0`; the following ordinary release becomes `0.2.1`.
3. Reserve that version with the release commit and matching `vX.Y.Z` tag, so a retry retains the original release source.
4. Publish the public npm package with provenance and verify its exact version in the public registry.
5. Update the custom market index using verified registry metadata and create the GitHub Release.

The workflow uses `GITHUB_TOKEN` for its repository writes. Those bot commits do not trigger another push workflow, preventing a release loop. A manual dispatch with only completed market-index bot commits remaining reuses the same version and skips npm publication after verifying the existing artifact, rather than incrementing again. Repository settings and branch protection must allow the workflow's required writes.

### Manually choose a minor version

On an up-to-date `main` checkout, make the desired changes and run:

```sh
npm version minor --no-git-tag-version
npm run verify
git add package.json
# Stage any other intended changes as usual.
git commit -m "chore: prepare minor release"
git push origin main
```

For example, this changes `0.1.3` to `0.2.0`. The automatic workflow preserves that explicit greater stable version, and the next normal push releases `0.2.1`. The repository currently has no lockfile. If one is introduced, add lockfile version synchronization to the release script first; automatic reservation otherwise stops with an explicit error. The workflow creates the release tag; maintainers do not manually tag ordinary releases.

## Verify a release candidate

Before pushing reviewed changes:

```sh
npm run verify
npm pack --ignore-scripts
```

`verify` runs JavaScript syntax checks, Node.js tests, and a dry-run package-content check. The repository has no npm dependencies and does not need `npm install`. The tarball includes the host entry, client bundle, Cordis configuration, English and Chinese READMEs, license, and legacy sidebar patch script retained for rollback and backward compatibility. Repository screenshots and this release guide are not included in the current package allowlist.

Before shipping UI changes, verify the following in the real DSH **0.2.1-rc.2** GUI:

- Test both linked and tarball installations without a host patch. Confirm that the switcher appears immediately above the workspace region, below global panels, and that installed DSH files remain unchanged.
- Exercise all three views, native pins, waiting/running/unread behavior, and nested known subagents. Confirm that Workspaces preserves the native workspace browser and its controls.
- Collapse and expand the sidebar, checking that the switcher remains usable and correctly positioned.
- Disable the plugin and confirm that its scoped observer and DOM host are removed and the native workspace browser is restored. Re-enable it and check that only one switcher appears.
- Exercise an unknown DOM layout and confirm that the adapter safely falls back to the footer.
- Check compatibility with an existing legacy `sidebar.workspaces.before` slot. If testing rollback, use the original backups and do not overwrite unrelated changes; after rollback and refresh, confirm that the new plugin stays above the workspace region on unpatched rc.2.

Automatic placement is a guarded DOM compatibility adapter using a React portal, not an official DSH API. Keep `engines.dsh` pinned to **0.2.1-rc.2**; rc.3 compatibility is unverified and unsupported. Automated checks alone do not establish host compatibility, and this checklist does not record completed verification.

When screenshots need updating, capture the actual English interface on unpatched rc.2, showing automatic top placement. Use English, anonymized session titles and workspace names, omit browser chrome, and keep the existing filenames: [Activity](images/activity.png), [Favorites](images/favorites.png), and [Workspaces](images/workspaces.png).

## Configure npm authentication

The workflow authenticates exclusively through **npm Trusted Publishing (OIDC)**. GitHub Actions supplies a signed, short-lived identity token; the npm CLI exchanges it for a short-lived publishing credential. The workflow does not read `NPM_TOKEN` or fall back to a long-lived npm token.

Configuring this trust relationship is a **one-time account setup**. npm may ask the account owner to verify a security key when saving the configuration. That is separate from ordinary releases: after setup, each push publishes unattended, without an npm approval click.

Open the npm package's **Settings → Trusted Publisher** configuration and authorize GitHub Actions with:

| Field | Value |
| --- | --- |
| Organization or user | `yiliang114` |
| Repository | `dsh-session-deck` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty; the workflow does not declare an environment. |

Use the workflow filename, not its repository path. Set **Allow npm publish** to **true** so the workflow publishes directly; **Allow npm dist-tag** is not needed. A stage-only publisher requires human approval for each staged release and does not meet this repository's unattended-release policy. Do not add a GitHub environment with required reviewers to this workflow. Follow the current [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for account verification and eligibility requirements.

The publishing job uses a GitHub-hosted runner, Node.js **24**, npm **11.5.1 or newer**, and `id-token: write`. Keep npm's OIDC request environment available to the publishing process. Never store, print, or manually generate its short-lived tokens. The workflow's configuration alone does not establish the npm-side trust relationship.

When migrating from the previous bootstrap token:

1. Save the trusted publisher configuration on npm, including any one-time security-key verification.
2. Run an actual new release with this OIDC-only workflow. A successful `npm whoami`, a provenance badge, or a retry that skips an already published version does not prove OIDC publishing works. Newly created trusted publishers must complete their first successful publish within **two days**, according to npm's current policy.
3. After that release succeeds, delete the repository Actions secret `NPM_TOKEN` and revoke only the dedicated `dsh-session-deck-ci-bootstrap` npm token. Do not revoke unrelated account tokens.

The former bootstrap token expires on **2026-10-30**. This workflow never uses it, even if the old secret has not yet been removed. If trust is missing or mismatched, repair the npm publisher configuration rather than restoring a token fallback.

Publication uses `--provenance` and a public package. [npm provenance](https://docs.npmjs.com/generating-provenance-statements/) also requires a public GitHub repository matching the package's `repository.url`; keep it set to `git+https://github.com/yiliang114/dsh-session-deck.git`.

Ensure GitHub Actions and `actions/checkout` / `actions/setup-node` are allowed in repository settings. The [CI workflow](../.github/workflows/ci.yml) verifies Node.js 22 and 24; its `Verify (Node 22)` and `Verify (Node 24)` checks can be required by branch protection after their first run.

## Verify and recover a release

Inspect Release CI and the exact registry version. Replace `VERSION` with the reserved release version:

```sh
npm view @yiliang114/dsh-session-deck@VERSION name version dist.integrity --registry=https://registry.npmjs.org
```

npm can accept an upload while still processing the release. If registry verification fails, inspect the package and any staged-release status before retrying. Do not blindly republish: npm versions cannot be overwritten. Never delete or move a published release tag to point at different source.

Use **Run workflow** for the publish workflow:

- If the failed release's reserved commit is still the branch head, dispatch on **main** to resume it.
- If newer human commits have reached `main`, select the reserved **tag** as the workflow ref so GitHub signs that original source. For example: `gh workflow run publish.yml --ref v0.2.0`.
- After recovery succeeds, dispatch again on **main** to release the newer changes.

Tag recovery is supported by reservations containing this corrected workflow. A tag retains its own workflow definition; older tags cannot gain recovery support from changes on `main`.

Check which steps already completed before retrying, including registry publication, market update, and GitHub Release creation. A failed post-publication step calls for finishing that release, not inventing a replacement artifact with the same version. Inspect the workflow's actual result before treating recovery as complete.

## Custom market index

The [market index](../market-index.json) lists registry-verified releases. The automatic workflow is responsible for updating it after registry verification; publication to npm alone does not update the index or submit the plugin to an official DSH market.

The underlying `npm run market:update` command queries npm for the exact scoped package and version, checks package metadata, and records the real publication timestamp while preserving earlier versions. It fails if the release cannot be verified. If manual repair is needed, use the source checkout for the published version, review the generated index, and coordinate with any active release run before committing the repair.

Users can enable DSH's custom plugin market, open **Discover → Add index source**, and add the direct JSON URL:

```text
https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/market-index.json
```

Use the raw JSON URL, not the GitHub file-preview URL. DSH's market reads user-added indexes; there is no official automatic collection triggered by npm publication. Inclusion in a separately maintained community index is a separate process. See the [DSH custom market documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/plugin-market-bundle/README.md).

Keep README installation commands on `@latest`, npm links on the unversioned package URL, and GitHub Release links on `/releases/latest`, so future published READMEs do not retain a stale current-version label. Keep historical validation records explicitly labeled with the version they verified.

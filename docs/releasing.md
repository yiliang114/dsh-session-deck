# Releasing DSH Session Deck

[User guide](../README.md) · [中文使用指南](../README.zh-CN.md)

This guide is for maintainers of **`@yiliang114/dsh-session-deck`**. The current source version is **0.1.2** and the supported DSH version is exactly **0.2.1-rc.2**. A release is complete only when its tagged workflow succeeds and the exact npm version can be downloaded and installed.

The [publish workflow](../.github/workflows/publish.yml) supports an initial tagged publication using a repository `NPM_TOKEN` secret, then tokenless npm trusted publishing after the package exists. Authentication must be configured before publishing; committing the workflow does not authorize it.

Version **0.1.2** is published through the [successful release workflow](https://github.com/yiliang114/dsh-session-deck/actions/runs/39979809316), with its registry tarball integrity and isolated installation verified. The bootstrap procedure below applies when creating a new package; do not recreate or republish existing version tags.

## Verify a release candidate

On the reviewed release commit:

```sh
npm run verify
npm pack --ignore-scripts
```

`verify` runs JavaScript syntax checks, Node.js tests, and a dry-run package-content check. The repository has no npm dependencies and does not need `npm install`. The tarball includes the host entry, client bundle, Cordis configuration, English and Chinese READMEs, license, and legacy sidebar patch script retained for rollback and backward compatibility. Repository screenshots and this release guide are not included in the current package allowlist.

Before shipping, verify the following in the real DSH **0.2.1-rc.2** GUI:

- Test both linked and tarball installations without a host patch. Confirm that the switcher appears immediately above the workspace region, below global panels, and that installed DSH files remain unchanged.
- Exercise all three views, native pins, waiting/running/unread behavior, and nested known subagents. Confirm that Workspaces preserves the native workspace browser and its controls.
- Collapse and expand the sidebar, checking that the switcher remains usable and correctly positioned.
- Disable the plugin and confirm that its scoped observer and DOM host are removed and the native workspace browser is restored. Re-enable it and check that only one switcher appears.
- Exercise an unknown DOM layout and confirm that the adapter safely falls back to the footer.
- Check compatibility with an existing legacy `sidebar.workspaces.before` slot. If testing rollback, use the original backups and do not overwrite unrelated changes; after rollback and refresh, confirm that the new plugin stays above the workspace region on unpatched rc.2.

Automatic placement is a guarded DOM compatibility adapter using a React portal, not an official DSH API. Keep `engines.dsh` pinned to **0.2.1-rc.2**; rc.3 compatibility is unverified and unsupported. Automated checks alone do not establish host compatibility, and this checklist does not record completed verification.

Recapture the README screenshots from the actual English interface on unpatched rc.2, showing automatic top placement. Use English, anonymized session titles and workspace names, omit browser chrome, and keep the existing filenames: [Activity](images/activity.png), [Favorites](images/favorites.png), and [Workspaces](images/workspaces.png).

## Bootstrap the npm package

The first publication requires an npm account authorized to create packages under `@yiliang114`. In npm's website, create a short-lived [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens/) with **Read and write** package permissions covering the `@yiliang114` scope (including the new package) and **Bypass two-factor authentication** enabled for unattended CI publication. Store it as the GitHub repository Actions secret **`NPM_TOKEN`**. Browser login alone does not authenticate GitHub Actions or the local npm CLI.

Verify the reviewed candidate, merge it to `main`, then create and push **`v0.1.2`**. The workflow requires the tag to exactly match the package version, runs `npm run verify`, publishes, and queries the registry. Inspect the successful run and confirm:

```sh
npm view @yiliang114/dsh-session-deck@0.1.2 name version dist.integrity --registry=https://registry.npmjs.org
```

The publication uses `--provenance`, job permission `id-token: write`, and a public package. [npm provenance](https://docs.npmjs.com/generating-provenance-statements/) also requires a public GitHub repository matching the package's `repository.url`; keep it set to `git+https://github.com/yiliang114/dsh-session-deck.git`.

Treat publication as complete only after registry verification succeeds. npm can accept an upload while processing the release, and its website may temporarily show a holding version. The [registry verifier](../scripts/verify-published.mjs) checks the exact public version without authentication and retries HTTP 404, 429, and 5xx responses up to 20 times, 15 seconds apart. Authentication errors and mismatched metadata fail immediately. If processing lasts beyond that window, inspect npm's package and staged-release status before retrying; do not publish the same version again just because verification failed. Do not add a market release entry before the actual version is verified. npm versions cannot be overwritten.

## Configure GitHub Actions trusted publishing

After the package exists, open its npm **Settings → Trusted Publisher** configuration and authorize GitHub Actions with:

| Field | Value |
| --- | --- |
| Organization or user | `yiliang114` |
| Repository | `dsh-session-deck` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty; the workflow does not declare an environment. |

Use the workflow filename, not its repository path. Enable **Allow npm publish** so this workflow can publish directly; **Allow npm dist-tag** is not needed. Follow the current [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for any additional verification and eligibility requirements. This is npm-side setup, not a setting inferred from the repository files.

The workflow uses Node.js **24**, checks for npm **11.5.1 or newer**, and grants the publishing job `id-token: write` for OIDC. Only the `npm publish` step receives `NODE_AUTH_TOKEN` from the optional `NPM_TOKEN` secret. After configuring the trusted publisher, remove that repository secret and revoke the bootstrap token: an absent secret supplies an empty value, allowing npm to use OIDC for subsequent publications. Verification runs before publishing, followed by a registry query.

Ensure GitHub Actions and `actions/checkout` / `actions/setup-node` are allowed in repository settings. The [CI workflow](../.github/workflows/ci.yml) verifies Node.js 22 and 24; its `Verify (Node 22)` and `Verify (Node 24)` checks can be required by branch protection after their first run.

## Publish subsequent versions

1. Update the package version, release-facing documentation, and compatibility declaration as appropriate. Validate changes and merge the reviewed release commit to `main`.
2. Confirm the npm trusted publisher binding is in place and test the target DSH GUI.
3. Create and push a tag that exactly matches the new package version. For example, **after publishing 0.1.2 and changing the next package version to 0.1.3**:

   ```sh
   git tag v0.1.3
   git push origin v0.1.3
   ```

4. Inspect the publish workflow and confirm the registry version and integrity. A `v*` tag triggers publishing, and a mismatched tag fails. Manual workflow retries must select the version tag; selecting a branch skips the publishing job. Check whether publication already succeeded before retrying a failed post-publication step.

The workflow does not bump versions, create tags, or push market-index changes back to the repository.

## Update the custom market index

The [market index](../market-index.json) lists the verified **0.1.2** release. It is maintained explicitly after publication; npm does not automatically update it or submit the plugin to an official DSH market.

After registry verification, run from the source checkout for the published version:

```sh
npm run market:update
```

The script queries npm for the exact scoped package and version, checks package metadata, and records the real publication timestamp while preserving earlier versions. It fails if the release cannot be verified. Review the generated index and submit its change to `main`.

Users can then enable DSH's custom plugin market, open **Discover → Add index source**, and add the direct JSON URL:

```text
https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/market-index.json
```

Use the raw JSON URL, not the GitHub file-preview URL. DSH's market reads user-added indexes; there is no official automatic collection triggered by npm publication. Inclusion in a separately maintained community index is a separate process. See the [DSH custom market documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/plugin-market-bundle/README.md).

After a confirmed publication and index update, revise both READMEs' availability statements and commands to describe the actual released version.

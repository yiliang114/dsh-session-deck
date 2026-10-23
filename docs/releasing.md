# Releasing DSH Session Deck

[User guide](../README.md) · [中文使用指南](../README.zh-CN.md)

This guide is for maintainers of **`@yiliang114/dsh-session-deck`**. The current source version is **0.1.0** and the supported DSH version is exactly **0.2.1-rc.2**. The npm package has not been published: the initial npm login attempt did not complete successfully. Local checkout and tarball installation remain available.

The [publish workflow](../.github/workflows/publish.yml) is present, but **npm trusted publishing must still be configured**. Committing a workflow does not create an npm package or authorize GitHub Actions to publish it.

## Verify a release candidate

On the reviewed release commit:

```sh
npm run verify
npm pack --ignore-scripts
```

`verify` runs JavaScript syntax checks, Node.js tests, and a dry-run package-content check. The repository has no npm dependencies and does not need `npm install`. The tarball includes the host entry, client bundle, Cordis configuration, English and Chinese READMEs, license, and optional sidebar patch script. Repository screenshots and this release guide are not included in the current package allowlist.

Test installation and the three views in the real DSH 0.2.1-rc.2 GUI. Check native pins, waiting/running/unread behavior, nested known subagents, and the unpatched bottom-position fallback. Automated checks alone do not establish host compatibility. Capture screenshots from the actual English interface and avoid exposing private session content.

## Bootstrap the npm package

The first publication requires an npm account authorized to publish under the `@yiliang114` scope. Complete npm login and any required verification using npm's official flow before proceeding:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm run verify
npm publish --access public --ignore-scripts
npm view @yiliang114/dsh-session-deck@0.1.0 name version dist.integrity --registry=https://registry.npmjs.org
```

Treat publication as complete only after registry verification succeeds. Do not advertise registry installation or add a market release entry while login or publication remains incomplete. npm versions cannot be overwritten; a version already published locally must not be published again by the workflow.

## Configure GitHub Actions trusted publishing

After the package exists, open its npm **Settings → Trusted Publisher** configuration and authorize GitHub Actions with:

| Field | Value |
| --- | --- |
| Organization or user | `yiliang114` |
| Repository | `dsh-session-deck` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty; the workflow does not declare an environment. |

Use the workflow filename, not its repository path. The binding must authorize direct `npm publish`. Follow the current [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for any additional verification and eligibility requirements. This is npm-side setup, not a setting inferred from the repository files.

The workflow uses Node.js **24**, checks for npm **11.5.1 or newer**, and grants the publishing job `id-token: write` for OIDC. It does not store an npm token. It runs verification before publishing and queries the registry afterward.

Ensure GitHub Actions and `actions/checkout` / `actions/setup-node` are allowed in repository settings. The [CI workflow](../.github/workflows/ci.yml) verifies Node.js 22 and 24; its `Verify (Node 22)` and `Verify (Node 24)` checks can be required by branch protection after their first run.

## Publish subsequent versions

1. Update the package version, release-facing documentation, and compatibility declaration as appropriate. Validate changes and merge the reviewed release commit to `main`.
2. Confirm the npm trusted publisher binding is in place and test the target DSH GUI.
3. Create and push a tag that exactly matches the package version. For example, **only after changing the package version to 0.1.1**:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. Inspect the publish workflow and confirm the registry version and integrity. A `v*` tag triggers publishing, and a mismatched tag fails. Manual workflow retries must select the version tag; selecting a branch skips the publishing job. Check whether publication already succeeded before retrying a failed post-publication step.

The workflow does not bump versions, create tags, or push market-index changes back to the repository.

## Update the custom market index

The [market index](../market-index.json) intentionally starts with `plugins: []`. This means **no released entries**, not a broken install or a pending automatic market submission.

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

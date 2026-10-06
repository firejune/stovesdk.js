# Releasing

The cut is one click: merge the release pull request. Everything either side of that
click is [`.github/workflows/release.yml`](.github/workflows/release.yml). A release
is a version, a `CHANGELOG.md` entry, a `vX.Y.Z` tag and a GitHub release — and then
two workflows dispatched by hand, in this order: `prebuild.yml`, which builds the Windows
prebuild and attaches it to that release ([Prebuilt binaries](#prebuilt-binaries)), and
`publish.yml`, which publishes the tarball that carries it ([Publishing](#publishing)).

## The loop

Every push to `main` runs `release.yml`, which hands the new commits to
[release-please](https://github.com/googleapis/release-please-action):

- **Nothing releasable since the last tag** → the run does nothing. The types
  `release-please-config.json` hides from the changelog (`docs`, `test`, `ci`,
  `build`, `chore`, `refactor`, `style`) do not open a release pull request on their
  own. Overriding `changelog-sections` replaces release-please's default list rather
  than extending it, so the whole list is written out — dropping a row hides that type.
- **Something releasable** (`feat`, `fix`, `perf`, `revert`) → it opens, or updates, a
  pull request titled `release: vX.Y.Z` with exactly three generated changes: the
  `package.json` version, `CHANGELOG.md`, and `.release-please-manifest.json`. `feat`
  bumps the minor, `fix` and `perf` the patch. A `!` or a `BREAKING CHANGE:` footer
  bumps the **minor** while the version is below 1.0.0 (`bump-minor-pre-major`) —
  1.0.0 is a deliberate act, not the side effect of one commit. To force a version,
  put `Release-As: X.Y.Z` in a commit footer.
- **That pull request is merged** → the merge is a push to `main`, so `release.yml`
  runs again; release-please tags `vX.Y.Z` and creates the GitHub release.

Squash-merge the release pull request, so the commit on `main` keeps its
`release: vX.Y.Z` subject. Because every pull request here is squash-merged, the
subject release-please reads is the **pull request title** — see CONTRIBUTING.md.

The manifest starts at `0.0.0` with no `bootstrap-sha`, so the first release pull
request covers the whole history and proposes `0.1.0`.

## One-time setup (maintainer, GitHub)

**Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions
to create and approve pull requests."** It is off by default, and while it is off
release-please cannot open the release pull request — the run fails with *GitHub
Actions is not permitted to create or approve pull requests*. Nothing in a workflow
file can grant it. The neighbouring "Workflow permissions" radio can stay on the
read-only default: `release.yml` declares per job the write scopes it needs.

## Cutting a release

1. Land the work on `main` through squash-merged pull requests with
   Conventional-Commit titles. CI runs on every push.
2. Wait for the `release` run to open or update the `release: vX.Y.Z` pull request.
3. Read the diff — the version and the generated changelog are the whole review.
4. **Approve the `ci` run** on that pull request. It is already there and sitting in
   `action_required`, so the required `test` check is blocked until you do:
   `gh api -X POST repos/firejune/stovesdk.js/actions/runs/<id>/approve`, or
   **Approve and run** in the Actions tab. See below for why.
5. **Merge it.** That is the cut.
6. Watch the second `release` run: it tags `vX.Y.Z` and creates the GitHub release.
7. Dispatch `prebuild.yml` for the tag — next section. It fetches the SDK, builds the
   tagged commit, smokes it and attaches `stovesdk.node` and `SHA256SUMS`.
8. Dispatch `publish.yml` — [Publishing](#publishing). The publish takes the binary from
   the release, so it cannot run before step 7.

## Prebuilt binaries

The prebuild is produced by [`prebuild.yml`](.github/workflows/prebuild.yml) on a
GitHub-hosted Windows x64 runner, dispatched by hand for the tag once its release exists:

```sh
gh workflow run prebuild.yml -f tag=vX.Y.Z    # add -f dry-run=true to build, smoke and stage without uploading
gh run watch "$(gh run list --workflow prebuild --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The job checks that the tag exists, names a GitHub release, matches that tag's
`package.json` version and carries no prebuild yet. It fetches the SDK drop pinned in
[`tools/sdk-manifest.json`](tools/sdk-manifest.json) from the vendor's download CDN with
[`tools/fetch-sdk.js`](tools/fetch-sdk.js), verifying each archive's SHA-256 before
extracting it into the runner's temporary directory — a mismatch fails the run; nothing
is substituted and no hash is rewritten. It builds the exact tagged commit, runs the
load-only smoke with the three SDK DLLs beside the `.node`, and uploads exactly
`stovesdk.node` and `SHA256SUMS` to the release. Nothing from the SDK leaves the runner:
no archive, header, import library, DLL or PDB is uploaded, not even as an Actions
artifact. The run summary records the built commit, the SDK version and the binary's hash.

The smoke proves that the addon links and loads and that its pure paths behave. It does
not exercise STOVE login, ownership or achievements — the runner has no STOVE client. That
check belongs to a consumer, against a real client.

Runs for the same tag are serialised, and an existing asset is never overwritten: a
dispatch for a tag that already carries the files fails before building. To rebuild on
purpose, remove the two assets by hand first. The SDK pin and the fetch tool are taken
from the ref the workflow is dispatched from (`main`), the source from the tag, so an
older tag can be rebuilt with the current pin; the summary names both commits.

Changing the pin — the version, URLs or hashes in `tools/sdk-manifest.json` — is a pull
request of its own, never combined with an addon change; the version stays the one the
addon has been built and smoke-tested against.

A local build (README, *Build*) is for development; release binaries come from the
workflow. The runner's workspace has no user directory in its path, so the `.pdb` path
the linker embeds in the `.node` carries none either; the job prints the embedded path
and fails on one that does.

## Publishing

Publishing is [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
dispatched by hand after the prebuild is attached:

```sh
gh workflow run publish.yml -f tag=vX.Y.Z    # add -f dry-run=true to pack and verify without publishing
gh run watch "$(gh run list --workflow publish --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The job checks out the tag and checks that it names the `package.json` version;
downloads `stovesdk.node` and `SHA256SUMS` from the GitHub release and verifies the
checksum; runs the unit tests and the typings; packs, and checks with
`tools/check-tarball.js` that the tarball carries exactly that one binary and nothing
from the SDK; then `npm publish` over **OIDC trusted publishing** — no npm token exists
in the repository, npm attaches provenance, and the runner is GitHub-hosted (npm does
not support OIDC from self-hosted runners). The published package therefore carries
the prebuild at `prebuilds/win32-x64/`, the last place `load()` looks; a git-tag
install carries no binary (README, *Install*).

The publish is deliberately not a step of `release.yml`, which has no publish step,
no token and no `id-token: write` and must not gain any: the prebuild is compiled
against the private SDK outside CI after the tag exists, so a publish on the release
push would have nothing to ship.

### One-time setup (maintainer, npmjs.com)

npm's trusted publisher is configured in the package's settings on npmjs.com, so the
package has to exist there before the workflow can publish — the first version is
published by hand. From the tag, with the attached `stovesdk.node` and `SHA256SUMS`
placed in `prebuilds/win32-x64/`:

```sh
npm pack --dry-run --json --ignore-scripts > /tmp/pack.json && node tools/check-tarball.js /tmp/pack.json --with-prebuild
npm publish --access public
```

Then, in the package's settings, add a trusted publisher: **GitHub Actions**, owner
`firejune`, repository `stovesdk.js`, workflow filename `publish.yml`, no environment.
Under *Allowed actions* tick **publish directly** — the workflow runs `npm publish`,
and with staging alone every release would wait for a 2FA approval by hand — and leave
*manage dist-tags* off: the workflow never runs `npm dist-tag`. A trusted publisher
cannot be edited once created, so a change of workflow name or permissions means
adding a new one. The package's *Publishing access* can stay on the strictest 2FA
option; npm states trusted publishers work under any of them. Trusted publishing needs
npm CLI 11.5.1 or later; the workflow upgrades npm because Node 22 bundles npm 10.

## Why the release pull request's check has to be approved by hand

release-please opens its pull request with `GITHUB_TOKEN`. GitHub still creates the
`pull_request` run for it, but withholds the permission to start, so the run lands in
**`action_required`** and the required `test` check reads as **blocked rather than
absent**. Approving it is a standing step of every cut.

A green `workflow_dispatch` run on the same commit does **not** satisfy the required
check — a required check is matched by the run that reported it, not by the SHA. A
push of your own to the release branch produces another run needing the same
approval.

This repository deliberately does not use a personal access token to avoid the step:
the release pull request only adds generated version and changelog text on top of a
commit `ci.yml` already tested, and the token would be the only long-lived credential
in the repository. If a self-starting check is ever wanted, it takes no edit to
`release.yml`: store a fine-grained token scoped to this repository (**Contents** and
**Pull requests**: read and write) as the secret `RELEASE_PLEASE_TOKEN`, and the
workflow picks it up. The cost is a credential to rotate.

The release branch is named after `package-name` in `release-please-config.json`, so
scripts read it from the pull request (`gh pr view <n> --json headRefName`) rather
than hard-coding it.

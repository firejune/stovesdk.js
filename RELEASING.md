# Releasing

The cut is one click: merge the release pull request. Everything either side of that
click is [`.github/workflows/release.yml`](.github/workflows/release.yml). A release
today is a version, a `CHANGELOG.md` entry, a `vX.Y.Z` tag and a GitHub release.
**It is not an npm publish** — see [Publishing](#publishing).

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
7. Attach the prebuilt binary, if there is one for this version — next section.

## Prebuilt binaries

The addon is compiled against the private SDK, which no public workflow has access
to, so **prebuilds are not produced by this repository's CI yet**. For now they are
built outside this repository, on a maintainer-controlled Windows x64 build, from the
tagged tree, and **attached to the GitHub release by hand**:

```sh
git checkout vX.Y.Z
npm ci && npm run check-sdk && npm run build
for m in BaseSDK OwnershipSDK GameSupportSDK; do cp "$(node tools/sdk-dir.js)/$m/Deploy/Bin/x64/Release/$m.dll" build/Release/; done
npm run smoke
mkdir -p prebuilds/win32-x64 && cp build/Release/stovesdk.node prebuilds/win32-x64/
(cd prebuilds/win32-x64 && sha256sum ./* > SHA256SUMS)
gh release upload vX.Y.Z prebuilds/win32-x64/stovesdk.node prebuilds/win32-x64/SHA256SUMS
```

Build from a path with no user directory in it. The linker records the absolute path
of the `.pdb` inside the `.node`, so a checkout under a home directory publishes that
path with the binary. Mapping a drive letter onto the checkout is enough —
`subst S: <checkout>`, run the build from `S:\`, then `subst S: /D` — and
`strings stovesdk.node | grep -i '\.pdb'` shows what went in. The v0.1.0 binary was
built this way.

Only the addon is attached — never the SDK's DLLs, which are not ours to
redistribute. Build from the tag, never from a working tree, so the binary is the
code the release names. [`.github/workflows/prebuild.yml`](.github/workflows/prebuild.yml)
is the skeleton of the eventual CI path; its header lists the open options for giving
CI the SDK, and [ROADMAP.md](ROADMAP.md) tracks the decision.

## Publishing

**npm publishing is not authorized for this package.** `release.yml` has no publish
step, no npm token and no `id-token: write`, and must not gain any of them until the
maintainer decides otherwise. Do not run `npm publish` by hand either.

When it is authorized, the intended shape is the sibling repositories': publish from
the same `release` job on the release push, over OIDC trusted publishing (no token,
provenance attached), on a GitHub-hosted runner, gated by the same checks as the
`test` job. Two questions have to be settled first: what the tarball carries for the
native part — today an install compiles nothing and the consumer places the release
binary (README, *Install*); a prebuild inside the tarball or a download from the
GitHub release at install time are the options (#8) — and that `npm pack` still
contains nothing from the SDK — CI already refuses the latter on every pull request.

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

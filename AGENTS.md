# AGENTS.md

Guidance for AI-assisted sessions — and for the automated code reviewer — working on
this repository. [CLAUDE.md](CLAUDE.md) points here; this file is the one copy.

## What this is

`stovesdk.js` is an unofficial N-API addon plus a thin JS entry and TypeScript
typings for the **STOVE PC SDK**, so Node.js and Electron games can call it the way
`steamworks.js` lets them call Steamworks. [README.md](README.md) is the user-facing
contract (build, usage, API table, error codes, threading model);
[`index.d.ts`](index.d.ts) is the typed contract; [`src/stovesdk.cc`](src/stovesdk.cc)
is the whole native side.

## The doctrine

- **A thin wrapper, no game policy.** The module reports what the SDK said. What a
  game does when ownership fails, whether it blocks, shows a dialog, switches to a
  demo or quits, belongs to the game. A change that adds a decision on the caller's
  behalf is out of scope, however convenient.
- **Bring your own SDK.** The vendor serves the SDK's archives from its developer-center
  download CDN without a credential, and [`tools/fetch-sdk.js`](tools/fetch-sdk.js)
  fetches the drop pinned in [`tools/sdk-manifest.json`](tools/sdk-manifest.json) for the
  prebuild, verifying every archive first (#21). That is where this module's contact with
  the SDK ends: nothing from it is ever committed, packed or redistributed — no headers,
  import libraries, DLLs, samples or excerpts of its documentation. A public download is a
  fact about the vendor's hosting, not a licence to redistribute; what governs use is the
  STOVE Studio Terms of Use a partner account accepts — its Art. 7(5) (no provision or
  disclosure of the SDK to third parties without written consent, no reverse engineering,
  no use beyond the provided purpose) and Art. 18 (confidentiality) are the source of this
  policy. In writing on 2026-10-07 the vendor confirmed, on the maintainer's question, that
  a hosted build service fetching the archives for a transient build and this open-source
  wrapper are within that purpose, on conditions this file keeps: nothing from the SDK in
  the repository or a package; the SDK never statically linked into or embedded in a
  shipped binary (the `.node` imports the DLLs dynamically); nothing learned from analysing
  SDK binaries; no bypassing or imitating OwnershipSDK's ownership check; the package
  stating that it is not official (README, *Disclaimer*). Builds resolve the SDK from
  `sdk/` or `STOVE_PCSDK_DIR`
  ([`tools/sdk-dir.js`](tools/sdk-dir.js) is the one resolver). CI refuses a tracked SDK
  file or binary and anything of the kind in `npm pack`.
- **N-API is touched on the JS thread only.** SDK callbacks are plain C function
  pointers on a thread the vendor does not document. They copy their result into a
  mutex-guarded queue; `runCallbacks()` drains it on the JS thread, where Promises
  settle and follow-up SDK calls are made. Never call into N-API from a callback.
- **Every failure has a shape.** Argument errors throw `TypeError`/`RangeError`
  synchronously before anything reaches the SDK. Asynchronous failures reject with an
  `Error` carrying `step`, `sdk`, `method`, `code`, `externalError`. Negative codes are
  the addon's own (`ErrorCode`); non-negative codes are the SDK's. Synchronous reads
  never throw — they answer `{ ok: false, code, reason }`.
- **No silent loss.** 64-bit SDK values cross as decimal strings. `uninitialize()`
  tears down in reverse order and rejects every pending Promise with
  `ErrorCode.ABORTED` rather than leaving it hanging.
- **One build for Node and Electron.** N-API version 8, no per-ABI rebuilds. The `.node`
  hard-imports the three SDK DLLs on purpose (a missing DLL is a catchable error at
  `require()`, not a crash on first call). `load()` turns that error into
  `STOVE_PCSDK_DLL_NOT_FOUND` naming the missing DLLs when they are next to neither the
  addon nor the host executable, and rethrows anything else untouched.
- **An install compiles nothing.** `package.json` sets `"gypfile": false`, so npm does
  not turn the root `binding.gyp` into an implicit `node-gyp rebuild`; `npm run build` is
  the only build, and the consumer places the release binary where `load()` looks
  (README, *Install*). `test/package.test.js` pins this. The npm tarball carries the
  prebuild (#15), so an npm install needs no further step; a git-tag install does.

## Conventions

- CommonJS, Node >= 18, no runtime dependencies. The JS entry loads the addon lazily
  (`load()`), so requiring the package off Windows does not throw.
- A public API change moves four places together: `src/stovesdk.cc`,
  `index.d.ts`, the README API table, and `test/types-usage.ts` (the compile-only
  check of the typings). `tools/smoke.js` checks the export surface of a built addon.
- `files` in `package.json` is the allowlist of what ships. A runtime file outside it
  works from a clone and throws `Cannot find module` from an install. `prebuilds/` is in
  it for the maintainer-built addon that `publish.yml` adds; the SDK's DLLs never are.
- No `os`/`cpu` in `package.json`: an install compiles nothing, so the fields would only
  break `npm install` on the machines a consumer game is developed on. `load()` refuses
  off Windows at runtime instead.
- Conventional Commits, English subject and body, a scope where one fits
  (`feat(addon):`, `fix(js):`, `ci(prebuild):`, `docs(readme):`). Commit each
  finished unit. [CONTRIBUTING.md](CONTRIBUTING.md) has what each type does to a release.
- Pushing, merging, tagging and publishing are the maintainer's call.

## Public-repository hygiene

This repository is public. Nothing goes in that names a particular game or studio
project, a game ID or application key, a machine, runner or host name, an internal
URL or address, a credential, or text that is not English. Examples use placeholders
(`YOUR_GAME_ID`). Before a commit, grep the change for identifiers like these and for
SDK file types (`.dll .lib .pdb .node .h`); CI checks the file types, not the words.

## Verification — run these before you call a unit finished

Off Windows, `npm ci` installs the dev dependencies (nothing is compiled on install).
These are the commands CI's `test` job runs:

| Command | Checks |
| --- | --- |
| `npm test` | `node --test` over `test/**/*.test.js` — addon path and SDK directory resolution, platform refusal, error codes. No native build needed |
| `npm run typecheck` | `tsc --noEmit` over `test/tsconfig.json`: `strict`, `skipLibCheck: false`, so `index.d.ts` itself is compiled together with a usage file |
| `git ls-files '*.js' \| xargs -n1 node --check` | syntax of every tracked script |
| `sh tools/syntax-check.sh` | *(local only, needs the SDK headers and clang)* parses the C++ against the real SDK headers — a pre-flight, not a build |
| `npm run build && npm run smoke` | *(Windows x64 with the SDK only)* the real build and a load-only smoke of the addon; the smoke needs the three SDK DLLs copied beside the `.node` first ([README](README.md), *Build*). `node tools/fetch-sdk.js sdk` fetches the pinned SDK drop |
| `gh workflow run prebuild.yml -f tag=vX.Y.Z -f dry-run=true` | *(a writer, from any branch)* the workflow itself on a GitHub-hosted Windows runner: SDK fetch and checksum verification, build of that **tag's** source, smoke, staging — uploading nothing. It exercises a change to the workflow or the fetch tool, not a change to `src/` on the branch |

A change to `src/` is not compiled by the `test` job, and a prebuild dry run builds a
tag, not a branch. Say in the pull request which of the last three you ran, and their
output.

## Issues, pull requests and the agent pipeline

- **Issues are the ledger.** Work starts from an issue; the pull request that does it
  says `Closes #N` (or `Refs #N`) in a commit body, and its result is reported on the
  issue.
- **Every change to `main` is a pull request, squash-merged.** The squash subject is
  the pull request title, so the title is a Conventional Commit subject — it is what
  release-please reads. The squash body is the branch's commit messages, so footers
  (`Release-As:`, `BREAKING CHANGE:`, `Closes #N`) belong in commit messages, not in
  the pull request description.
- **The required check is `test`** (`.github/workflows/ci.yml`). Branch protection
  applies to administrators too.
- **Labels for unattended agent runs**, as in the sibling repositories:

  | Label | Meaning |
  | --- | --- |
  | `agent-ok` | the issue is cleared for an unattended agent run to pick up |
  | `agent-wip` | an unattended run is working on it |
  | `agent-done` | the run opened a pull request for it |
  | `agent-merged` | that pull request was merged by the pipeline |

  Only a maintainer sets `agent-ok`. An issue without it is not for unattended work,
  and an issue whose direction is still open never gets it.

## Code Review Rules

The automated reviewer reads this section. Review the diff against the doctrine
above; these are the findings that matter here, by severity.

**P0 — block the merge**

- Anything that bypasses, short-circuits or imitates OwnershipSDK's ownership check —
  a stub result, a cached "owned" answer, a path around `Ownership_OwnershipList` — or
  static linking / embedding of SDK code in the `.node`, or anything derived from analysing
  the SDK's binaries. These are the vendor's written conditions (AGENTS.md, *Bring your
  own SDK*), not style.
- Any SDK material in the diff: headers, `.lib`/`.dll`/`.pdb`, a compiled `.node`,
  vendored SDK source, or text copied from the vendor's documentation.
- A secret, game ID, application key, internal URL or address, or a machine/runner
  name — anywhere, including comments, tests and workflow files.
- A workflow change that lets untrusted code reach a privileged runner or secret:
  a `pull_request`/`pull_request_target`/`push`/`schedule` trigger on `prebuild.yml`,
  a self-hosted runner on a job that builds pull requests, or `${{ github.event.* }}`
  text interpolated into a `run:` script instead of passed through `env:`.
- A publish step, an npm token or `id-token: write` in any workflow but `publish.yml`,
  or a long-lived npm token anywhere at all: publishing is OIDC trusted publishing from
  `publish.yml` alone, on a GitHub-hosted runner, from a tag whose GitHub release carries
  the prebuild (RELEASING.md *Publishing*). A `pull_request`/`push`/`release`/`schedule`
  trigger on `publish.yml`, a self-hosted runner there, or the prebuild being built there
  instead of downloaded from the release, is the same finding.

**P1 — real defects**

- N-API called from an SDK callback, or shared state touched off the JS thread
  without the queue's mutex.
- A Promise that can be left pending forever: a path that neither settles it from
  `runCallbacks()` nor rejects it in `uninitialize()`.
- An SDK call reached with unvalidated arguments, or an argument error reported
  asynchronously instead of thrown synchronously.
- A rejection without the `{ step, sdk, method, code, externalError }` shape, an addon
  code that is not negative, or a 64-bit value crossing as a `Number`.
- Game policy added to the module: blocking, quitting, dialogs, demo switches, retry
  policies a game should own.
- A public API change that is missing from `index.d.ts`, the README table or
  `test/types-usage.ts`, or a runtime file left out of `files`.
- Resource leaks across `initialize()` / `uninitialize()` cycles; teardown out of order.

**Not findings**

- Anything CI already checks (unit tests, typings, script syntax, workflow parse,
  tracked/packed SDK files). If the reviewer finds itself repeating CI, the rule
  belongs in CI instead.
- Style and formatting, naming preferences, and defensive hardening for situations the
  SDK cannot produce. Note them as suggestions at most; do not mark them P0/P1.
- That `src/` was not compiled in CI. It cannot be; the pull request says what was run.

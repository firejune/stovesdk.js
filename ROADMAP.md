# Roadmap

Short on purpose. Open work lives in issues; this page says what each phase is for
and what "done" means for it.

## Phase 1 — the addon as a standalone module

The N-API addon, the JS entry and typings, a build against a locally supplied SDK,
and this repository's operating model (CI, release-please, review rules). No game
identifiers, no game policy. Tracked in issue #1.

## Phase 2 — consumers and a CI prebuild path

- **A real consumer.** At least one Electron game switches from its own embedded
  addon to this package, with no game-specific code flowing back into the module.
  What it needed and did not find becomes issues here, not patches in the game.
- **A CI prebuild path.** Decide how a workflow gets the SDK (the options are in the
  header of [`prebuild.yml`](.github/workflows/prebuild.yml)), then have a tagged
  release produce the Windows x64 prebuild with a checksum and attach it to the GitHub
  release — replacing the manual step in [RELEASING.md](RELEASING.md). Whatever is
  chosen keeps the trust boundary that file states: no pull request ever reaches a
  runner that may hold the SDK.
- **The install story.** How the native part reaches a consumer. Decided (#8, #15):
  an install compiles nothing (`"gypfile": false`); the npm package carries the
  Windows prebuild where `load()` looks, and a git-tag install takes it from the
  GitHub release (README, *Install*).
- **npm.** Published as `stovesdk.js` from `publish.yml` over trusted publishing, by
  hand once a release carries its prebuild (#15, RELEASING.md *Publishing*).

## Later

- **API coverage** beyond ownership, achievements and stats, driven by what consumers
  ask for rather than by the size of the SDK.
- **1.0** — when a consumer has shipped on it and the API has stopped moving.

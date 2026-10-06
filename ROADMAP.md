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
- **A CI prebuild path.** Decided (#21): [`prebuild.yml`](.github/workflows/prebuild.yml)
  fetches the SDK drop pinned in `tools/sdk-manifest.json` from the vendor's download
  CDN, verifies it, builds the tag on a GitHub-hosted Windows runner and attaches the
  prebuild and its checksum to the GitHub release — dispatched by hand after the cut
  (RELEASING.md). The trust boundary stays: no pull request reaches the job. Dispatching
  it from the release run automatically is a follow-up.
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

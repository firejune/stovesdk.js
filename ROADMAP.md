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
- **The install story.** How the native part reaches a consumer. Decided for now
  (#8): an install compiles nothing (`"gypfile": false`), and the consumer places the
  binary from the GitHub release where `load()` looks (README, *Install*). A prebuild
  inside the package or a download at install time come back on the table with npm
  publishing.

## Later

- **npm publishing** — not authorized today. RELEASING.md *Publishing* says what has
  to be settled first.
- **API coverage** beyond ownership, achievements and stats, driven by what consumers
  ask for rather than by the size of the SDK.
- **1.0** — when a consumer has shipped on it and the API has stopped moving.

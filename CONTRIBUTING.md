# Contributing

Thanks for looking. This module is small on purpose — a thin wrapper around the STOVE
PC SDK with no game policy — and most of its opinions are written down in
[AGENTS.md](AGENTS.md). It is worth ten minutes before a first patch.

## Issues are the ledger

Open an issue before a substantial change. Open questions and decisions live in
issues rather than in a backlog file, so an issue is where a decision gets its reasons
attached and where the next reader finds them.

A good defect report names:

1. the SDK version (`getAddonInfo().sdkVersion`), Node or Electron version, and
   whether you used a prebuild or your own build;
2. the call you made and what came back, verbatim — for a rejection, its `step`,
   `sdk`, `method`, `code` and `externalError`;
3. what you expected instead.

⚠️ **Never attach SDK files, game IDs, application keys or logs that contain them.**
Redact them to placeholders. This repository is public.

## Before you open a pull request

You do not need Windows or the SDK for the JS side. Off Windows, install with
`npm ci --force`: `package.json` declares `os: ["win32"]` / `cpu: ["x64"]`, and
`--force` skips only that check. CI's `test` job runs the same commands:

```bash
npm test                 # node --test, pure JS
npm run typecheck        # strict tsc over index.d.ts and a usage file
```

A change to `src/` or `binding.gyp` cannot be checked by CI — the build needs the
private SDK. Run these yourself and paste their output into the pull request:

```bash
sh tools/syntax-check.sh             # any OS with clang and the SDK headers: parse-only pre-flight
npm run build && npm run smoke       # Windows x64 with the SDK: the real build, then a load-only smoke
```

## What a change has to clear

- **No game policy.** What happens when a check fails is the game's decision.
- **No SDK material.** Nothing from the SDK is committed or packed; CI refuses
  tracked SDK file types and anything of the kind in `npm pack`.
- **N-API on the JS thread only.** SDK callbacks enqueue; `runCallbacks()` settles.
- **The API moves as one.** A public change updates `src/stove_pcsdk.cc`,
  `index.d.ts`, the README API table and `test/types-usage.ts` together.
- **Every failure keeps its shape.** Synchronous argument errors, rejections with
  `{ step, sdk, method, code, externalError }`, negative codes for the addon's own.

The full list, with severities, is AGENTS.md *Code Review Rules* — the reviewer reads
the same section you do.

## Commits and pull requests

[Conventional Commits](https://www.conventionalcommits.org/) with a scope where one
fits — `feat(addon):`, `fix(js):`, `docs(readme):`, `ci(prebuild):`. Subject and body
in English. Keep one unit of work per commit.

Every change reaches `main` as a pull request and is **squash-merged**, so:

- **The pull request title is the commit subject on `main`** and must itself be a
  Conventional Commit subject. release-please reads it to pick the next version and
  writes it into `CHANGELOG.md`: `feat` bumps the minor, `fix` and `perf` the patch;
  `docs`, `test`, `ci`, `build`, `chore`, `refactor` and `style` are hidden and do not
  cut a release on their own. While the version is below 1.0.0, a breaking change
  (`!` or a `BREAKING CHANGE:` footer) bumps the minor. See [RELEASING.md](RELEASING.md).
- **The squash body is made of the branch's commit messages**, not of the pull
  request description. Footers that must reach `main` — `Closes #N`, `Release-As:`,
  `BREAKING CHANGE:` — go in a commit message.
- **The required check is `test`.** It has to be green before the merge button works.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](LICENSE). Your use of
the STOVE PC SDK itself is governed by STOVE's own terms.

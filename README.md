# stovesdk.js

Unofficial Node.js / Electron bindings for the **STOVE PC SDK** (N-API).

The STOVE PC SDK ships official bindings for C, C#, and C++ only. This project wraps the native SDK so Electron and Node.js games can use it the way `steamworks.js` wraps Steamworks.

> **Status: alpha.** Install from npm as `stovesdk.js`; the Windows x64 prebuild ships inside the package and is also attached to each [GitHub release](https://github.com/firejune/stovesdk.js/releases). See *Install* and *Build* below.

## Scope

A thin wrapper around the SDK. No game policy.

- SDK initialize / uninitialize
- Callback pump (`RunCallback`) for the host event loop
- Ownership query
- Achievements and stats
- Login identity reads (user, country/language)

What a game does when a check fails (blocking, demo modes, messaging, quitting) belongs in the game, not in this module.

## Platform

Windows x64 only, which matches the STOVE PC SDK itself. The addon targets N-API (version 8), so one build works across Node.js and Electron versions without a rebuild for every Electron ABI.

## Bring your own SDK

The STOVE PC SDK is **not** included in this repository and is not redistributed by this package.

1. Download the STOVE PC SDK from the STOVE developer portal under your own developer account — or run `node tools/fetch-sdk.js sdk`, which fetches the drop this module is built against (version, URLs and SHA-256 of each archive are pinned in [`tools/sdk-manifest.json`](tools/sdk-manifest.json); a checksum mismatch fails the fetch).
2. Place it under [`sdk/`](sdk/README.md), or point `STOVE_PCSDK_DIR` at your copy. The expected layout is documented in `sdk/README.md`; `npm run check-sdk` tells you what is missing.

Your use of the SDK is governed by STOVE's own terms — the developer agreement of your STOVE Studio account. That the archives download without a credential does not make them redistributable, and this package does not redistribute them.

## Install

```sh
npm install stovesdk.js
```

The package carries the Windows x64 prebuild at `prebuilds/win32-x64/stovesdk.node` (with its `SHA256SUMS`), which is the last place `load()` looks, so the binary needs no further step. Installing compiles nothing: `package.json` sets `"gypfile": false`, so npm does not run the implicit `node-gyp rebuild` that a root `binding.gyp` would otherwise trigger, and the install succeeds on any platform — the JS entry works everywhere, and off Windows `load()` refuses at runtime with code `STOVE_PCSDK_UNSUPPORTED_PLATFORM`.

What you still provide is the SDK: `BaseSDK.dll`, `OwnershipSDK.dll` and `GameSupportSDK.dll` next to the `.node` or next to your executable (see *Build*). They are part of the SDK, not of this package.

### Where `load()` looks

In order; the first file that exists wins:

| Location | How |
| --- | --- |
| Any path | `load('C:/path/to/stovesdk.node')` |
| Any path | `STOVE_PCSDK_ADDON=C:/path/to/stovesdk.node` in the environment |
| `node_modules/stovesdk.js/build/Release/` | where `npm run build` puts its output |
| `node_modules/stovesdk.js/prebuilds/win32-x64/` | where the npm package ships the prebuild |

An Electron app usually ships the `.node` in its own resources, next to the three SDK DLLs it has to ship anyway, and calls `load(path)` with that location. When none of the four places has a file, `load()` throws with code `STOVE_PCSDK_ADDON_NOT_FOUND` and lists the paths it tried.

### Installing from a git tag instead

```sh
npm install github:firejune/stovesdk.js#vX.Y.Z
```

installs the same package without the prebuild (binaries are not tracked in git). Download `stovesdk.node` and `SHA256SUMS` from the [GitHub release](https://github.com/firejune/stovesdk.js/releases) of the same version, check the sum (`sha256sum -c SHA256SUMS`, or `CertUtil -hashfile stovesdk.node SHA256`), and put the binary in one of the places above. (v0.1.0 still runs `node-gyp rebuild` on install; add `--ignore-scripts` for that one.)

Or build the binary yourself, below.

## Build

On Windows x64 with Visual Studio Build Tools (C++ workload) and Python installed. The pinned build tool (node-gyp 13) declares Node `^22.22.2 || ^24.15.0 || >=26` — that is a requirement of the build, not of the addon, whose runtime floor stays Node 18:

```sh
npm ci                    # dev dependencies; nothing is compiled on install
npm run check-sdk         # verifies sdk/ or STOVE_PCSDK_DIR
npm run build             # node-gyp rebuild → build/Release/stovesdk.node
for m in BaseSDK OwnershipSDK GameSupportSDK; do
  cp "$(node tools/sdk-dir.js)/$m/Deploy/Bin/x64/Release/$m.dll" build/Release/
done                      # the smoke loads the .node, which needs the three SDK DLLs beside it
npm run smoke             # loads the addon and exercises the paths that need no STOVE client
```

The `.node` hard-imports `BaseSDK.dll`, `OwnershipSDK.dll` and `GameSupportSDK.dll`. Ship those three DLLs next to the `.node` (or next to your executable) — they are part of the SDK, not of this package. When one is in neither place, `load()` throws with code `STOVE_PCSDK_DLL_NOT_FOUND` naming the missing files and the two directories it checked (see *`load()` errors*).

On other platforms the JS side still works for development, but there is nothing to compile: `npm ci`, then `npm test` and `npm run typecheck` run as they do in CI; `tools/syntax-check.sh` can parse the C++ against your SDK headers with clang as a pre-flight.

## Usage

```js
const { load, ErrorCode } = require('stovesdk.js')

const stove = load() // throws off Windows, when no build/prebuild exists, or when an SDK DLL is missing (see `load()` errors)

// The SDK delivers every asynchronous result through its callback pump.
// Run it on the thread that initializes the SDK (the Electron main process), ~16 ms.
const pump = setInterval(() => stove.runCallbacks(), stove.getAddonInfo().pumpIntervalMs)

async function main() {
  const init = await stove.initialize({
    environment: 'LIVE',          // as configured for your title in STOVE Studio
    gameId: 'YOUR_GAME_ID',
    applicationKey: 'YOUR_APPLICATION_KEY', // never the Application Secret
  })
  if (init.status === 'restart') {
    // The SDK asked the STOVE client to relaunch the app through the launcher.
    // The vendor guide expects the app to exit here — that decision is yours.
    return
  }

  const { OwnershipCode, OwnershipGameCode } = stove.constants
  const ownerships = await stove.getOwnershipList()
  const ownsGame = ownerships.some(
    o => o.ownershipCode === OwnershipCode.ACQUIRE && o.gameCode === OwnershipGameCode.BASIC
  )

  // Achievements on STOVE are driven by stats: an achievement is a stat plus a goal,
  // so "unlocking" one means modifying its stat.
  await stove.setStat('STAT_ID', 1)
  const achievement = await stove.getAchievement('ACHIEVEMENT_ID')
  console.log(ownsGame, achievement.status)
}

main()
  .catch(err => {
    // Every rejection is an Error with { step, sdk, method, code, externalError }.
    if (err.code === ErrorCode.NOT_INITIALIZED) console.error('call initialize() first')
    else console.error(err.step, err.code, err.message)
  })
  .finally(() => {
    clearInterval(pump)
    stove.uninitialize()
  })
```

## API

All functions live on the object returned by `load()`. Full types: [`index.d.ts`](index.d.ts).

| Function | SDK call | Returns |
| --- | --- | --- |
| `initialize({ environment, gameId, applicationKey, restartWaitMs? })` | `Base_RestartAppIfNecessaryAsync` → `Base_Initialize` | `Promise<{ status: 'ok', result } \| { status: 'restart' }>` |
| `runCallbacks()` | `Base_RunCallback` | `void` — call periodically; Promises settle from here |
| `isInitialized()` | — | `boolean` |
| `uninitialize()` | `GameSupport_UnInitialize`, `Ownership_UnInitialize`, `Base_UnInitialize` (those that were initialized) | `{ gameSupport, ownership, base }` — pending Promises reject with `ErrorCode.ABORTED` |
| `getOwnershipList()` | `Ownership_OwnershipList` (`Ownership_Initialize` lazily) | `Promise<Ownership[]>` — raw list; interpret with `constants` |
| `getUser()` | `Base_GetUser` | `{ ok, memberNumber, gameUserId, nickname }` (sync) |
| `getGds()` | `Base_GetGds` | `{ ok, nation, isDefault, language }` (sync) |
| `getAchievement(id)` | `GameSupport_Achievement` | `Promise<Achievement>` (a query — completes nothing) |
| `getAllAchievements()` | `GameSupport_AllAchievement` | `Promise<Achievement[]>` |
| `getStat(statId)` | `GameSupport_Stat` | `Promise<Stat>` |
| `setStat(statId, int32)` | `GameSupport_ModifyStat` | `Promise<ModifyStatResult>` |
| `getVersion()` | `Base_GetVersion` | `{ ok, version }` (sync, informational) |
| `getAddonInfo()` | — | `{ sdkVersion, napiVersion, arch, platform, pumpIntervalMs }` |
| `constants` | SDK enums | `OwnershipCode`, `OwnershipGameCode`, `ErrorCode` |

Notes:

- `GameSupport_Initialize` runs lazily on the first achievement/stat call; `Ownership_Initialize` on the first `getOwnershipList()`. Both are torn down by `uninitialize()`, Base last.
- 64-bit values (`memberNumber`, `purchaseDate`, `updatedAt`) cross as decimal strings so no precision is lost.
- Synchronous reads (`getUser`, `getGds`) never throw: before `initialize()` they answer `{ ok: false, code: ErrorCode.NOT_INITIALIZED, reason }`.
- Argument errors throw synchronously (`TypeError` / `RangeError`) before anything reaches the SDK.
- A stat that has never been written reports `currentValue` as `-2147483648`. That is the SDK's own `int32` value, passed through unchanged.
- Leave a moment between `uninitialize()` and the next `initialize()`. The STOVE client re-creates its side of the connection after a disconnect, and an immediate re-initialize can answer `{ status: 'restart' }`.

### Error codes

Rejected Promises carry `step`, `sdk`, `method`, `code` and `externalError`. `code` is the SDK's own result code (unsigned) when the SDK answered, or one of these negative addon codes when the addon refused the call:

| `ErrorCode` | Value | Meaning |
| --- | --- | --- |
| `NOT_INITIALIZED` | `-1` | `initialize()` has not succeeded, or `uninitialize()` has run |
| `ALREADY_INITIALIZED` | `-2` | `initialize()` called while the SDK is up |
| `IN_PROGRESS` | `-3` | the same kind of call is already in flight |
| `ABORTED` | `-4` | a pending Promise was discarded by `uninitialize()` |

### `load()` errors

`load()` throws synchronously; each error carries a string `code`:

| `code` | When |
| --- | --- |
| `STOVE_PCSDK_UNSUPPORTED_PLATFORM` | not Windows |
| `STOVE_PCSDK_ADDON_NOT_FOUND` | no `stovesdk.node` at the path given, in `STOVE_PCSDK_ADDON`, or in `build/Release/` / `prebuilds/win32-x64/`; the message lists the paths tried |
| `STOVE_PCSDK_DLL_NOT_FOUND` | the addon exists but one of `BaseSDK.dll`, `OwnershipSDK.dll`, `GameSupportSDK.dll` is next to neither the addon nor the host executable; `missing` and `searched` list the files and directories, `cause` is Node's `ERR_DLOPEN_FAILED` |

When all three DLLs are present and the load still fails, the original error is thrown unchanged — the cause is then outside what this module can see, such as the DLLs' own imports (the SDK requires the VC++ redistributable) or a binary built for another architecture.

## Threading model

SDK callbacks are plain C function pointers with no user-data slot, and the vendor docs do not state which thread they fire on. The addon therefore never touches N-API inside a callback: callbacks copy their result into a mutex-guarded queue, and `runCallbacks()` drains that queue on the JS thread, where it advances the init chain, issues follow-up SDK calls and settles Promises.

## Prebuilds, publishing and CI

[`.github/workflows/prebuild.yml`](.github/workflows/prebuild.yml) is dispatched by hand for a release tag. On a GitHub-hosted Windows x64 runner it fetches the pinned SDK drop from the vendor's download CDN (verifying each archive's checksum first), builds the tagged commit, runs the load-only smoke and attaches `stovesdk.node` and `SHA256SUMS` to the GitHub release — nothing from the SDK leaves the runner. The smoke involves no STOVE client; it proves the addon links and loads, not that it talks to STOVE.

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) publishes a tagged release to npm, by manual dispatch once its prebuild is attached: it takes `stovesdk.node` from the GitHub release, checks it against `SHA256SUMS`, checks that the tarball carries that one binary and nothing from the SDK, and publishes over OIDC trusted publishing with provenance. [RELEASING.md](RELEASING.md) has the sequence.

## Contributing and releases

[CONTRIBUTING.md](CONTRIBUTING.md) covers issues, the checks a pull request has to clear and the commit conventions; [RELEASING.md](RELEASING.md) covers how a version is cut and how prebuilds reach a release; [ROADMAP.md](ROADMAP.md) says what comes next.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by, or supported by Smilegate or STOVE. "STOVE" is a trademark of its respective owner.

## License

[MIT](LICENSE)

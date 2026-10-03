# stove-pcsdk.js

Unofficial Node.js / Electron bindings for the **STOVE PC SDK** (N-API).

The STOVE PC SDK ships official bindings for C, C#, and C++ only. This project wraps the native SDK so Electron and Node.js games can use it the way `steamworks.js` wraps Steamworks.

> **Status: alpha.** The addon source, JS entry and typings are in place. Prebuilds are not published yet; build it yourself against your own copy of the SDK (see below).

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

1. Download the STOVE PC SDK from the STOVE developer portal under your own developer account.
2. Place it under [`sdk/`](sdk/README.md), or point `STOVE_PCSDK_DIR` at your copy. The expected layout is documented in `sdk/README.md`; `npm run check-sdk` tells you what is missing.

Your use of the SDK is governed by STOVE's own terms.

## Build

On Windows x64 with Visual Studio Build Tools (C++ workload) and Python installed:

```sh
npm install
npm run check-sdk   # verifies sdk/ or STOVE_PCSDK_DIR
npm run build       # node-gyp rebuild → build/Release/stove_pcsdk.node
npm run smoke       # loads the addon and exercises the paths that need no STOVE client
```

The `.node` hard-imports `BaseSDK.dll`, `OwnershipSDK.dll` and `GameSupportSDK.dll`. Ship those three DLLs next to the `.node` (or next to your executable) — they are part of the SDK, not of this package.

On other platforms the JS side still works for development, but there is nothing to compile. `package.json` declares `os: ["win32"]` and `cpu: ["x64"]`, so npm refuses a plain install there; install the dev dependencies with `npm ci --force` (which skips only that platform check — a lockfile out of sync with `package.json` is still refused) and then `npm test` and `npm run typecheck` run as they do in CI; `tools/syntax-check.sh` can parse the C++ against your SDK headers with clang as a pre-flight.

## Usage

```js
const { load, ErrorCode } = require('stove-pcsdk.js')

const stove = load() // throws off Windows or when no build/prebuild exists

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

### Error codes

Rejected Promises carry `step`, `sdk`, `method`, `code` and `externalError`. `code` is the SDK's own result code (unsigned) when the SDK answered, or one of these negative addon codes when the addon refused the call:

| `ErrorCode` | Value | Meaning |
| --- | --- | --- |
| `NOT_INITIALIZED` | `-1` | `initialize()` has not succeeded, or `uninitialize()` has run |
| `ALREADY_INITIALIZED` | `-2` | `initialize()` called while the SDK is up |
| `IN_PROGRESS` | `-3` | the same kind of call is already in flight |
| `ABORTED` | `-4` | a pending Promise was discarded by `uninitialize()` |

## Threading model

SDK callbacks are plain C function pointers with no user-data slot, and the vendor docs do not state which thread they fire on. The addon therefore never touches N-API inside a callback: callbacks copy their result into a mutex-guarded queue, and `runCallbacks()` drains that queue on the JS thread, where it advances the init chain, issues follow-up SDK calls and settles Promises.

## Prebuilds and CI

[`.github/workflows/prebuild.yml`](.github/workflows/prebuild.yml) is a manually triggered Windows x64 build that expects the SDK to be present on the runner at `STOVE_PCSDK_DIR`. Because the SDK is not public, the workflow does not download it; how CI gets the SDK is an open design question — see the workflow header for the options under consideration.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by, or supported by Smilegate or STOVE. "STOVE" is a trademark of its respective owner.

## License

[MIT](LICENSE)

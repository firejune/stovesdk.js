# stove-pcsdk.js

Unofficial Node.js / Electron bindings for the **STOVE PC SDK** (N-API).

The STOVE PC SDK ships official bindings for C, C#, and C++ only. This project wraps the native SDK so Electron and Node.js games can use it the way `steamworks.js` wraps Steamworks.

> **Status: pre-alpha.** This is the initial scaffold. Nothing is implemented yet.

## Scope

A thin wrapper around the SDK. No game policy.

- SDK initialize / uninitialize
- Callback pump (`RunCallback`) for the host event loop
- Ownership check
- Achievements and stats

What a game does when a check fails (blocking, demo modes, messaging) belongs in the game, not in this module.

## Platform

Windows x64 only, which matches the STOVE PC SDK itself. The addon targets N-API, so one build works across Node.js and Electron versions without a rebuild for every Electron ABI.

## Bring your own SDK

The STOVE PC SDK is **not** included in this repository and is not redistributed by this package.

1. Download the STOVE PC SDK from the STOVE developer portal under your own developer account.
2. Place it under [`sdk/`](sdk/README.md), or point `STOVE_PCSDK_DIR` at your copy.

Your use of the SDK is governed by STOVE's own terms.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by, or supported by Smilegate or STOVE. "STOVE" is a trademark of its respective owner.

## License

[MIT](LICENSE)

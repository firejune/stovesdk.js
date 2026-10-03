'use strict'

// Entry point: locates the compiled addon and loads it.
//
// Search order (first hit wins):
//   1. STOVE_PCSDK_ADDON        — explicit path to a .node file
//   2. ./build/Release/stove_pcsdk.node   — local `npm run build`
//   3. ./prebuilds/win32-x64/stove_pcsdk.node — CI prebuild dropped into the package
//
// DLL lookup: the .node hard-imports BaseSDK.dll / OwnershipSDK.dll / GameSupportSDK.dll. Node
// loads addons with LOAD_WITH_ALTERED_SEARCH_PATH, so DLLs placed next to the .node are found
// first; the directory of the host executable is the other place the Windows loader always looks.
//
// Nothing here imports Electron, so the same file works from plain Node and the Electron main
// process. The load is lazy and explicit (`load()`) so merely requiring this module on a
// non-Windows machine (tests, tooling) does not throw.

const fs = require('fs')
const path = require('path')

const ADDON_FILE = 'stove_pcsdk.node'

const ErrorCode = Object.freeze({
  NOT_INITIALIZED: -1,
  ALREADY_INITIALIZED: -2,
  IN_PROGRESS: -3,
  ABORTED: -4,
})

function candidateAddonPaths(env = process.env, baseDir = __dirname) {
  const list = []
  if (env.STOVE_PCSDK_ADDON && env.STOVE_PCSDK_ADDON.trim()) list.push(path.resolve(env.STOVE_PCSDK_ADDON.trim()))
  list.push(path.join(baseDir, 'build', 'Release', ADDON_FILE))
  list.push(path.join(baseDir, 'prebuilds', 'win32-x64', ADDON_FILE))
  return list
}

function resolveAddonPath(env = process.env, baseDir = __dirname, exists = fs.existsSync) {
  const candidates = candidateAddonPaths(env, baseDir)
  const found = candidates.find(exists)
  if (found) return found
  const err = new Error(
    `[stove-pcsdk] compiled addon not found. Looked in:\n${candidates.map(c => `  - ${c}`).join('\n')}\n` +
      'Build it with `npm run build` on Windows x64 (with the SDK under sdk/ or STOVE_PCSDK_DIR), ' +
      'or set STOVE_PCSDK_ADDON to a prebuilt .node file.'
  )
  err.code = 'STOVE_PCSDK_ADDON_NOT_FOUND'
  throw err
}

let cached = null

function load(addonPath) {
  if (cached) return cached
  if (process.platform !== 'win32') {
    const err = new Error(`[stove-pcsdk] the STOVE PC SDK is Windows-only (platform: ${process.platform})`)
    err.code = 'STOVE_PCSDK_UNSUPPORTED_PLATFORM'
    throw err
  }
  const file = addonPath ? path.resolve(addonPath) : resolveAddonPath()
  if (!fs.existsSync(file)) {
    const err = new Error(`[stove-pcsdk] addon not found: ${file}`)
    err.code = 'STOVE_PCSDK_ADDON_NOT_FOUND'
    throw err
  }
  // eslint-disable-next-line global-require -- native module, resolved at runtime by design
  cached = require(file)
  return cached
}

module.exports = { ADDON_FILE, ErrorCode, candidateAddonPaths, resolveAddonPath, load }

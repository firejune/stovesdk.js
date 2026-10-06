'use strict'

// Entry point: locates the compiled addon and loads it.
//
// Search order (first hit wins):
//   1. STOVE_PCSDK_ADDON        — explicit path to a .node file
//   2. ./build/Release/stovesdk.node   — local `npm run build`
//   3. ./prebuilds/win32-x64/stovesdk.node — CI prebuild dropped into the package
//
// DLL lookup: the .node hard-imports BaseSDK.dll / OwnershipSDK.dll / GameSupportSDK.dll. Node
// loads addons with LOAD_WITH_ALTERED_SEARCH_PATH, so DLLs placed next to the .node are found
// first; the directory of the host executable is the other place the Windows loader always looks.
// When the require() fails with ERR_DLOPEN_FAILED, `load()` checks those two directories for the
// three DLLs and, if any is absent from both, rethrows with code STOVE_PCSDK_DLL_NOT_FOUND naming
// the files — Node's own message names neither the DLL nor the directory, and reads as if the
// .node itself were missing.
//
// Nothing here imports Electron, so the same file works from plain Node and the Electron main
// process. The load is lazy and explicit (`load()`) so merely requiring this module on a
// non-Windows machine (tests, tooling) does not throw.

const fs = require('fs')
const path = require('path')
const { SDK_MODULES } = require('./lib/sdk-dir')

const ADDON_FILE = 'stovesdk.node'
const SDK_DLLS = Object.freeze(SDK_MODULES.map(mod => `${mod}.dll`))

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
    `[stovesdk] compiled addon not found. Looked in:\n${candidates.map(c => `  - ${c}`).join('\n')}\n` +
      'Build it with `npm run build` on Windows x64 (with the SDK under sdk/ or STOVE_PCSDK_DIR), ' +
      'or set STOVE_PCSDK_ADDON to a prebuilt .node file.'
  )
  err.code = 'STOVE_PCSDK_ADDON_NOT_FOUND'
  throw err
}

// The directories this module can vouch for: the addon's own and the host executable's. The
// Windows loader also searches the system directories and PATH, but a consumer does not put
// the SDK there, so a DLL absent from these two is reported as not found.
function sdkDllSearchDirs(addonPath, execPath = process.execPath) {
  return [...new Set([path.dirname(path.resolve(addonPath)), path.dirname(path.resolve(execPath))])]
}

// The SDK DLLs found in none of those directories. Empty when all three are present — then a
// failed load has another cause (a DLL built for another architecture, its own imports such as
// the VC++ runtime missing), and the original error says more than this module can.
function missingSdkDlls(addonPath, execPath = process.execPath, exists = fs.existsSync) {
  const dirs = sdkDllSearchDirs(addonPath, execPath)
  return SDK_DLLS.filter(dll => !dirs.some(dir => exists(path.join(dir, dll))))
}

// The error `load()` throws when `require(addonPath)` threw `err`: a coded error naming the
// missing SDK DLLs when that is what happened, otherwise `err` itself, untouched.
function explainLoadError(err, addonPath, execPath = process.execPath, exists = fs.existsSync) {
  if (!err || err.code !== 'ERR_DLOPEN_FAILED') return err
  const missing = missingSdkDlls(addonPath, execPath, exists)
  if (!missing.length) return err
  const searched = sdkDllSearchDirs(addonPath, execPath)
  const explained = new Error(
    `[stovesdk] the addon imports ${SDK_DLLS.join(', ')}; ` +
      `${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found next to the addon or next to the host executable. Looked in:\n` +
      `${searched.map(dir => `  - ${dir}`).join('\n')}\n` +
      `Copy the SDK's <Module>/Deploy/Bin/x64/Release/<Module>.dll files beside ${path.resolve(addonPath)} ` +
      'or beside your executable. They are part of the STOVE PC SDK, not of this package.',
    { cause: err }
  )
  explained.code = 'STOVE_PCSDK_DLL_NOT_FOUND'
  explained.missing = missing
  explained.searched = searched
  return explained
}

let cached = null

function load(addonPath) {
  if (cached) return cached
  if (process.platform !== 'win32') {
    const err = new Error(`[stovesdk] the STOVE PC SDK is Windows-only (platform: ${process.platform})`)
    err.code = 'STOVE_PCSDK_UNSUPPORTED_PLATFORM'
    throw err
  }
  const file = addonPath ? path.resolve(addonPath) : resolveAddonPath()
  if (!fs.existsSync(file)) {
    const err = new Error(`[stovesdk] addon not found: ${file}`)
    err.code = 'STOVE_PCSDK_ADDON_NOT_FOUND'
    throw err
  }
  try {
    // eslint-disable-next-line global-require -- native module, resolved at runtime by design
    cached = require(file)
  } catch (err) {
    throw explainLoadError(err, file)
  }
  return cached
}

module.exports = { ADDON_FILE, SDK_DLLS, ErrorCode, candidateAddonPaths, resolveAddonPath, missingSdkDlls, explainLoadError, load }

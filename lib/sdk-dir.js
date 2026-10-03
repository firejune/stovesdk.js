'use strict'

// Resolves where the user-supplied STOVE PC SDK lives and what binding.gyp expects to find there.
//
//   STOVE_PCSDK_DIR   explicit location (highest priority)
//   <repo>/sdk        default (gitignored except its README)
//
// Expected layout (the shape the SDK zips unpack to — one folder per module):
//   <sdk>/BaseSDK/Deploy/Include/BaseSDK.h
//   <sdk>/BaseSDK/Deploy/Lib/x64/Release/BaseSDK.lib
//   <sdk>/BaseSDK/Deploy/Bin/x64/Release/BaseSDK.dll
//   ... and the same for OwnershipSDK and GameSupportSDK.
//   <sdk>/VERSION     optional, one line: the SDK version string baked into getAddonInfo().

const fs = require('fs')
const path = require('path')

const SDK_MODULES = ['BaseSDK', 'OwnershipSDK', 'GameSupportSDK']

function defaultSdkDir() {
  return path.join(__dirname, '..', 'sdk')
}

function resolveSdkDir(env = process.env) {
  const fromEnv = env.STOVE_PCSDK_DIR
  return fromEnv && fromEnv.trim() ? path.resolve(fromEnv.trim()) : defaultSdkDir()
}

function headerPath(sdkDir, mod) {
  return path.join(sdkDir, mod, 'Deploy', 'Include', `${mod}.h`)
}

function libPath(sdkDir, mod) {
  return path.join(sdkDir, mod, 'Deploy', 'Lib', 'x64', 'Release', `${mod}.lib`)
}

function dllPath(sdkDir, mod) {
  return path.join(sdkDir, mod, 'Deploy', 'Bin', 'x64', 'Release', `${mod}.dll`)
}

// Returns the list of required files that are missing (empty = layout is complete).
function missingSdkFiles(sdkDir, exists = fs.existsSync) {
  const required = []
  for (const mod of SDK_MODULES) required.push(headerPath(sdkDir, mod), libPath(sdkDir, mod), dllPath(sdkDir, mod))
  return required.filter(file => !exists(file))
}

// Version string for getAddonInfo().sdkVersion: <sdk>/VERSION if present, else 'unknown'.
function readSdkVersion(sdkDir, readFile = fs.readFileSync) {
  try {
    const text = String(readFile(path.join(sdkDir, 'VERSION'), 'utf8')).trim()
    return text || 'unknown'
  } catch {
    return 'unknown'
  }
}

module.exports = { SDK_MODULES, defaultSdkDir, resolveSdkDir, headerPath, libPath, dllPath, missingSdkFiles, readSdkVersion }

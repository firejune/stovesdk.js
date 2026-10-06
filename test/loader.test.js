'use strict'

// Pure-JS tests (no native build needed): addon path resolution and SDK directory resolution.
// Run with `npm test` (node --test).

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const api = require('..')
const sdkDir = require('../lib/sdk-dir')

const root = path.join(__dirname, '..')

test('candidateAddonPaths: env override first, then build/, then prebuilds/', () => {
  const paths = api.candidateAddonPaths({ STOVE_PCSDK_ADDON: '/x/custom.node' }, root)
  assert.deepEqual(paths, [
    path.resolve('/x/custom.node'),
    path.join(root, 'build', 'Release', api.ADDON_FILE),
    path.join(root, 'prebuilds', 'win32-x64', api.ADDON_FILE),
  ])
})

test('candidateAddonPaths: blank env override is ignored', () => {
  const paths = api.candidateAddonPaths({ STOVE_PCSDK_ADDON: '  ' }, root)
  assert.equal(paths.length, 2)
})

test('resolveAddonPath: returns the first existing candidate', () => {
  const prebuilt = path.join(root, 'prebuilds', 'win32-x64', api.ADDON_FILE)
  const found = api.resolveAddonPath({}, root, p => p === prebuilt)
  assert.equal(found, prebuilt)
})

test('resolveAddonPath: throws a coded error listing every candidate when none exists', () => {
  assert.throws(
    () => api.resolveAddonPath({}, root, () => false),
    err => err.code === 'STOVE_PCSDK_ADDON_NOT_FOUND' && err.message.includes(path.join('build', 'Release')) && err.message.includes('prebuilds')
  )
})

test('load: refuses non-Windows platforms with a coded error', { skip: process.platform === 'win32' }, () => {
  assert.throws(() => api.load(), err => err.code === 'STOVE_PCSDK_UNSUPPORTED_PLATFORM')
})

test('ErrorCode values are negative and distinct', () => {
  const values = Object.values(api.ErrorCode)
  assert.ok(values.every(v => Number.isInteger(v) && v < 0))
  assert.equal(new Set(values).size, values.length)
  assert.ok(Object.isFrozen(api.ErrorCode))
})

test('resolveSdkDir: STOVE_PCSDK_DIR wins, default is <repo>/sdk', () => {
  assert.equal(sdkDir.resolveSdkDir({ STOVE_PCSDK_DIR: '/opt/stove' }), path.resolve('/opt/stove'))
  assert.equal(sdkDir.resolveSdkDir({ STOVE_PCSDK_DIR: '' }), path.join(root, 'sdk'))
  assert.equal(sdkDir.resolveSdkDir({}), path.join(root, 'sdk'))
})

test('missingSdkFiles: reports header, lib and dll per module', () => {
  const missing = sdkDir.missingSdkFiles('/s', () => false)
  assert.equal(missing.length, sdkDir.SDK_MODULES.length * 3)
  assert.ok(missing.includes(path.join('/s', 'BaseSDK', 'Deploy', 'Include', 'BaseSDK.h')))
  assert.ok(missing.includes(path.join('/s', 'OwnershipSDK', 'Deploy', 'Lib', 'x64', 'Release', 'OwnershipSDK.lib')))
  assert.ok(missing.includes(path.join('/s', 'GameSupportSDK', 'Deploy', 'Bin', 'x64', 'Release', 'GameSupportSDK.dll')))
  assert.deepEqual(sdkDir.missingSdkFiles('/s', () => true), [])
})

test('readSdkVersion: trims the VERSION file, falls back to "unknown"', () => {
  assert.equal(sdkDir.readSdkVersion('/s', () => '3.4.2\n'), '3.4.2')
  assert.equal(sdkDir.readSdkVersion('/s', () => '   '), 'unknown')
  assert.equal(sdkDir.readSdkVersion('/s', () => { throw new Error('ENOENT') }), 'unknown')
})

test('SDK_DLLS: the three SDK modules, as DLL file names', () => {
  assert.deepEqual([...api.SDK_DLLS], ['BaseSDK.dll', 'OwnershipSDK.dll', 'GameSupportSDK.dll'])
  assert.ok(Object.isFrozen(api.SDK_DLLS))
})

const addon = path.resolve('/app/resources/stovesdk.node')
const exe = path.resolve('/app/game.exe')
const dlopenFailed = () => Object.assign(new Error('The specified module could not be found.'), { code: 'ERR_DLOPEN_FAILED' })

test('missingSdkDlls: empty when every DLL sits next to the addon or next to the executable', () => {
  assert.deepEqual(api.missingSdkDlls(addon, exe, () => true), [])
  const nextToExe = p => path.dirname(p) === path.dirname(exe)
  assert.deepEqual(api.missingSdkDlls(addon, exe, nextToExe), [])
  const split = p => p === path.join(path.dirname(addon), 'BaseSDK.dll') || path.dirname(p) === path.dirname(exe)
  assert.deepEqual(api.missingSdkDlls(addon, exe, split), [])
})

test('missingSdkDlls: names each DLL absent from both directories, in SDK order', () => {
  const onlyBase = p => path.basename(p) === 'BaseSDK.dll'
  assert.deepEqual(api.missingSdkDlls(addon, exe, onlyBase), ['OwnershipSDK.dll', 'GameSupportSDK.dll'])
  assert.deepEqual(api.missingSdkDlls(addon, exe, () => false), [...api.SDK_DLLS])
})

test('explainLoadError: ERR_DLOPEN_FAILED with a DLL missing becomes STOVE_PCSDK_DLL_NOT_FOUND', () => {
  const original = dlopenFailed()
  const onlyBase = p => path.basename(p) === 'BaseSDK.dll'
  const err = api.explainLoadError(original, addon, exe, onlyBase)
  assert.notEqual(err, original)
  assert.equal(err.code, 'STOVE_PCSDK_DLL_NOT_FOUND')
  assert.deepEqual(err.missing, ['OwnershipSDK.dll', 'GameSupportSDK.dll'])
  assert.deepEqual(err.searched, [path.dirname(addon), path.dirname(exe)])
  assert.equal(err.cause, original)
  assert.ok(err.message.includes('OwnershipSDK.dll') && err.message.includes('GameSupportSDK.dll'))
  assert.ok(err.message.includes(path.dirname(addon)) && err.message.includes(path.dirname(exe)))
  assert.ok(err.message.includes('next to the addon'))
})

test('explainLoadError: one directory when the addon sits next to the executable', () => {
  const beside = path.join(path.dirname(exe), api.ADDON_FILE)
  const err = api.explainLoadError(dlopenFailed(), beside, exe, () => false)
  assert.deepEqual(err.searched, [path.dirname(exe)])
  assert.ok(err.message.includes(' was not found') === false && err.message.includes(' were not found'))
})

test('explainLoadError: returns the original error when every DLL is present or the code is another', () => {
  const original = dlopenFailed()
  assert.equal(api.explainLoadError(original, addon, exe, () => true), original)
  const other = Object.assign(new Error('bad'), { code: 'ERR_INVALID_ARG_TYPE' })
  assert.equal(api.explainLoadError(other, addon, exe, () => false), other)
  const plain = new Error('no code')
  assert.equal(api.explainLoadError(plain, addon, exe, () => false), plain)
  assert.equal(api.explainLoadError(undefined, addon, exe, () => false), undefined)
})

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
    err => err.code === 'STOVE_PCSDK_ADDON_NOT_FOUND' && err.message.includes('build/Release') && err.message.includes('prebuilds')
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

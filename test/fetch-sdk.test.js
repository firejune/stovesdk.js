'use strict'

// tools/fetch-sdk.js — the manifest's shape, checksum rejection, and what reaches the destination.
// No network: `download` and `extract` are injected.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { checkManifest, loadManifest, sha256Hex, verifyArchive, fetchSdk, MANIFEST_FILE } = require('../tools/fetch-sdk')
const { SDK_MODULES, headerPath, libPath, dllPath } = require('../lib/sdk-dir')

const bytes = Object.fromEntries(SDK_MODULES.map(m => [m, Buffer.from(`zip of ${m}`)]))
const fakeManifest = () => ({
  version: '9.9.9.9',
  modules: Object.fromEntries(SDK_MODULES.map(m => [m, { url: `https://example.invalid/${m}_9.9.9.9.zip`, sha256: sha256Hex(bytes[m]) }])),
})
const downloadFake = async url => bytes[SDK_MODULES.find(m => url.includes(m))]
// Stands in for unzipping: lays down the header, import library and DLL the layout check expects.
const extractFake = (zipFile, dir) => {
  const mod = path.basename(dir)
  const sdkDir = path.dirname(dir)
  for (const file of [headerPath(sdkDir, mod), libPath(sdkDir, mod), dllPath(sdkDir, mod)]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stovesdk-fetch-'))

test('the committed manifest is usable: pinned version, the three modules, https zip URLs, 64-hex SHA-256', () => {
  const manifest = loadManifest(MANIFEST_FILE)
  assert.deepEqual(checkManifest(manifest), [])
  assert.match(manifest.version, /^\d+\.\d+\.\d+\.\d+$/)
  assert.deepEqual(Object.keys(manifest.modules).sort(), [...SDK_MODULES].sort())
  for (const m of SDK_MODULES) {
    assert.ok(manifest.modules[m].url.startsWith('https://') && manifest.modules[m].url.endsWith(`${m}_${manifest.version}.zip`), `${m} url names the module and version`)
    assert.match(manifest.modules[m].sha256, /^[0-9a-f]{64}$/)
  }
})

test('checkManifest: names what is wrong', () => {
  const m = fakeManifest()
  delete m.modules.OwnershipSDK
  m.modules.BaseSDK.url = 'http://example.invalid/BaseSDK.zip'
  m.modules.GameSupportSDK.sha256 = 'abc'
  m.modules.ViewSDK = { url: 'https://example.invalid/ViewSDK.zip', sha256: 'f'.repeat(64) }
  const problems = checkManifest(m)
  assert.ok(problems.some(p => p.includes('OwnershipSDK is missing')))
  assert.ok(problems.some(p => p.includes('BaseSDK.url')))
  assert.ok(problems.some(p => p.includes('GameSupportSDK.sha256')))
  assert.ok(problems.some(p => p.includes('ViewSDK is not an SDK module')))
  assert.deepEqual(checkManifest(null), ['manifest is not an object'])
})

test('verifyArchive: accepts the pinned hash, rejects anything else with a coded error', () => {
  const buf = bytes.BaseSDK
  assert.equal(verifyArchive(buf, 'BaseSDK', sha256Hex(buf), 'https://example.invalid/a.zip'), sha256Hex(buf))
  assert.throws(
    () => verifyArchive(Buffer.from('tampered'), 'BaseSDK', sha256Hex(buf), 'https://example.invalid/a.zip'),
    err => err.code === 'STOVE_PCSDK_SDK_CHECKSUM_MISMATCH' && err.module === 'BaseSDK' && err.expected === sha256Hex(buf) && err.message.includes('Nothing was extracted')
  )
})

test('fetchSdk: a checksum mismatch stops the fetch — nothing extracted, no VERSION, no archive left behind', async () => {
  const dest = tmp()
  const manifest = fakeManifest()
  manifest.modules.OwnershipSDK.sha256 = '0'.repeat(64)
  const extracted = []
  await assert.rejects(
    fetchSdk(dest, { manifest, download: downloadFake, extract: (zip, dir) => { extracted.push(path.basename(dir)); extractFake(zip, dir) } }),
    err => err.code === 'STOVE_PCSDK_SDK_CHECKSUM_MISMATCH' && err.module === 'OwnershipSDK'
  )
  assert.deepEqual(extracted, ['BaseSDK'], 'modules before the bad one were extracted, the bad one and those after were not')
  assert.equal(fs.existsSync(path.join(dest, 'VERSION')), false)
  assert.equal(fs.existsSync(path.join(dest, '.download')), false)
  assert.equal(fs.existsSync(path.join(dest, 'OwnershipSDK')), false)
})

test('fetchSdk: verified archives are extracted per module, VERSION is written, the layout is validated', async () => {
  const dest = tmp()
  const downloaded = []
  const summary = await fetchSdk(dest, { manifest: fakeManifest(), download: async url => { downloaded.push(url); return downloadFake(url) }, extract: extractFake })
  assert.equal(summary.version, '9.9.9.9')
  assert.deepEqual(summary.modules.map(m => m.module), SDK_MODULES)
  assert.equal(downloaded.length, 3)
  assert.equal(fs.readFileSync(path.join(dest, 'VERSION'), 'utf8'), '9.9.9.9\n')
  assert.ok(fs.existsSync(headerPath(dest, 'GameSupportSDK')))
  assert.equal(fs.existsSync(path.join(dest, '.download')), false)
})

test('fetchSdk: an archive that unpacks to the wrong layout fails the layout check', async () => {
  const dest = tmp()
  await assert.rejects(
    fetchSdk(dest, { manifest: fakeManifest(), download: downloadFake, extract: (zip, dir) => fs.mkdirSync(dir, { recursive: true }) }),
    err => err.code === 'STOVE_PCSDK_SDK_LAYOUT' && err.missing.length === SDK_MODULES.length * 3
  )
})

test('fetchSdk: refuses a destination that is not empty, and an unusable manifest, before downloading', async () => {
  const dest = tmp()
  fs.writeFileSync(path.join(dest, 'VERSION'), '1.0\n')
  let downloads = 0
  const download = async () => { downloads++; return Buffer.alloc(0) }
  await assert.rejects(fetchSdk(dest, { manifest: fakeManifest(), download, extract: extractFake }), err => err.code === 'STOVE_PCSDK_SDK_DEST_NOT_EMPTY')
  const bad = fakeManifest(); bad.version = 'latest'
  await assert.rejects(fetchSdk(tmp(), { manifest: bad, download, extract: extractFake }), err => err.code === 'STOVE_PCSDK_SDK_MANIFEST')
  assert.equal(downloads, 0)
})

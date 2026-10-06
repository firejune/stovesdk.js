'use strict'

// tools/check-tarball.js — what a tarball must and must not carry, in both modes (ci.yml, publish.yml).

const test = require('node:test')
const assert = require('node:assert/strict')

const { checkTarball, packFiles, PREBUILD, SUMS } = require('../tools/check-tarball')

const source = ['package.json', 'index.js', 'index.d.ts', 'README.md', 'LICENSE', 'binding.gyp', 'lib/sdk-dir.js', 'src/stovesdk.cc', 'tools/sdk-dir.js']

test('packFiles: reads the array shape (npm <= 11) and the object shape (npm >= 12)', () => {
  const entry = { name: 'stovesdk.js', version: '0.3.0', files: [{ path: 'index.js', size: 1 }, { path: 'package.json', size: 2 }] }
  const expected = { name: 'stovesdk.js', version: '0.3.0', files: ['index.js', 'package.json'] }
  assert.deepEqual(packFiles([entry]), expected)
  assert.deepEqual(packFiles({ 'stovesdk.js': entry }), expected)
  assert.throws(() => packFiles({}), TypeError)
  assert.throws(() => packFiles([]), TypeError)
  assert.throws(() => packFiles('nope'), TypeError)
})

test('source tarball: clean when it has no binary and nothing from the SDK', () => {
  assert.deepEqual(checkTarball(source), [])
})

test('source tarball: a .node or SDK material is a problem', () => {
  assert.equal(checkTarball([...source, PREBUILD]).length, 1)
  assert.match(checkTarball([...source, 'build/Release/stovesdk.node'])[0], /binary/)
  assert.match(checkTarball([...source, 'sdk/BaseSDK/Deploy/Include/BaseSDK.h'])[0], /SDK/)
  assert.match(checkTarball([...source, 'prebuilds/win32-x64/BaseSDK.dll'])[0], /SDK/)
})

test('publish tarball: needs exactly the prebuild and its checksum file', () => {
  assert.deepEqual(checkTarball([...source, PREBUILD, SUMS], { withPrebuild: true }), [])
  const missing = checkTarball(source, { withPrebuild: true })
  assert.ok(missing.some(p => p.includes(PREBUILD)) && missing.some(p => p.includes(SUMS)))
  const stray = checkTarball([...source, PREBUILD, SUMS, 'build/Release/stovesdk.node'], { withPrebuild: true })
  assert.equal(stray.length, 1)
  assert.match(stray[0], /other than the prebuild/)
})

test('publish tarball: an SDK DLL beside the prebuild is still refused', () => {
  const problems = checkTarball([...source, PREBUILD, SUMS, 'prebuilds/win32-x64/OwnershipSDK.dll'], { withPrebuild: true })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /OwnershipSDK\.dll/)
})

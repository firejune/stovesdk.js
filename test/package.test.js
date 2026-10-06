'use strict'

// Pins the install contract of package.json: installing this package never compiles anything.
// npm turns a root binding.gyp into an implicit `node-gyp rebuild` on install unless the package
// opts out, and that build fails on every machine without the SDK and a C++ toolchain (#8).

const test = require('node:test')
const assert = require('node:assert/strict')

const pkg = require('../package.json')

test('install runs no build: gypfile is false and there is no install/preinstall script', () => {
  assert.equal(pkg.gypfile, false)
  assert.equal(pkg.scripts.install, undefined)
  assert.equal(pkg.scripts.preinstall, undefined)
})

test('no os/cpu: the install succeeds on the platforms a consumer develops on; load() refuses at runtime instead (#15)', () => {
  assert.equal(pkg.os, undefined)
  assert.equal(pkg.cpu, undefined)
})

test('the explicit build and the two places load() looks still ship', () => {
  assert.equal(pkg.scripts.build, 'node-gyp rebuild --release --arch=x64')
  assert.ok(pkg.files.includes('binding.gyp'), 'binding.gyp must ship so `npm run build` works from an install')
  assert.ok(pkg.files.includes('src/'), 'src/ must ship so `npm run build` works from an install')
  assert.ok(pkg.files.includes('prebuilds/'), 'prebuilds/ is where a consumer drops the release binary')
})

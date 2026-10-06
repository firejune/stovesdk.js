#!/usr/bin/env node
'use strict'

// Inspects the file list of `npm pack --dry-run --json` for what must and must not ship.
//
//   node tools/check-tarball.js <pack.json>                  source tree: no binary at all, nothing from the SDK (ci.yml)
//   node tools/check-tarball.js <pack.json> --with-prebuild  publish: exactly prebuilds/win32-x64/stovesdk.node (+ SHA256SUMS), nothing from the SDK (publish.yml)
//
// The SDK is bring-your-own and is never redistributed: no sdk/ path, no .dll/.lib/.pdb/.h.
// The one binary a published tarball may carry is the maintainer-built addon, and only there.

const PREBUILD = 'prebuilds/win32-x64/stovesdk.node'
const SUMS = 'prebuilds/win32-x64/SHA256SUMS'
const SDK_FILE = /^sdk\/|\.(dll|lib|pdb|exe|h|hpp)$/i
const BINARY = /\.node$/i

function checkTarball(files, { withPrebuild = false } = {}) {
  const problems = []
  const sdk = files.filter(p => SDK_FILE.test(p))
  if (sdk.length) problems.push(`would ship SDK material or a binary of the kind: ${sdk.join(', ')}`)
  const binaries = files.filter(p => BINARY.test(p))
  if (withPrebuild) {
    for (const must of [PREBUILD, SUMS, 'index.js', 'index.d.ts', 'package.json']) {
      if (!files.includes(must)) problems.push(`missing from the tarball: ${must}`)
    }
    const stray = binaries.filter(p => p !== PREBUILD)
    if (stray.length) problems.push(`a binary other than the prebuild: ${stray.join(', ')}`)
  } else if (binaries.length) {
    problems.push(`a binary in the source tarball: ${binaries.join(', ')}`)
  }
  return problems
}

module.exports = { checkTarball, PREBUILD, SUMS }

if (require.main === module) {
  const [file, flag] = process.argv.slice(2)
  if (!file) {
    console.error('usage: node tools/check-tarball.js <pack.json> [--with-prebuild]')
    process.exit(2)
  }
  const [pack] = require(require('path').resolve(file))
  const files = pack.files.map(f => f.path)
  const withPrebuild = flag === '--with-prebuild'
  const problems = checkTarball(files, { withPrebuild })
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`)
    process.exit(1)
  }
  console.log(`npm pack: ${files.length} files, ${pack.name}@${pack.version}, ${withPrebuild ? 'prebuild in, ' : 'no binary, '}nothing from the SDK`)
}

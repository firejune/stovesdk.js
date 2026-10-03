#!/usr/bin/env node
'use strict'

// Called by binding.gyp (`<!(node tools/sdk-dir.js)`) to print the SDK directory, after checking
// that the layout lib/sdk-dir.js documents is present. Fails loudly otherwise — node-gyp would
// fail a few seconds later anyway, but with a far less readable error.
//
//   node tools/sdk-dir.js            → prints the resolved SDK directory
//   node tools/sdk-dir.js version    → prints the SDK version string ('unknown' if no VERSION file)
//   node tools/sdk-dir.js check      → exit 0 if the layout is complete, 1 otherwise (prints what is missing)

const { resolveSdkDir, missingSdkFiles, readSdkVersion } = require('../lib/sdk-dir')

const sdkDir = resolveSdkDir()
const mode = process.argv[2] || 'dir'

if (mode === 'version') {
  process.stdout.write(readSdkVersion(sdkDir))
  process.exit(0)
}

const missing = missingSdkFiles(sdkDir)
if (missing.length) {
  process.stderr.write(`[stovesdk] STOVE PC SDK not found at ${sdkDir}\n`)
  process.stderr.write('[stovesdk] Place the SDK under sdk/ or set STOVE_PCSDK_DIR (see sdk/README.md). Missing:\n')
  for (const file of missing) process.stderr.write(`  - ${file}\n`)
  process.exit(1)
}

if (mode === 'check') {
  process.stdout.write(`[stovesdk] SDK layout OK at ${sdkDir} (version ${readSdkVersion(sdkDir)})\n`)
  process.exit(0)
}

// gyp reads this verbatim; forward slashes keep it portable inside the generated project files.
process.stdout.write(sdkDir.replace(/\\/g, '/'))

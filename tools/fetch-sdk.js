#!/usr/bin/env node
'use strict'

// Fetches the pinned STOVE PC SDK drop from the vendor's download CDN into a directory laid out
// the way lib/sdk-dir.js expects, verifying every archive against tools/sdk-manifest.json first.
//
//   node tools/fetch-sdk.js <dest>            fetch, verify, extract into <dest>, validate the layout
//   node tools/fetch-sdk.js <dest> --check    only validate an existing <dest> against the manifest
//
// What this encodes (issue #21):
//   - The SDK version, the archive URLs and their SHA-256 are pinned in the manifest and reviewed
//     like code. Nothing here derives a URL or accepts an unlisted module.
//   - Every archive is hashed before anything is extracted. A mismatch fails the whole fetch: no
//     other version is tried, no hash is rewritten, nothing from that archive touches <dest>.
//   - <dest> must be empty or absent, so two drops never mix; archives are downloaded under it and
//     deleted after extraction, so nothing is cached between runs.
//   - The vendor's zips unpack to `Deploy/…` with no module folder, so each one is extracted into
//     <dest>/<Module>/; that is the layout sdk/README.md documents and binding.gyp reads.
//   - The extracted files are the vendor's. This tool puts them in a build directory and nowhere
//     else — never into the repository, a package or a release.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { SDK_MODULES, missingSdkFiles } = require('../lib/sdk-dir')

const MANIFEST_FILE = path.join(__dirname, 'sdk-manifest.json')

// Problems with a manifest object (empty = usable). Checked before any network access.
function checkManifest(manifest) {
  const problems = []
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object']
  if (typeof manifest.version !== 'string' || !/^\d+(\.\d+)+$/.test(manifest.version)) problems.push('version must be a dotted version string')
  const modules = manifest.modules && typeof manifest.modules === 'object' ? manifest.modules : null
  if (!modules) return [...problems, 'modules must be an object']
  const names = Object.keys(modules)
  for (const mod of SDK_MODULES) if (!names.includes(mod)) problems.push(`modules.${mod} is missing`)
  for (const name of names) {
    if (!SDK_MODULES.includes(name)) problems.push(`modules.${name} is not an SDK module this addon links (${SDK_MODULES.join(', ')})`)
    const entry = modules[name]
    if (!entry || typeof entry !== 'object') { problems.push(`modules.${name} must be an object`); continue }
    if (typeof entry.url !== 'string' || !/^https:\/\/[^\s]+\.zip$/.test(entry.url)) problems.push(`modules.${name}.url must be an https URL to a .zip`)
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) problems.push(`modules.${name}.sha256 must be 64 lowercase hex characters`)
  }
  return problems
}

function loadManifest(file = MANIFEST_FILE) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  const problems = checkManifest(manifest)
  if (problems.length) {
    const err = new Error(`[stovesdk] ${path.basename(file)} is not usable:\n${problems.map(p => `  - ${p}`).join('\n')}`)
    err.code = 'STOVE_PCSDK_SDK_MANIFEST'
    throw err
  }
  return manifest
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Throws (code STOVE_PCSDK_SDK_CHECKSUM_MISMATCH) unless the archive bytes hash to the pinned value.
function verifyArchive(buffer, module, expected, url) {
  const actual = sha256Hex(buffer)
  if (actual === expected) return actual
  const err = new Error(
    `[stovesdk] ${module}: SHA-256 mismatch for ${url}\n  expected ${expected}\n  actual   ${actual}\n` +
      'The archive is not the pinned drop. Nothing was extracted. If the vendor re-published this version, ' +
      'review the change and update tools/sdk-manifest.json in a pull request of its own.'
  )
  err.code = 'STOVE_PCSDK_SDK_CHECKSUM_MISMATCH'
  err.module = module
  err.expected = expected
  err.actual = actual
  throw err
}

async function downloadBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    const err = new Error(`[stovesdk] download failed: HTTP ${res.status} for ${url}`)
    err.code = 'STOVE_PCSDK_SDK_DOWNLOAD'
    throw err
  }
  return Buffer.from(await res.arrayBuffer())
}

// bsdtar reads zip archives. On Windows it is System32\tar.exe (Windows 10 1803+), named in full
// because a Git Bash PATH puts GNU tar — which does not read zip — in front of it. Elsewhere `tar`
// is bsdtar on macOS; on Linux, where GNU tar is the default, `unzip` is tried next.
function extractZip(zipFile, dir) {
  fs.mkdirSync(dir, { recursive: true })
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(tar, ['-xf', zipFile, '-C', dir], { stdio: 'inherit' })
    return
  }
  try {
    execFileSync('tar', ['-xf', zipFile, '-C', dir], { stdio: ['ignore', 'inherit', 'pipe'] })
  } catch (tarErr) {
    try {
      execFileSync('unzip', ['-q', '-o', zipFile, '-d', dir], { stdio: 'inherit' })
    } catch {
      const err = new Error(`[stovesdk] could not extract ${zipFile}: need bsdtar or unzip (tar said: ${String(tarErr.stderr || tarErr.message).trim()})`)
      err.code = 'STOVE_PCSDK_SDK_EXTRACT'
      throw err
    }
  }
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true
  return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0
}

function layoutError(dest, missing) {
  const err = new Error(`[stovesdk] SDK layout incomplete at ${dest}. Missing:\n${missing.map(f => `  - ${f}`).join('\n')}`)
  err.code = 'STOVE_PCSDK_SDK_LAYOUT'
  err.missing = missing
  return err
}

// Fetches, verifies and extracts every module of the manifest into `dest`. Resolves with a summary.
// `download` and `extract` are injectable so the rules above can be tested without the network.
async function fetchSdk(dest, { manifest = loadManifest(), download = downloadBuffer, extract = extractZip, log = () => {} } = {}) {
  const problems = checkManifest(manifest)
  if (problems.length) {
    const err = new Error(`[stovesdk] manifest is not usable:\n${problems.map(p => `  - ${p}`).join('\n')}`)
    err.code = 'STOVE_PCSDK_SDK_MANIFEST'
    throw err
  }
  dest = path.resolve(dest)
  if (!isEmptyDir(dest)) {
    const err = new Error(`[stovesdk] ${dest} exists and is not empty. The fetch only fills an empty directory, so two drops never mix.`)
    err.code = 'STOVE_PCSDK_SDK_DEST_NOT_EMPTY'
    throw err
  }
  fs.mkdirSync(dest, { recursive: true })
  const downloads = path.join(dest, '.download')
  fs.mkdirSync(downloads)
  const modules = []
  try {
    for (const module of SDK_MODULES) {
      const { url, sha256 } = manifest.modules[module]
      log(`[stovesdk] ${module}: downloading ${url}`)
      const buffer = await download(url)
      verifyArchive(buffer, module, sha256, url)
      log(`[stovesdk] ${module}: ${buffer.length} bytes, SHA-256 ${sha256} OK`)
      const zipFile = path.join(downloads, `${module}.zip`)
      fs.writeFileSync(zipFile, buffer)
      extract(zipFile, path.join(dest, module))
      fs.rmSync(zipFile, { force: true })
      modules.push({ module, url, sha256, bytes: buffer.length })
    }
  } finally {
    fs.rmSync(downloads, { recursive: true, force: true })
  }
  fs.writeFileSync(path.join(dest, 'VERSION'), `${manifest.version}\n`)
  const missing = missingSdkFiles(dest)
  if (missing.length) throw layoutError(dest, missing)
  return { dest, version: manifest.version, modules }
}

module.exports = { MANIFEST_FILE, checkManifest, loadManifest, sha256Hex, verifyArchive, fetchSdk }

if (require.main === module) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const dest = args.find(a => !a.startsWith('--'))
  if (!dest) {
    console.error('usage: node tools/fetch-sdk.js <dest> [--check]')
    process.exit(2)
  }
  if (check) {
    const manifest = loadManifest()
    const missing = missingSdkFiles(path.resolve(dest))
    if (missing.length) { console.error(layoutError(path.resolve(dest), missing).message); process.exit(1) }
    const version = fs.existsSync(path.join(dest, 'VERSION')) ? fs.readFileSync(path.join(dest, 'VERSION'), 'utf8').trim() : 'unknown'
    if (version !== manifest.version) { console.error(`[stovesdk] ${dest} holds SDK ${version}, the manifest pins ${manifest.version}`); process.exit(1) }
    console.log(`[stovesdk] SDK ${version} complete at ${path.resolve(dest)}`)
    process.exit(0)
  }
  fetchSdk(dest, { log: console.log })
    .then(summary => {
      console.log(`[stovesdk] SDK ${summary.version} ready at ${summary.dest} (${summary.modules.length} modules, ${summary.modules.reduce((n, m) => n + m.bytes, 0)} bytes downloaded, archives removed)`)
    })
    .catch(err => {
      console.error(err && err.message ? err.message : err)
      process.exit(1)
    })
}

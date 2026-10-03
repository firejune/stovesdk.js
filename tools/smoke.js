#!/usr/bin/env node
'use strict'

// Load-only smoke for a freshly built addon (Windows). Proves, without a STOVE client:
//   1. the .node loads (its DLL imports resolve — the SDK DLLs must sit next to it or next to node.exe),
//   2. the export surface matches index.d.ts,
//   3. the pure-addon paths behave: refusals before initialize(), argument validation, no-op pump,
//      no-op uninitialize().
// Nothing initializes the SDK — that needs a STOVE client session on the machine.
//
//   node tools/smoke.js [path/to/stovesdk.node]

const path = require('path')
const { load } = require('..')

const EXPECTED_EXPORTS = [
  'getAddonInfo', 'getVersion', 'initialize', 'runCallbacks', 'isInitialized', 'uninitialize',
  'getOwnershipList', 'getUser', 'getGds', 'getAchievement', 'getAllAchievements', 'getStat', 'setStat',
]

function fail(message) {
  console.error(`[smoke] ${message}`)
  process.exit(1)
}

const sdk = load(process.argv[2] ? path.resolve(process.argv[2]) : undefined)

const missing = EXPECTED_EXPORTS.filter(name => typeof sdk[name] !== 'function')
if (missing.length) fail(`missing exports: ${missing.join(', ')}`)
if (!sdk.constants || !sdk.constants.OwnershipCode || !sdk.constants.OwnershipGameCode || !sdk.constants.ErrorCode) {
  fail('constants are missing')
}

const info = sdk.getAddonInfo()
console.log('[smoke] addon info:', JSON.stringify(info))
console.log('[smoke] constants:', JSON.stringify(sdk.constants))

if (sdk.isInitialized() !== false) fail('expected isInitialized() === false on a fresh load')

// Informational — exercises a real call into BaseSDK.dll.
console.log('[smoke] Base_GetVersion:', JSON.stringify(sdk.getVersion()))

// Synchronous identity reads must answer, not throw, before initialize().
for (const name of ['getUser', 'getGds']) {
  const answer = sdk[name]()
  console.log(`[smoke] ${name}() before init:`, JSON.stringify(answer))
  if (!answer || answer.ok !== false || answer.code !== sdk.constants.ErrorCode.NOT_INITIALIZED) {
    fail(`${name}() before init must report { ok: false, code: ErrorCode.NOT_INITIALIZED }`)
  }
}

// runCallbacks() must be a no-op when nothing is in flight.
sdk.runCallbacks()

// uninitialize() on a fresh addon must be a harmless no-op with all three slots null.
const down = sdk.uninitialize()
console.log('[smoke] uninitialize() on fresh addon:', JSON.stringify(down))
if (down.base !== null || down.ownership !== null || down.gameSupport !== null) {
  fail('uninitialize() reported an UnInitialize on a never-initialized SDK')
}

// Argument validation is synchronous (TypeError / RangeError), never a crash and never an SDK call.
function expectThrow(label, fn, ctor) {
  try {
    fn()
  } catch (err) {
    if (err instanceof ctor) {
      console.log(`[smoke] ${label} threw ${ctor.name} as expected:`, err.message)
      return
    }
    fail(`${label} threw the wrong error type: ${err}`)
  }
  fail(`${label} did not throw`)
}
expectThrow('initialize() without options', () => sdk.initialize(), TypeError)
expectThrow('setStat("x") without a value', () => sdk.setStat('x'), TypeError)
expectThrow('setStat("x", 1.5)', () => sdk.setStat('x', 1.5), RangeError)
expectThrow('getAchievement(42)', () => sdk.getAchievement(42), TypeError)
expectThrow('getStat(null)', () => sdk.getStat(null), TypeError)

// Before initialize() every asynchronous entry point must reject through its Promise —
// never crash the process, never reach the SDK.
function expectReject(label, promise, step) {
  return promise.then(
    () => fail(`${label} resolved without the SDK initialized`),
    err => {
      if (!err || err.step !== step || err.code !== sdk.constants.ErrorCode.NOT_INITIALIZED) {
        fail(`${label} rejected with an unexpected shape: step=${err && err.step} code=${err && err.code}`)
      }
      console.log(`[smoke] ${label} rejected as expected:`, err.message)
    }
  )
}

expectReject('getOwnershipList()', sdk.getOwnershipList(), 'ownershipList')
  .then(() => expectReject('setStat("x", 1)', sdk.setStat('x', 1), 'modifyStat'))
  .then(() => expectReject('getStat("x")', sdk.getStat('x'), 'stat'))
  .then(() => expectReject('getAchievement("x")', sdk.getAchievement('x'), 'achievement'))
  .then(() => expectReject('getAllAchievements()', sdk.getAllAchievements(), 'allAchievements'))
  .then(() => {
    console.log('[smoke] OK')
  })

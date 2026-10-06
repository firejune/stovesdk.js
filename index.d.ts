// Type definitions for stovesdk.js — unofficial Node.js / Electron bindings for the STOVE PC SDK.

/** Result of a synchronous SDK call. */
export interface SdkResult {
  /** `true` when the SDK reported success. */
  ok: boolean
  /** Which SDK module answered (e.g. "BaseSDK"). Empty when the addon refused the call itself. */
  sdk: string
  /** SDK method code. */
  method: number
  /** SDK result code (unsigned), or a negative {@link ErrorCode} when the addon refused the call. */
  code: number
}

/** Result delivered through an SDK callback — carries the SDK's own message as well. */
export interface SdkCallbackResult extends SdkResult {
  message: string
  externalError: number
}

/** A synchronous read the addon did not forward to the SDK (it is not initialized yet). */
export interface NotAskedResult extends SdkResult {
  ok: false
  reason: string
}

/**
 * Error shape for every rejected Promise. `code` is the SDK result code, or one of
 * {@link ErrorCode} (negative) when the addon itself refused the call.
 */
export interface SdkError extends Error {
  /** Which step failed: "restartAppIfNecessary" | "initialize" | "ownershipInitialize" | "ownershipList" | "gameSupportInitialize" | "achievement" | "allAchievements" | "stat" | "modifyStat" | "uninitialize". */
  step: string
  sdk: string
  method: number
  code: number
  externalError: number
}

/** Addon-level error codes (negative so they never collide with SDK result codes). */
export declare const ErrorCode: Readonly<{
  /** `initialize()` has not succeeded (or `uninitialize()` has run). */
  NOT_INITIALIZED: -1
  /** `initialize()` was called while the SDK is already initialized. */
  ALREADY_INITIALIZED: -2
  /** The same kind of call is already in flight. */
  IN_PROGRESS: -3
  /** A pending Promise was discarded by `uninitialize()`. */
  ABORTED: -4
}>

export interface InitializeOptions {
  /** STOVE environment string as given by STOVE Studio for your title (e.g. "LIVE"). */
  environment: string
  /** Game ID issued by STOVE Studio. */
  gameId: string
  /** Application Key issued by STOVE Studio. Never the Application Secret. */
  applicationKey: string
  /** How long the SDK may wait for the STOVE client when checking whether a relaunch is needed. Default 60000. */
  restartWaitMs?: number
}

export type InitializeResult =
  /** The SDK is initialized; start pumping `runCallbacks()` for as long as it stays up. */
  | { status: 'ok'; result: SdkCallbackResult }
  /**
   * The SDK could not attach to a running STOVE client and has asked the client to relaunch the
   * application. The SDK is NOT initialized. The vendor guide expects the application to exit now.
   */
  | { status: 'restart' }

export interface Ownership {
  gameId: string
  /** One of {@link constants.OwnershipGameCode}. */
  gameCode: number
  /** One of {@link constants.OwnershipCode}. */
  ownershipCode: number
  /** 64-bit timestamp as a decimal string. */
  purchaseDate: string
  /** 64-bit member number as a decimal string. */
  memberNumber: string
}

export interface UserInfo extends SdkResult {
  memberNumber: string
  gameUserId: string
  nickname: string
}

export interface GdsInfo extends SdkResult {
  /** Country code of the login. */
  nation: string
  /** `true` when the country could not be determined and `nation` is STOVE's default instead. */
  isDefault: boolean
  language: string
}

export interface AchievementCondition {
  valueOperation: string
  type: string
  goalValue: number
}

export interface Achievement {
  achievementId: string
  name: string
  description: string
  /** Status string as reported by the SDK (e.g. "ONGOING", "ACHIEVED"). */
  status: string
  value: number
  defaultImageUrl: string
  achievedImageUrl: string
  condition: AchievementCondition | null
  result: SdkCallbackResult
}

export interface Stat {
  statId: string
  gameId: string
  memberNumber: string
  /** 64-bit timestamp as a decimal string. */
  updatedAt: string
  currentValue: number
  result: SdkCallbackResult
}

export interface ModifyStatResult {
  statId: string
  /** The value that was sent. */
  value: number
  /** The stat's value after the SDK applied the change. */
  currentValue: number
  updated: boolean
  errorMessage: string
  result: SdkCallbackResult
}

export interface UninitializeResult {
  gameSupport: SdkResult | null
  ownership: SdkResult | null
  base: SdkResult | null
}

export interface AddonInfo {
  /** Contents of `<sdk>/VERSION` at build time, or "unknown". */
  sdkVersion: string
  napiVersion: number
  arch: 'x64'
  platform: 'win32'
  /** Suggested `runCallbacks()` interval (vendor guide). */
  pumpIntervalMs: number
}

export interface Constants {
  OwnershipCode: Readonly<{ NONE: number; ACQUIRE: number; LOSE: number }>
  OwnershipGameCode: Readonly<{ NONE: number; BASIC: number; DEMO: number; DLC: number }>
  ErrorCode: typeof ErrorCode
}

/** The native addon surface. */
export interface StovePcSdk {
  getAddonInfo(): AddonInfo
  /** Base_GetVersion. Synchronous, informational; may report `ok: false` before initialization. */
  getVersion(): SdkResult & { version: string }

  /**
   * Base_RestartAppIfNecessaryAsync followed by Base_Initialize. Settles from a later
   * `runCallbacks()` call, so start the pump before awaiting this.
   */
  initialize(options: InitializeOptions): Promise<InitializeResult>
  /** Base_RunCallback plus Promise settlement. Call periodically (see `getAddonInfo().pumpIntervalMs`) on the thread that called `initialize()`. */
  runCallbacks(): void
  isInitialized(): boolean
  /** Uninitializes every module that was initialized (GameSupport, Ownership, then Base). Rejects pending Promises with `ErrorCode.ABORTED`. Safe to call twice. */
  uninitialize(): UninitializeResult

  /** Ownership_OwnershipList (Ownership_Initialize is called lazily). Returns the raw list; interpret it with `constants`. */
  getOwnershipList(): Promise<Ownership[]>

  /** Base_GetUser. Synchronous; answers `{ ok: false, code: ErrorCode.NOT_INITIALIZED }` before initialization instead of throwing. */
  getUser(): UserInfo | NotAskedResult
  /** Base_GetGds. Synchronous; same refusal shape as `getUser()`. */
  getGds(): GdsInfo | NotAskedResult

  /** GameSupport_Achievement — a query. Achievements are completed by modifying their stat (`setStat`). */
  getAchievement(achievementId: string): Promise<Achievement>
  /** GameSupport_AllAchievement. */
  getAllAchievements(): Promise<Achievement[]>
  /** GameSupport_Stat. */
  getStat(statId: string): Promise<Stat>
  /** GameSupport_ModifyStat. `value` must be an int32 (throws RangeError otherwise). */
  setStat(statId: string, value: number): Promise<ModifyStatResult>

  readonly constants: Constants
}

/** File name of the compiled addon. */
export declare const ADDON_FILE: 'stovesdk.node'

/** The SDK DLLs the addon imports: `BaseSDK.dll`, `OwnershipSDK.dll`, `GameSupportSDK.dll`. They ship with the SDK, not with this package. */
export declare const SDK_DLLS: readonly string[]

/** Paths `load()` tries, in order. */
export declare function candidateAddonPaths(env?: NodeJS.ProcessEnv, baseDir?: string): string[]

/** First existing candidate path; throws (code `STOVE_PCSDK_ADDON_NOT_FOUND`) when none exists. */
export declare function resolveAddonPath(env?: NodeJS.ProcessEnv, baseDir?: string, exists?: (p: string) => boolean): string

/**
 * Error `load()` throws when the addon file exists but cannot be loaded because one or more of
 * {@link SDK_DLLS} is next to neither the addon nor the host executable.
 */
export interface DllNotFoundError extends Error {
  code: 'STOVE_PCSDK_DLL_NOT_FOUND'
  /** The DLL file names that were not found. */
  missing: string[]
  /** The directories that were checked: the addon's and the host executable's. */
  searched: string[]
  /** Node's own `ERR_DLOPEN_FAILED` error. */
  cause: Error
}

/**
 * Which of {@link SDK_DLLS} are found neither in the directory of `addonPath` nor in that of
 * `execPath` (default `process.execPath`). Empty when all three are present.
 */
export declare function missingSdkDlls(addonPath: string, execPath?: string, exists?: (p: string) => boolean): string[]

/**
 * The error `load()` throws when `require(addonPath)` threw `err`: a {@link DllNotFoundError}
 * when `err` is `ERR_DLOPEN_FAILED` and an SDK DLL is missing, otherwise `err` itself.
 */
export declare function explainLoadError(err: unknown, addonPath: string, execPath?: string, exists?: (p: string) => boolean): unknown

/**
 * Loads the native addon (cached after the first call). Throws with code
 * `STOVE_PCSDK_UNSUPPORTED_PLATFORM` off Windows, `STOVE_PCSDK_ADDON_NOT_FOUND` when no build
 * exists, and `STOVE_PCSDK_DLL_NOT_FOUND` ({@link DllNotFoundError}) when the addon is there but
 * an SDK DLL is not. Any other load failure is rethrown as Node reported it.
 */
export declare function load(addonPath?: string): StovePcSdk

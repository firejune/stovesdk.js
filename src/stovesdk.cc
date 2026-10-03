// stovesdk.js — Node-API bridge to the STOVE PC SDK (Windows x64).
//
// Scope: a thin, policy-free wrapper. Every exported function maps onto one SDK entry point (or
// the fixed Base init chain) and reports what the SDK answered. What a host application does
// with a failed ownership check, a restart request or an SDK error is entirely up to the caller.
//
// Call model
//   The SDK delivers every asynchronous result through Base_RunCallback(), which the host must
//   call periodically on the same thread that initialized the SDK (the vendor guide suggests
//   ~16 ms). `runCallbacks()` is that pump; every asynchronous export returns a Promise that is
//   settled from inside a later `runCallbacks()` call. Synchronous SDK calls (GetUser, GetGds,
//   GetVersion, the UnInitialize family) return plain objects immediately.
//
// Threading model — why nothing touches N-API inside an SDK callback
//   The SDK callbacks are plain C function pointers without a user-data slot, and the vendor
//   documentation does not state which thread they fire on. So the callbacks only copy the
//   result into a plain C++ queue under a mutex. `runCallbacks()` calls Base_RunCallback() and
//   then drains that queue on the JS thread, where it is safe to advance the init chain, call
//   the next SDK function and settle Promises. No SDK object outlives its callback.
//
// Strings
//   The SDK speaks wchar_t (UTF-16 on Windows). JS strings cross as UTF-16 via Utf16Value();
//   SDK strings come back through WideCharToMultiByte(CP_UTF8). 64-bit integers (member
//   numbers, timestamps) cross as decimal strings so no precision is lost above 2^53.
//
// Credentials
//   Environment, Game ID and Application Key are runtime arguments of initialize(); nothing is
//   compiled in. The Application Secret is not an input of any client-side SDK call and must
//   never ship in a client build.
//
// SDK headers are included from the user-supplied SDK (see binding.gyp); none are vendored here.

// STOVE_PCSDK_SYNTAX_CHECK lets a non-Windows compiler run `-fsyntax-only` over this file with a
// stub <windows.h> (see tools/syntax-check.sh). It is never defined in a real build.
#if !defined(_WIN32) && !defined(STOVE_PCSDK_SYNTAX_CHECK)
#error "stovesdk.js is Windows-only; binding.gyp skips this target on other platforms."
#endif

#include <windows.h>

// Legacy SAL annotation used by the SDK headers (`__out wchar_t*`). The Windows headers normally
// define it; keep a no-op fallback so the file parses when an SDK header is reached first.
#ifndef __out
#define __out
#endif

#include <napi.h>

#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "BaseSDK.h"
#include "OwnershipSDK.h"
#include "GameSupportSDK.h"

#ifndef STOVE_PCSDK_SDK_VERSION
#define STOVE_PCSDK_SDK_VERSION "unknown"
#endif

namespace {

namespace Base = Stove::PCSDK::Base;
namespace Ownership = Stove::PCSDK::Ownership;
namespace GameSupport = Stove::PCSDK::GameSupport;

// Addon-level error codes (negative, so they never collide with SDK result codes, which are
// unsigned). Mirrored in index.d.ts / index.js as `ErrorCode`.
constexpr int32_t kErrNotInitialized = -1;
constexpr int32_t kErrAlreadyInitialized = -2;
constexpr int32_t kErrInProgress = -3;
constexpr int32_t kErrAborted = -4;

// ── String conversion ──────────────────────────────────────────────────────────────────

std::string WideToUtf8(const wchar_t* wide) {
  if (wide == nullptr || *wide == L'\0') return std::string();
  const int needed = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (needed <= 1) return std::string();
  std::string out(static_cast<size_t>(needed - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, &out[0], needed, nullptr, nullptr);
  return out;
}

// JS → wchar_t. On MSVC wchar_t is 16-bit, so UTF-16 code units map 1:1.
std::wstring JsToWide(const Napi::Value& value) {
  const std::u16string u16 = value.As<Napi::String>().Utf16Value();
  static_assert(sizeof(wchar_t) == sizeof(char16_t), "wchar_t must be 16-bit for this bridge");
  return std::wstring(u16.begin(), u16.end());
}

// ── SDK result snapshots (plain C++, safe to keep after the callback returns) ───────────

struct ResultSnapshot {
  bool ok = false;
  std::string sdkName;
  uint32_t methodCode = 0;
  uint32_t resultCode = 0;
  // CallbackResult-only fields
  std::string errorMessage;
  int32_t externalError = 0;

  static ResultSnapshot From(const Stove::PCSDK::Result& r) {
    ResultSnapshot s;
    s.ok = r.IsSuccessful();
    s.sdkName = WideToUtf8(r.GetSDKName());
    s.methodCode = r.GetMethodCode();
    s.resultCode = r.GetResultCode();
    return s;
  }

  static ResultSnapshot From(const Stove::PCSDK::CallbackResult& cr) {
    ResultSnapshot s = From(cr.GetResult());
    s.errorMessage = WideToUtf8(cr.GetErrorMessage());
    s.externalError = cr.GetExternalError();
    return s;
  }
};

struct OwnershipSnapshot {
  std::string gameId;
  uint32_t gameCode = 0;       // Ownership::OwnershipGameCode
  uint32_t ownershipCode = 0;  // Ownership::OwnershipCode
  uint64_t purchaseDate = 0;
  uint64_t memberNumber = 0;
};

struct AchievementSnapshot {
  std::string achievementId;
  std::string name;
  std::string description;
  std::string status;
  std::string defaultImageUrl;
  std::string achievedImageUrl;
  int32_t value = 0;
  // Condition (may be absent on error results)
  bool hasCondition = false;
  std::string conditionValueOperation;
  std::string conditionType;
  int32_t conditionGoalValue = 0;
};

AchievementSnapshot SnapshotAchievement(const GameSupport::StovePCAchievement& a) {
  AchievementSnapshot s;
  s.achievementId = WideToUtf8(a.GetAchievementId());
  s.name = WideToUtf8(a.GetName());
  s.description = WideToUtf8(a.GetDescription());
  s.status = WideToUtf8(a.GetStatus());
  s.defaultImageUrl = WideToUtf8(a.GetDefaultImageUrl());
  s.achievedImageUrl = WideToUtf8(a.GetAchievedImageUrl());
  s.value = a.GetValue();
  const GameSupport::StovePCAchievementCondition* cond = a.GetCondition();
  if (cond != nullptr) {
    s.hasCondition = true;
    s.conditionValueOperation = WideToUtf8(cond->GetValueOperation());
    s.conditionType = WideToUtf8(cond->GetType());
    s.conditionGoalValue = cond->GetGoalValue();
  }
  return s;
}

// GameSupport_Stat result.
struct StatSnapshot {
  std::string gameId;
  std::string statId;
  uint64_t memberNumber = 0;
  uint64_t updatedAt = 0;
  int32_t currentValue = 0;
};

// GameSupport_ModifyStat result. The SDK struct does not echo the stat id back.
struct ModifyStatSnapshot {
  int32_t currentValue = 0;
  bool updated = false;
  std::string errorMessage;
};

// ── Event queue (SDK callback → JS thread) ─────────────────────────────────────────────

enum class EventKind { RestartCheck, BaseInit, OwnershipList, Achievement, AllAchievements, Stat, ModifyStat };

struct Event {
  EventKind kind = EventKind::RestartCheck;
  ResultSnapshot result;
  bool restartRequired = false;                   // RestartCheck
  std::vector<OwnershipSnapshot> ownerships;      // OwnershipList
  AchievementSnapshot achievement;                // Achievement
  std::vector<AchievementSnapshot> achievements;  // AllAchievements
  StatSnapshot stat;                              // Stat
  ModifyStatSnapshot modifyStat;                  // ModifyStat
};

std::mutex g_queueMutex;
std::deque<Event> g_queue;

void PushEvent(Event&& e) {
  std::lock_guard<std::mutex> lock(g_queueMutex);
  g_queue.push_back(std::move(e));
}

Event MakeEvent(EventKind kind, ResultSnapshot result) {
  Event e;
  e.kind = kind;
  e.result = std::move(result);
  return e;
}

// ── SDK callbacks — copy only, no N-API, no SDK calls ─────────────────────────────────

void __cdecl OnRestartAppIfNecessary(Stove::PCSDK::CallbackResult cr, bool restartRequired) {
  Event e = MakeEvent(EventKind::RestartCheck, ResultSnapshot::From(cr));
  e.restartRequired = restartRequired;
  PushEvent(std::move(e));
}

void __cdecl OnBaseInitialize(Stove::PCSDK::CallbackResult cr) {
  PushEvent(MakeEvent(EventKind::BaseInit, ResultSnapshot::From(cr)));
}

void __cdecl OnOwnershipList(Stove::PCSDK::CallbackResult cr, Ownership::StovePCOwnership* list, uint32_t size) {
  Event e = MakeEvent(EventKind::OwnershipList, ResultSnapshot::From(cr));
  if (list != nullptr) {
    e.ownerships.reserve(size);
    for (uint32_t i = 0; i < size; ++i) {
      OwnershipSnapshot o;
      o.gameId = WideToUtf8(list[i].GetGameId());
      o.gameCode = static_cast<uint32_t>(list[i].GetGameCode());
      o.ownershipCode = static_cast<uint32_t>(list[i].GetOwnershipCode());
      o.purchaseDate = list[i].GetPurchaseDate();
      o.memberNumber = list[i].GetMemberNumber();
      e.ownerships.push_back(std::move(o));
    }
  }
  PushEvent(std::move(e));
}

void __cdecl OnAchievement(Stove::PCSDK::CallbackResult cr, GameSupport::StovePCAchievement achievement) {
  Event e = MakeEvent(EventKind::Achievement, ResultSnapshot::From(cr));
  e.achievement = SnapshotAchievement(achievement);
  PushEvent(std::move(e));
}

void __cdecl OnAllAchievements(Stove::PCSDK::CallbackResult cr, GameSupport::StovePCAchievement* list, uint32_t size) {
  Event e = MakeEvent(EventKind::AllAchievements, ResultSnapshot::From(cr));
  if (list != nullptr) {
    e.achievements.reserve(size);
    for (uint32_t i = 0; i < size; ++i) e.achievements.push_back(SnapshotAchievement(list[i]));
  }
  PushEvent(std::move(e));
}

void __cdecl OnStat(Stove::PCSDK::CallbackResult cr, GameSupport::StovePCStat stat) {
  Event e = MakeEvent(EventKind::Stat, ResultSnapshot::From(cr));
  const GameSupport::StovePCStatFullId* fullId = stat.GetStatFullId();
  if (fullId != nullptr) {
    e.stat.gameId = WideToUtf8(fullId->GetGameId());
    e.stat.statId = WideToUtf8(fullId->GetStatId());
  }
  e.stat.memberNumber = stat.GetMemberNumber();
  e.stat.updatedAt = stat.GetUpdatedAt();
  e.stat.currentValue = stat.GetCurrentValue();
  PushEvent(std::move(e));
}

void __cdecl OnModifyStat(Stove::PCSDK::CallbackResult cr, GameSupport::StovePCModifyStatValue statValue) {
  Event e = MakeEvent(EventKind::ModifyStat, ResultSnapshot::From(cr));
  e.modifyStat.currentValue = statValue.GetCurrentValue();
  e.modifyStat.updated = statValue.IsUpdated();
  e.modifyStat.errorMessage = WideToUtf8(statValue.GetErrorMessage());
  PushEvent(std::move(e));
}

// ── Addon state (single instance; the SDK itself is process-global) ────────────────────

enum class InitStage { Idle, RestartCheck, BaseInit, Done };

struct InitSession {
  InitStage stage = InitStage::Idle;
  std::wstring environment;
  std::wstring gameId;
  std::wstring applicationKey;
  std::optional<Napi::Promise::Deferred> deferred;
};

struct PendingAchievement {
  std::string achievementId;
  Napi::Promise::Deferred deferred;
};

struct PendingStat {
  std::string statId;
  int32_t value = 0;  // ModifyStat only
  Napi::Promise::Deferred deferred;
};

InitSession g_init;
std::optional<Napi::Promise::Deferred> g_pendingOwnershipList;
std::deque<PendingAchievement> g_pendingAchievements;
std::deque<Napi::Promise::Deferred> g_pendingAllAchievements;
// FIFO: the SDK answers calls in order. StovePCModifyStatValue carries no stat id at all, and a
// failed StovePCStat may come back empty, so matching by id is not an option for these two.
std::deque<PendingStat> g_pendingStats;
std::deque<PendingStat> g_pendingModifyStats;
bool g_baseInitialized = false;
bool g_ownershipInitialized = false;
bool g_gameSupportInitialized = false;

bool Pumping() {
  return g_baseInitialized || (g_init.stage != InitStage::Idle && g_init.stage != InitStage::Done);
}

// ── JS value builders ──────────────────────────────────────────────────────────────────

Napi::Object ResultToObject(Napi::Env env, const ResultSnapshot& r, bool isCallback) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, r.ok));
  o.Set("sdk", Napi::String::New(env, r.sdkName));
  o.Set("method", Napi::Number::New(env, static_cast<double>(r.methodCode)));
  o.Set("code", Napi::Number::New(env, static_cast<double>(r.resultCode)));
  if (isCallback) {
    o.Set("message", Napi::String::New(env, r.errorMessage));
    o.Set("externalError", Napi::Number::New(env, static_cast<double>(r.externalError)));
  }
  return o;
}

// Error shape: Error & { step, sdk, method, code, externalError }.
Napi::Error MakeSdkError(Napi::Env env, const char* step, const ResultSnapshot& r) {
  std::string message = std::string("[stovesdk] ") + step + " failed";
  if (!r.sdkName.empty()) {
    message += " (" + r.sdkName + " method " + std::to_string(r.methodCode) + " code " + std::to_string(r.resultCode) + ")";
  }
  if (!r.errorMessage.empty()) message += ": " + r.errorMessage;
  Napi::Error err = Napi::Error::New(env, message);
  err.Set("step", Napi::String::New(env, step));
  err.Set("sdk", Napi::String::New(env, r.sdkName));
  err.Set("method", Napi::Number::New(env, static_cast<double>(r.methodCode)));
  err.Set("code", Napi::Number::New(env, static_cast<double>(r.resultCode)));
  err.Set("externalError", Napi::Number::New(env, static_cast<double>(r.externalError)));
  return err;
}

// Addon-level error (no SDK call was made): Error & { step, sdk: '', method: 0, code < 0 }.
Napi::Error MakeStateError(Napi::Env env, const char* step, int32_t code, const char* what) {
  Napi::Error err = Napi::Error::New(env, std::string("[stovesdk] ") + step + ": " + what);
  err.Set("step", Napi::String::New(env, step));
  err.Set("sdk", Napi::String::New(env, ""));
  err.Set("method", Napi::Number::New(env, 0));
  err.Set("code", Napi::Number::New(env, static_cast<double>(code)));
  err.Set("externalError", Napi::Number::New(env, 0));
  return err;
}

Napi::Object OwnershipToObject(Napi::Env env, const OwnershipSnapshot& o) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("gameId", Napi::String::New(env, o.gameId));
  obj.Set("gameCode", Napi::Number::New(env, static_cast<double>(o.gameCode)));
  obj.Set("ownershipCode", Napi::Number::New(env, static_cast<double>(o.ownershipCode)));
  obj.Set("purchaseDate", Napi::String::New(env, std::to_string(o.purchaseDate)));
  obj.Set("memberNumber", Napi::String::New(env, std::to_string(o.memberNumber)));
  return obj;
}

Napi::Object AchievementToObject(Napi::Env env, const AchievementSnapshot& a) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("achievementId", Napi::String::New(env, a.achievementId));
  obj.Set("name", Napi::String::New(env, a.name));
  obj.Set("description", Napi::String::New(env, a.description));
  obj.Set("status", Napi::String::New(env, a.status));
  obj.Set("value", Napi::Number::New(env, static_cast<double>(a.value)));
  obj.Set("defaultImageUrl", Napi::String::New(env, a.defaultImageUrl));
  obj.Set("achievedImageUrl", Napi::String::New(env, a.achievedImageUrl));
  if (a.hasCondition) {
    Napi::Object cond = Napi::Object::New(env);
    cond.Set("valueOperation", Napi::String::New(env, a.conditionValueOperation));
    cond.Set("type", Napi::String::New(env, a.conditionType));
    cond.Set("goalValue", Napi::Number::New(env, static_cast<double>(a.conditionGoalValue)));
    obj.Set("condition", cond);
  } else {
    obj.Set("condition", env.Null());
  }
  return obj;
}

// ── Event handlers (JS thread only) ────────────────────────────────────────────────────

void FailInit(Napi::Env env, const char* step, const ResultSnapshot& r) {
  g_init.stage = InitStage::Done;
  if (g_init.deferred) {
    g_init.deferred->Reject(MakeSdkError(env, step, r).Value());
    g_init.deferred.reset();
  }
}

void HandleRestartCheck(Napi::Env env, const Event& e) {
  if (g_init.stage != InitStage::RestartCheck) return;  // stale event (e.g. after uninitialize)
  if (!e.result.ok) {
    FailInit(env, "restartAppIfNecessary", e.result);
    return;
  }
  if (e.restartRequired) {
    // The SDK could not attach to a running STOVE client and has asked the client to relaunch
    // the application. The vendor guide says the application should exit now; the caller decides.
    g_init.stage = InitStage::Done;
    if (g_init.deferred) {
      Napi::Object out = Napi::Object::New(env);
      out.Set("status", Napi::String::New(env, "restart"));
      g_init.deferred->Resolve(out);
      g_init.deferred.reset();
    }
    return;
  }

  Base::StovePCInitializeParam param;
  param.SetEnvironment(g_init.environment.c_str());
  param.SetGameID(g_init.gameId.c_str());
  param.SetApplicationKey(g_init.applicationKey.c_str());
  g_init.stage = InitStage::BaseInit;
  Base::Base_Initialize(&param, OnBaseInitialize);
}

void HandleBaseInit(Napi::Env env, const Event& e) {
  if (g_init.stage != InitStage::BaseInit) return;
  if (!e.result.ok) {
    FailInit(env, "initialize", e.result);
    return;
  }
  g_baseInitialized = true;
  g_init.stage = InitStage::Done;
  if (g_init.deferred) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("status", Napi::String::New(env, "ok"));
    out.Set("result", ResultToObject(env, e.result, true));
    g_init.deferred->Resolve(out);
    g_init.deferred.reset();
  }
}

void HandleOwnershipList(Napi::Env env, const Event& e) {
  if (!g_pendingOwnershipList) return;  // nobody waiting (e.g. after uninitialize)
  Napi::Promise::Deferred deferred = *g_pendingOwnershipList;
  g_pendingOwnershipList.reset();

  if (!e.result.ok) {
    deferred.Reject(MakeSdkError(env, "ownershipList", e.result).Value());
    return;
  }
  Napi::Array list = Napi::Array::New(env, e.ownerships.size());
  uint32_t i = 0;
  for (const OwnershipSnapshot& o : e.ownerships) list.Set(i++, OwnershipToObject(env, o));
  deferred.Resolve(list);
}

void HandleAchievement(Napi::Env env, const Event& e) {
  if (g_pendingAchievements.empty()) return;

  // Match by id when the SDK echoed one back; otherwise settle the oldest request (the SDK
  // processes calls in order, and an error result may carry an empty achievement).
  auto it = g_pendingAchievements.begin();
  if (!e.achievement.achievementId.empty()) {
    for (auto cur = g_pendingAchievements.begin(); cur != g_pendingAchievements.end(); ++cur) {
      if (cur->achievementId == e.achievement.achievementId) {
        it = cur;
        break;
      }
    }
  }
  PendingAchievement pending = std::move(*it);
  g_pendingAchievements.erase(it);

  if (!e.result.ok) {
    pending.deferred.Reject(MakeSdkError(env, "achievement", e.result).Value());
    return;
  }
  Napi::Object out = AchievementToObject(env, e.achievement);
  if (e.achievement.achievementId.empty()) out.Set("achievementId", Napi::String::New(env, pending.achievementId));
  out.Set("result", ResultToObject(env, e.result, true));
  pending.deferred.Resolve(out);
}

void HandleAllAchievements(Napi::Env env, const Event& e) {
  if (g_pendingAllAchievements.empty()) return;
  Napi::Promise::Deferred deferred = std::move(g_pendingAllAchievements.front());
  g_pendingAllAchievements.pop_front();

  if (!e.result.ok) {
    deferred.Reject(MakeSdkError(env, "allAchievements", e.result).Value());
    return;
  }
  Napi::Array list = Napi::Array::New(env, e.achievements.size());
  uint32_t i = 0;
  for (const AchievementSnapshot& a : e.achievements) list.Set(i++, AchievementToObject(env, a));
  deferred.Resolve(list);
}

void HandleStat(Napi::Env env, const Event& e) {
  if (g_pendingStats.empty()) return;
  PendingStat pending = std::move(g_pendingStats.front());
  g_pendingStats.pop_front();

  if (!e.result.ok) {
    pending.deferred.Reject(MakeSdkError(env, "stat", e.result).Value());
    return;
  }
  Napi::Object out = Napi::Object::New(env);
  out.Set("statId", Napi::String::New(env, e.stat.statId.empty() ? pending.statId : e.stat.statId));
  out.Set("gameId", Napi::String::New(env, e.stat.gameId));
  out.Set("memberNumber", Napi::String::New(env, std::to_string(e.stat.memberNumber)));
  out.Set("updatedAt", Napi::String::New(env, std::to_string(e.stat.updatedAt)));
  out.Set("currentValue", Napi::Number::New(env, static_cast<double>(e.stat.currentValue)));
  out.Set("result", ResultToObject(env, e.result, true));
  pending.deferred.Resolve(out);
}

void HandleModifyStat(Napi::Env env, const Event& e) {
  if (g_pendingModifyStats.empty()) return;
  PendingStat pending = std::move(g_pendingModifyStats.front());
  g_pendingModifyStats.pop_front();

  if (!e.result.ok) {
    pending.deferred.Reject(MakeSdkError(env, "modifyStat", e.result).Value());
    return;
  }
  Napi::Object out = Napi::Object::New(env);
  out.Set("statId", Napi::String::New(env, pending.statId));
  out.Set("value", Napi::Number::New(env, static_cast<double>(pending.value)));
  out.Set("currentValue", Napi::Number::New(env, static_cast<double>(e.modifyStat.currentValue)));
  out.Set("updated", Napi::Boolean::New(env, e.modifyStat.updated));
  out.Set("errorMessage", Napi::String::New(env, e.modifyStat.errorMessage));
  out.Set("result", ResultToObject(env, e.result, true));
  pending.deferred.Resolve(out);
}

void DrainEvents(Napi::Env env) {
  for (;;) {
    Event e;
    {
      std::lock_guard<std::mutex> lock(g_queueMutex);
      if (g_queue.empty()) return;
      e = std::move(g_queue.front());
      g_queue.pop_front();
    }
    switch (e.kind) {
      case EventKind::RestartCheck: HandleRestartCheck(env, e); break;
      case EventKind::BaseInit: HandleBaseInit(env, e); break;
      case EventKind::OwnershipList: HandleOwnershipList(env, e); break;
      case EventKind::Achievement: HandleAchievement(env, e); break;
      case EventKind::AllAchievements: HandleAllAchievements(env, e); break;
      case EventKind::Stat: HandleStat(env, e); break;
      case EventKind::ModifyStat: HandleModifyStat(env, e); break;
    }
  }
}

// ── Lazy sub-module initialization ─────────────────────────────────────────────────────

// Returns false after rejecting `deferred` when Base is not up or the module refuses to init.
bool EnsureBase(Napi::Env env, const char* step, Napi::Promise::Deferred& deferred) {
  if (!g_baseInitialized) {
    deferred.Reject(MakeStateError(env, step, kErrNotInitialized, "SDK is not initialized (call initialize() first)").Value());
    return false;
  }
  return true;
}

bool EnsureOwnership(Napi::Env env, const char* step, Napi::Promise::Deferred& deferred) {
  if (!EnsureBase(env, step, deferred)) return false;
  if (!g_ownershipInitialized) {
    const ResultSnapshot r = ResultSnapshot::From(Ownership::Ownership_Initialize());
    if (!r.ok) {
      deferred.Reject(MakeSdkError(env, "ownershipInitialize", r).Value());
      return false;
    }
    g_ownershipInitialized = true;
  }
  return true;
}

bool EnsureGameSupport(Napi::Env env, const char* step, Napi::Promise::Deferred& deferred) {
  if (!EnsureBase(env, step, deferred)) return false;
  if (!g_gameSupportInitialized) {
    const ResultSnapshot r = ResultSnapshot::From(GameSupport::GameSupport_Initialize());
    if (!r.ok) {
      deferred.Reject(MakeSdkError(env, "gameSupportInitialize", r).Value());
      return false;
    }
    g_gameSupportInitialized = true;
  }
  return true;
}

// Answer for a synchronous read the addon refused to make (SDK not up yet). Same field set as
// ResultToObject plus `reason`, so callers read `ok` alone and never special-case the shape.
Napi::Object NotAskedObject(Napi::Env env, const char* reason) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("sdk", Napi::String::New(env, ""));
  o.Set("method", Napi::Number::New(env, 0));
  o.Set("code", Napi::Number::New(env, static_cast<double>(kErrNotInitialized)));
  o.Set("reason", Napi::String::New(env, reason));
  return o;
}

bool RequireString(Napi::Env env, const Napi::CallbackInfo& info, size_t index, const char* usage) {
  if (info.Length() <= index || !info[index].IsString()) {
    Napi::TypeError::New(env, usage).ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

// ── Exported functions ─────────────────────────────────────────────────────────────────

// getAddonInfo(): { sdkVersion, napiVersion, arch, platform, pumpIntervalMs }
Napi::Value GetAddonInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object o = Napi::Object::New(env);
  o.Set("sdkVersion", Napi::String::New(env, STOVE_PCSDK_SDK_VERSION));
  o.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  o.Set("arch", Napi::String::New(env, "x64"));
  o.Set("platform", Napi::String::New(env, "win32"));
  o.Set("pumpIntervalMs", Napi::Number::New(env, 16));  // vendor guide recommendation
  return o;
}

// getVersion(): { ok, sdk, method, code, version } — Base_GetVersion, informational, synchronous.
Napi::Value GetVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  wchar_t buffer[256] = {0};
  const ResultSnapshot r = ResultSnapshot::From(Base::Base_GetVersion(buffer, 256));
  Napi::Object o = ResultToObject(env, r, false);
  o.Set("version", Napi::String::New(env, WideToUtf8(buffer)));
  return o;
}

// initialize({ environment, gameId, applicationKey, restartWaitMs? }):
//   Promise<{ status: 'ok', result } | { status: 'restart' }>
// Runs Base_RestartAppIfNecessaryAsync, then Base_Initialize. Resolves 'restart' (without
// initializing) when the SDK asked the STOVE client to relaunch the application.
Napi::Value Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "initialize(options) expects an options object").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  const Napi::Value environment = opts.Get("environment");
  const Napi::Value gameId = opts.Get("gameId");
  const Napi::Value applicationKey = opts.Get("applicationKey");
  if (!environment.IsString() || !gameId.IsString() || !applicationKey.IsString()) {
    Napi::TypeError::New(env, "initialize: environment, gameId and applicationKey must be strings").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  uint32_t restartWaitMs = 60000;  // SDK default (vendor docs)
  const Napi::Value wait = opts.Get("restartWaitMs");
  if (wait.IsNumber()) restartWaitMs = wait.As<Napi::Number>().Uint32Value();

  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (g_init.stage != InitStage::Idle && g_init.stage != InitStage::Done) {
    deferred.Reject(MakeStateError(env, "initialize", kErrInProgress, "an initialize() call is already in progress").Value());
    return deferred.Promise();
  }
  if (g_baseInitialized) {
    deferred.Reject(MakeStateError(env, "initialize", kErrAlreadyInitialized, "SDK is already initialized; call uninitialize() first").Value());
    return deferred.Promise();
  }

  g_init.environment = JsToWide(environment);
  g_init.gameId = JsToWide(gameId);
  g_init.applicationKey = JsToWide(applicationKey);
  g_init.deferred = deferred;
  g_init.stage = InitStage::RestartCheck;

  Base::StovePCInitializeParam param;
  param.SetEnvironment(g_init.environment.c_str());
  param.SetGameID(g_init.gameId.c_str());
  param.SetApplicationKey(g_init.applicationKey.c_str());
  Base::Base_RestartAppIfNecessaryAsync(&param, restartWaitMs, OnRestartAppIfNecessary);

  return deferred.Promise();
}

// runCallbacks(): pump Base_RunCallback and settle whatever became ready. Cheap when idle.
Napi::Value RunCallbacks(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (Pumping()) Base::Base_RunCallback();
  DrainEvents(env);
  return env.Undefined();
}

// isInitialized(): boolean — Base_Initialize has succeeded and uninitialize() has not run.
Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_baseInitialized);
}

// getOwnershipList(): Promise<Ownership[]> — Ownership_OwnershipList (Ownership_Initialize lazily).
Napi::Value GetOwnershipList(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (g_pendingOwnershipList) {
    deferred.Reject(MakeStateError(env, "ownershipList", kErrInProgress, "an ownership query is already in progress").Value());
    return deferred.Promise();
  }
  if (!EnsureOwnership(env, "ownershipList", deferred)) return deferred.Promise();
  g_pendingOwnershipList = deferred;
  Ownership::Ownership_OwnershipList(OnOwnershipList);
  return deferred.Promise();
}

// getUser(): { ok, sdk, method, code, memberNumber, gameUserId, nickname } — Base_GetUser.
// Synchronous. Never throws: before initialize() it answers { ok: false, code: -1, reason }.
Napi::Value GetUser(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_baseInitialized) return NotAskedObject(env, "SDK is not initialized");
  Base::StovePCUser user;
  const ResultSnapshot r = ResultSnapshot::From(Base::Base_GetUser(&user));
  Napi::Object o = ResultToObject(env, r, false);
  o.Set("memberNumber", Napi::String::New(env, r.ok ? std::to_string(user.GetMemberNumber()) : std::string()));
  o.Set("gameUserId", Napi::String::New(env, r.ok ? std::to_string(user.GetGameUserId()) : std::string()));
  o.Set("nickname", Napi::String::New(env, r.ok ? WideToUtf8(user.GetNickname()) : std::string()));
  return o;
}

// getGds(): { ok, sdk, method, code, nation, isDefault, language } — Base_GetGds.
// `isDefault` true means the country could not be determined and `nation` is STOVE's default.
Napi::Value GetGds(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_baseInitialized) return NotAskedObject(env, "SDK is not initialized");
  Base::StovePCGds gds;
  const ResultSnapshot r = ResultSnapshot::From(Base::Base_GetGds(&gds));
  Napi::Object o = ResultToObject(env, r, false);
  o.Set("nation", Napi::String::New(env, r.ok ? WideToUtf8(gds.GetNation()) : std::string()));
  o.Set("isDefault", Napi::Boolean::New(env, r.ok ? gds.IsDefault() : false));
  o.Set("language", Napi::String::New(env, r.ok ? WideToUtf8(gds.GetLanguage()) : std::string()));
  return o;
}

// getAchievement(id): Promise<Achievement> — GameSupport_Achievement (a query; completes nothing).
Napi::Value GetAchievement(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!RequireString(env, info, 0, "getAchievement(achievementId) expects a string")) return env.Undefined();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (!EnsureGameSupport(env, "achievement", deferred)) return deferred.Promise();

  const std::wstring id = JsToWide(info[0]);
  g_pendingAchievements.push_back(PendingAchievement{info[0].As<Napi::String>().Utf8Value(), deferred});
  GameSupport::GameSupport_Achievement(id.c_str(), OnAchievement);
  return deferred.Promise();
}

// getAllAchievements(): Promise<Achievement[]> — GameSupport_AllAchievement.
Napi::Value GetAllAchievements(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (!EnsureGameSupport(env, "allAchievements", deferred)) return deferred.Promise();
  g_pendingAllAchievements.push_back(deferred);
  GameSupport::GameSupport_AllAchievement(OnAllAchievements);
  return deferred.Promise();
}

// getStat(statId): Promise<Stat> — GameSupport_Stat.
Napi::Value GetStat(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!RequireString(env, info, 0, "getStat(statId) expects a string")) return env.Undefined();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (!EnsureGameSupport(env, "stat", deferred)) return deferred.Promise();

  const std::wstring id = JsToWide(info[0]);
  g_pendingStats.push_back(PendingStat{info[0].As<Napi::String>().Utf8Value(), 0, deferred});
  GameSupport::GameSupport_Stat(id.c_str(), OnStat);
  return deferred.Promise();
}

// setStat(statId, value): Promise<ModifyStatResult> — GameSupport_ModifyStat.
// STOVE has no "unlock achievement" call: achievements are defined in STOVE Studio as a stat plus
// a goal, so completing one means modifying its stat. `value` must be an int32 (the SDK type).
Napi::Value SetStat(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "setStat(statId, value) expects a string and a number").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const double raw = info[1].As<Napi::Number>().DoubleValue();
  if (raw != raw || raw < static_cast<double>(INT32_MIN) || raw > static_cast<double>(INT32_MAX) || raw != static_cast<double>(static_cast<int32_t>(raw))) {
    Napi::RangeError::New(env, "setStat(statId, value): value must be an int32").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const int32_t value = static_cast<int32_t>(raw);

  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  if (!EnsureGameSupport(env, "modifyStat", deferred)) return deferred.Promise();

  const std::wstring id = JsToWide(info[0]);
  g_pendingModifyStats.push_back(PendingStat{info[0].As<Napi::String>().Utf8Value(), value, deferred});
  GameSupport::GameSupport_ModifyStat(id.c_str(), value, OnModifyStat);
  return deferred.Promise();
}

// uninitialize(): { gameSupport, ownership, base } — each the Result of its UnInitialize, or null
// if that module was never initialized. Base goes last, as the vendor guide requires. Pending
// Promises are rejected with { step: 'uninitialize', code: ErrorCode.ABORTED }. Safe to call twice.
Napi::Value Uninitialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);

  if (g_gameSupportInitialized) {
    out.Set("gameSupport", ResultToObject(env, ResultSnapshot::From(GameSupport::GameSupport_UnInitialize()), false));
    g_gameSupportInitialized = false;
  } else {
    out.Set("gameSupport", env.Null());
  }
  if (g_ownershipInitialized) {
    out.Set("ownership", ResultToObject(env, ResultSnapshot::From(Ownership::Ownership_UnInitialize()), false));
    g_ownershipInitialized = false;
  } else {
    out.Set("ownership", env.Null());
  }
  if (g_baseInitialized) {
    out.Set("base", ResultToObject(env, ResultSnapshot::From(Base::Base_UnInitialize()), false));
    g_baseInitialized = false;
  } else {
    out.Set("base", env.Null());
  }

  {
    std::lock_guard<std::mutex> lock(g_queueMutex);
    g_queue.clear();
  }
  const auto abort = [&](Napi::Promise::Deferred& d, const char* what) {
    d.Reject(MakeStateError(env, "uninitialize", kErrAborted, what).Value());
  };
  if (g_init.deferred) {
    abort(*g_init.deferred, "initialize() aborted by uninitialize()");
    g_init.deferred.reset();
  }
  g_init.stage = InitStage::Idle;
  if (g_pendingOwnershipList) {
    abort(*g_pendingOwnershipList, "ownership query aborted by uninitialize()");
    g_pendingOwnershipList.reset();
  }
  for (PendingAchievement& p : g_pendingAchievements) abort(p.deferred, "achievement request aborted by uninitialize()");
  g_pendingAchievements.clear();
  for (Napi::Promise::Deferred& d : g_pendingAllAchievements) abort(d, "achievement request aborted by uninitialize()");
  g_pendingAllAchievements.clear();
  for (PendingStat& p : g_pendingStats) abort(p.deferred, "stat request aborted by uninitialize()");
  g_pendingStats.clear();
  for (PendingStat& p : g_pendingModifyStats) abort(p.deferred, "stat request aborted by uninitialize()");
  g_pendingModifyStats.clear();

  return out;
}

// Enum values taken from the SDK headers at compile time, so JS never hard-codes them.
Napi::Object BuildConstants(Napi::Env env) {
  Napi::Object constants = Napi::Object::New(env);

  Napi::Object ownershipCode = Napi::Object::New(env);
  ownershipCode.Set("NONE", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipCode::NONE)));
  ownershipCode.Set("ACQUIRE", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipCode::ACQUIRE)));
  ownershipCode.Set("LOSE", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipCode::LOSE)));
  constants.Set("OwnershipCode", ownershipCode);

  Napi::Object gameCode = Napi::Object::New(env);
  gameCode.Set("NONE", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipGameCode::NONE)));
  gameCode.Set("BASIC", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipGameCode::BASIC)));
  gameCode.Set("DEMO", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipGameCode::DEMO)));
  gameCode.Set("DLC", Napi::Number::New(env, static_cast<double>(Ownership::OwnershipGameCode::DLC)));
  constants.Set("OwnershipGameCode", gameCode);

  Napi::Object errorCode = Napi::Object::New(env);
  errorCode.Set("NOT_INITIALIZED", Napi::Number::New(env, kErrNotInitialized));
  errorCode.Set("ALREADY_INITIALIZED", Napi::Number::New(env, kErrAlreadyInitialized));
  errorCode.Set("IN_PROGRESS", Napi::Number::New(env, kErrInProgress));
  errorCode.Set("ABORTED", Napi::Number::New(env, kErrAborted));
  constants.Set("ErrorCode", errorCode);

  return constants;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getAddonInfo", Napi::Function::New(env, GetAddonInfo));
  exports.Set("getVersion", Napi::Function::New(env, GetVersion));
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  exports.Set("runCallbacks", Napi::Function::New(env, RunCallbacks));
  exports.Set("isInitialized", Napi::Function::New(env, IsInitialized));
  exports.Set("uninitialize", Napi::Function::New(env, Uninitialize));
  exports.Set("getOwnershipList", Napi::Function::New(env, GetOwnershipList));
  exports.Set("getUser", Napi::Function::New(env, GetUser));
  exports.Set("getGds", Napi::Function::New(env, GetGds));
  exports.Set("getAchievement", Napi::Function::New(env, GetAchievement));
  exports.Set("getAllAchievements", Napi::Function::New(env, GetAllAchievements));
  exports.Set("getStat", Napi::Function::New(env, GetStat));
  exports.Set("setStat", Napi::Function::New(env, SetStat));
  exports.Set("constants", BuildConstants(env));
  return exports;
}

}  // namespace

NODE_API_MODULE(stovesdk, Init)

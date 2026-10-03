// Compile-only check that index.d.ts describes a usable API (`npm run typecheck`). Never executed.
import { load, ErrorCode, type SdkError, type InitializeResult, type Ownership } from '..'

async function main(): Promise<void> {
  const sdk = load()
  const timer = setInterval(() => sdk.runCallbacks(), sdk.getAddonInfo().pumpIntervalMs)

  try {
    const init: InitializeResult = await sdk.initialize({ environment: 'LIVE', gameId: 'GAME_ID', applicationKey: 'APP_KEY' })
    if (init.status === 'restart') return

    const list: Ownership[] = await sdk.getOwnershipList()
    const owned = list.some(o => o.ownershipCode === sdk.constants.OwnershipCode.ACQUIRE && o.gameCode === sdk.constants.OwnershipGameCode.BASIC)
    console.log(owned, init.result.ok)

    const user = sdk.getUser()
    if (user.ok) console.log(user.nickname)

    const stat = await sdk.getStat('STAT_ID')
    const modified = await sdk.setStat('STAT_ID', stat.currentValue + 1)
    const achievement = await sdk.getAchievement('ACHIEVEMENT_ID')
    console.log(modified.updated, achievement.status, achievement.condition?.goalValue)
  } catch (err) {
    const e = err as SdkError
    if (e.code === ErrorCode.NOT_INITIALIZED) console.log(e.step)
  } finally {
    clearInterval(timer)
    sdk.uninitialize()
  }
}

void main

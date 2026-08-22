// Minecraft 1.20.1 Forge
// Requires: KubeJS, Iron's Spells 'n Spellbooks, KubeJS Iron's Spells
// 注意：本文件只做法术注册与逻辑定义（STARTUP 类型），
//       补速 tick 监听器在 server_scripts/three_movement_spells.js
//
// 目标查找（重写版）：全部复用矮人飞跃已验证可用的 API
//   - kbCaster.server.getEntities()（验证过）
//   - e.type / e.x / e.z / kbCaster.x / kbCaster.z（验证过）
//   - e.teamId（KubeJS 注入）+ 多级 fallback
//   - e.isAlive() / e.isSpectator()（try/catch 保护）
// 全程打日志，预检查结果一目了然。

const $ClientboundSetEntityMotionPacket = Java.loadClass(
  'net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket'
)
const $ServerPlayer = Java.loadClass('net.minecraft.server.level.ServerPlayer')

// ===== Balance knobs =====
const TEAM_THROW_RADIUS = 3.0
const THROW_HORIZONTAL_SPEED = 1.05
const THROW_VERTICAL_SPEED = 0.65
const DWARF_LEAP_HORIZONTAL_SPEED = 1.10   // 配合补速，平地目标约 12 格；飞过头调小
const DWARF_LEAP_VERTICAL_SPEED = 0.55
const LAUNCH_REPEAT_TICKS = 4   // 矮人飞跃补速次数
const THROW_REPEAT_TICKS = 2    // 投掷补速次数
const DWARF_LEAP_KNOCKBACK_PROTECTION_TICKS = 18 // 仅免疫击退，不免疫伤害
const GUILLOTINE_DAMAGE = 40.0
const GUILLOTINE_RANGE = 2.0
const GUILLOTINE_EXTRA_REACH = 0.25
const GUILLOTINE_HALF_WIDTH = 0.90
const GUILLOTINE_VERTICAL_REACH = 2.25

// 待补速队列（数组，直接存 PlayerJS 引用）。global 跨脚本类型共享。
global.threeSpellsLaunchQueue = []
global.threeSpellsLastDirSrc = 'unknown'

// KubeJS 包装对象 -> 原版 Entity（仅用于发运动同步包）
global.threeSpellsRawEntity = function (kbRawIn) {
  if (kbRawIn == null) return null
  return typeof kbRawIn.getEntity === 'function' ? kbRawIn.getEntity() : kbRawIn
}

global.threeSpellsEntityKey = function (kbEnt) {
  var kbRaw = global.threeSpellsRawEntity(kbEnt)
  try { return String(kbRaw.getUUID()) } catch (kbUuidErr) { }
  try { return String(kbEnt.uuid) } catch (kbWrappedUuidErr) { }
  return ''
}

// ===== 队伍读取（多级 fallback）=====
global.threeSpellsGetTeamId = function (kbEnt) {
  var kbT = ''
  // ① KubeJS 注入属性
  try {
    var kbRaw = kbEnt.teamId
    if (kbRaw != null) kbT = String(kbRaw)
  } catch (kbTe1) { kbT = '' }
  if (kbT.length > 0) return kbT
  // ② 原版方法（try/catch 保护）
  try {
    var kbTeam = kbEnt.getTeam()
    if (kbTeam != null) kbT = String(kbTeam.getName())
  } catch (kbTe2) { kbT = '' }
  return kbT
}

// ===== 目标查找（重写版）=====
global.threeSpellsFindNearestPlayer = function (kbCaster, kbFlag) {
  if (kbCaster == null) {
    console.log('[ThreeSpells] findNearest: caster null')
    return null
  }
  var kbCasterTeam = global.threeSpellsGetTeamId(kbCaster)

  var kbAll = null
  try { kbAll = kbCaster.server.getEntities() } catch (kbFErr) {
    console.log('[ThreeSpells] findNearest: server.getEntities threw: ' + kbFErr)
    return null
  }
  if (kbAll == null) {
    console.log('[ThreeSpells] findNearest: server.getEntities null')
    return null
  }

  var kbN = kbAll.size()
  var kbRSq = TEAM_THROW_RADIUS * TEAM_THROW_RADIUS
  var kbNear = null
  var kbNearSq = kbRSq + 1.0
  var kbI = 0
  for (kbI = 0; kbI < kbN; kbI++) {
    var kbC = kbAll.get(kbI)
    // ① 类型过滤：只处理玩家
    var kbCType = ''
    try { kbCType = String(kbC.type) } catch (kbCtErr) { kbCType = '' }
    if (kbCType !== 'minecraft:player') continue

    // ② 距离过滤：>0.5 排除自己，<=3 格范围内
    var kbDX = kbC.x - kbCaster.x
    var kbDY = kbC.y - kbCaster.y
    var kbDZ = kbC.z - kbCaster.z
    var kbDS = kbDX * kbDX + kbDY * kbDY + kbDZ * kbDZ
    if (kbDS <= 0.25) continue
    if (kbDS > kbRSq) continue

    // ③ 存活检查（失败则不排除）
    var kbAlive = false
    try { kbAlive = kbC.isAlive() } catch (kbAlErr) { kbAlive = false }
    if (!kbAlive) continue

    // ④ 旁观模式检查（失败则不排除）
    var kbSpec = false
    try { kbSpec = kbC.isSpectator() } catch (kbSpErr) { kbSpec = false }
    if (kbSpec) continue

    // ⑤ 队伍判断
    var kbCandTeam = global.threeSpellsGetTeamId(kbC)
    var kbIsTm = kbCasterTeam.length > 0 && kbCasterTeam === kbCandTeam
    if (kbIsTm !== kbFlag) continue

    // ⑥ 取最近
    if (kbDS < kbNearSq) {
      kbNearSq = kbDS
      kbNear = kbC
    }
  }

  if (kbNear == null) {
    console.log('[ThreeSpells] findNearest: none (casterTeam=' + kbCasterTeam +
      ' wantSame=' + kbFlag + ' scanned=' + kbN + ')')
  }
  return kbNear
}

// ===== 施速与同步 =====
global.threeSpellsLaunchPlayer = function (kbP, kbMX, kbMY, kbMZ) {
  kbP.stopRiding()
  kbP.setOnGround(false)
  kbP.motionX = kbMX
  kbP.motionY = kbMY
  kbP.motionZ = kbMZ
  kbP.hurtMarked = true
  var kbRaw = global.threeSpellsRawEntity(kbP)
  if (kbRaw != null && kbRaw instanceof $ServerPlayer) {
    kbRaw.connection.send(new $ClientboundSetEntityMotionPacket(kbRaw))
  }
}

global.threeSpellsLaunchAndHold = function (kbP, kbMX, kbMY, kbMZ, kbT, kbKind, kbProtectionTicks) {
  global.threeSpellsLaunchPlayer(kbP, kbMX, kbMY, kbMZ)
  var kbKey = global.threeSpellsEntityKey(kbP)
  var kbI = 0
  // 同一实体只能保留最新的一次位移，避免两个队列互相覆盖方向。
  for (kbI = global.threeSpellsLaunchQueue.length - 1; kbI >= 0; kbI--) {
    if (global.threeSpellsLaunchQueue[kbI].entityKey === kbKey) {
      global.threeSpellsLaunchQueue.splice(kbI, 1)
    }
  }
  global.threeSpellsLaunchQueue.push({
    ticks: kbT,
    protectionTicks: kbProtectionTicks == null ? 0 : kbProtectionTicks,
    kind: kbKind == null ? 'throw' : kbKind,
    entityKey: kbKey,
    x: kbMX,
    z: kbMZ,
    player: kbP
  })
  console.log('[ThreeSpells] launch dir=' + global.threeSpellsLastDirSrc +
    ' v=(' + kbMX + ',' + kbMY + ',' + kbMZ + ') ticks=' + kbT)
}

global.threeSpellsHasLeapProtection = function (kbEnt) {
  var kbKey = global.threeSpellsEntityKey(kbEnt)
  if (kbKey.length === 0) return false
  var kbQueue = global.threeSpellsLaunchQueue
  var kbI = 0
  for (kbI = 0; kbI < kbQueue.length; kbI++) {
    var kbData = kbQueue[kbI]
    if (kbData.kind === 'dwarf_leap' && kbData.protectionTicks > 0 && kbData.entityKey === kbKey) return true
  }
  return false
}

// 弓箭/近战命中仍正常造成伤害，但飞跃期间不允许其击退向量覆盖飞跃方向。
ForgeEvents.onEvent('net.minecraftforge.event.entity.living.LivingKnockBackEvent', kbEvent => {
  if (!global.threeSpellsHasLeapProtection(kbEvent.getEntity())) return
  kbEvent.setCanceled(true)
  console.log('[ThreeSpells] dwarf_leap: cancelled external knockback')
})

// ---- 朝向（marker 方案，已验证）----
global.threeSpellsGetX = function (kbEnt) {
  try {
    var kbV = kbEnt.x
    if (kbV != null && typeof kbV === 'number' && isFinite(kbV)) return kbV
  } catch (kbXErr) { }
  return null
}

global.threeSpellsGetZ = function (kbEnt) {
  try {
    var kbV = kbEnt.z
    if (kbV != null && typeof kbV === 'number' && isFinite(kbV)) return kbV
  } catch (kbZErr) { }
  return null
}

global.threeSpellsGetDirectionViaMarker = function (kbCaster, kbWorld) {
  kbCaster.runCommandSilent('kill @e[type=minecraft:marker,tag=kb_dir]')
  kbCaster.runCommandSilent('summon minecraft:marker ^ ^ ^3 {Tags:["kb_dir"]}')
  var kbAll = null
  try { kbAll = kbCaster.server.getEntities() } catch (kbSrvErr) { kbAll = null }
  if (kbAll == null) {
    kbCaster.runCommandSilent('kill @e[type=minecraft:marker,tag=kb_dir,distance=..4]')
    return null
  }
  var kbN = kbAll.size()
  var kbDx = null
  var kbDz = null
  var kbBest = 99
  var kbI = 0
  for (kbI = 0; kbI < kbN; kbI++) {
    var kbE = kbAll.get(kbI)
    var kbType = ''
    try { kbType = String(kbE.type) } catch (kbTErr) { kbType = '' }
    if (kbType !== 'minecraft:marker') continue
    var kbTagged = false
    try { kbTagged = kbE.getTags().contains('kb_dir') } catch (kbTagErr) { kbTagged = false }
    if (!kbTagged) continue
    var kbSameDimension = false
    try { kbSameDimension = String(kbE.level.dimension) === String(kbCaster.level.dimension) } catch (kbDimErr) { kbSameDimension = false }
    if (!kbSameDimension) continue
    var kbEX = global.threeSpellsGetX(kbE)
    var kbEZ = global.threeSpellsGetZ(kbE)
    if (kbEX == null || kbEZ == null) continue
    var kbRX = kbEX - kbCaster.x
    var kbRZ = kbEZ - kbCaster.z
    var kbDist = Math.sqrt(kbRX * kbRX + kbRZ * kbRZ)
    if (kbDist > 0.5 && kbDist < kbBest) {
      kbBest = kbDist
      kbDx = kbRX
      kbDz = kbRZ
    }
  }
  kbCaster.runCommandSilent('kill @e[type=minecraft:marker,tag=kb_dir,distance=..4]')
  if (kbDx == null) {
    console.log('[ThreeSpells] marker not found (scanned ' + kbN + ')')
    return null
  }
  var kbLen = Math.sqrt(kbDx * kbDx + kbDz * kbDz)
  if (kbLen < 1e-6) return null
  return { x: kbDx / kbLen, z: kbDz / kbLen }
}

global.threeSpellsGetFacingLook = function (kbCaster) {
  var kbF = ''
  try { kbF = kbCaster.facing == null ? '' : String(kbCaster.facing).toUpperCase() } catch (kbFErr) { kbF = '' }
  if (kbF === 'NORTH') return { x: 0, z: -1 }
  if (kbF === 'SOUTH') return { x: 0, z: 1 }
  if (kbF === 'EAST') return { x: 1, z: 0 }
  if (kbF === 'WEST') return { x: -1, z: 0 }
  return { x: 0, z: 1 }
}

global.threeSpellsHorizontalLook = function (kbCaster, kbWorld) {
  try {
    var kbM = global.threeSpellsGetDirectionViaMarker(kbCaster, kbWorld)
    if (kbM != null) { global.threeSpellsLastDirSrc = 'marker'; return kbM }
  } catch (kbMainErr) {
    console.log('[ThreeSpells] marker threw: ' + kbMainErr)
  }
  global.threeSpellsLastDirSrc = 'facing'
  return global.threeSpellsGetFacingLook(kbCaster)
}

// ===== 两个投掷法术共用的投掷逻辑 =====
global.threeSpellsThrowBehind = function (kbWorld, kbCaster, kbFlag) {
  var kbTar = global.threeSpellsFindNearestPlayer(kbCaster, kbFlag)
  if (kbTar == null) {
    console.log('[ThreeSpells] throwBehind: no target (flag=' + kbFlag + ')')
    return
  }
  var kbFwd = global.threeSpellsHorizontalLook(kbCaster, kbWorld)
  global.threeSpellsLaunchAndHold(
    kbTar,
    -kbFwd.x * THROW_HORIZONTAL_SPEED,
    THROW_VERTICAL_SPEED,
    -kbFwd.z * THROW_HORIZONTAL_SPEED,
    THROW_REPEAT_TICKS,
    'throw',
    0
  )
  console.log('[ThreeSpells] throwBehind: tossed target team=' + global.threeSpellsGetTeamId(kbTar))
}

// ===== 矮人飞跃 =====
global.threeSpellsDwarfLeap = function (kbCaster, kbWorld) {
  if (kbCaster == null || !kbCaster.isPlayer()) return
  var kbFwd = global.threeSpellsHorizontalLook(kbCaster, kbWorld)
  global.threeSpellsLaunchAndHold(
    kbCaster,
    kbFwd.x * DWARF_LEAP_HORIZONTAL_SPEED,
    DWARF_LEAP_VERTICAL_SPEED,
    kbFwd.z * DWARF_LEAP_HORIZONTAL_SPEED,
    LAUNCH_REPEAT_TICKS,
    'dwarf_leap',
    DWARF_LEAP_KNOCKBACK_PROTECTION_TICKS
  )
}

// ===== 断头台 =====
// 吟唱结束后，对施法者正前方的狭长区域造成一次伤害。
// 区域：前方 0.35～2.25 格，左右各 0.9 格，上下 2.25 格。
global.threeSpellsGuillotine = function (kbCaster, kbWorld) {
  if (kbCaster == null || !kbCaster.isPlayer()) return

  var kbFwd = global.threeSpellsHorizontalLook(kbCaster, kbWorld)
  var kbAll = null
  try { kbAll = kbCaster.server.getEntities() } catch (kbGServerErr) {
    console.log('[ThreeSpells] guillotine: server.getEntities threw: ' + kbGServerErr)
    return
  }
  if (kbAll == null) return

  var kbHitCount = 0
  var kbN = kbAll.size()
  var kbI = 0
  for (kbI = 0; kbI < kbN; kbI++) {
    var kbE = kbAll.get(kbI)
    if (kbE === kbCaster) continue

    // server.getEntities() 可能包含其他维度；只伤害与施法者同维度的实体。
    try { if (kbE.level != kbCaster.level) continue } catch (kbGLevelErr) { continue }

    var kbLiving = false
    try { kbLiving = kbE.isLiving() } catch (kbGLivingErr) { kbLiving = false }
    if (!kbLiving) continue

    var kbAlive = false
    try { kbAlive = kbE.isAlive() } catch (kbGAliveErr) { kbAlive = false }
    if (!kbAlive) continue

    var kbSpectator = false
    try { kbSpectator = kbE.isSpectator() } catch (kbGSpecErr) { kbSpectator = false }
    if (kbSpectator) continue

    var kbDX = kbE.x - kbCaster.x
    var kbDY = kbE.y - kbCaster.y
    var kbDZ = kbE.z - kbCaster.z

    // 向前投影决定距离，叉积绝对值决定横向偏移。
    var kbForwardDistance = kbDX * kbFwd.x + kbDZ * kbFwd.z
    var kbSideDistance = Math.abs(kbDX * kbFwd.z - kbDZ * kbFwd.x)
    if (kbForwardDistance < 0.35 || kbForwardDistance > GUILLOTINE_RANGE + GUILLOTINE_EXTRA_REACH) continue
    if (kbSideDistance > GUILLOTINE_HALF_WIDTH) continue
    if (Math.abs(kbDY) > GUILLOTINE_VERTICAL_REACH) continue

    try {
      kbE.attack(GUILLOTINE_DAMAGE)
      kbHitCount++
    } catch (kbGAttackErr) {
      console.log('[ThreeSpells] guillotine: attack failed: ' + kbGAttackErr)
    }
  }

  console.log('[ThreeSpells] guillotine: hit=' + kbHitCount +
    ' damage=' + GUILLOTINE_DAMAGE + ' range=' + GUILLOTINE_RANGE)
}

// ===== 法术注册 =====
StartupEvents.registry('irons_spellbooks:spells', event => {
  event.create('ally_toss')
    .setCastType('instant')
    .setSchool('irons_spellbooks:nature')
    .setMinRarity('uncommon')
    .setMaxLevel(1)
    .setCooldownSeconds(4)
    .setBaseManaCost(20)
    .setManaCostPerLevel(0)
    .setFinishSound('minecraft:entity.player.attack.sweep')
    .setAllowLooting(true)
    .setUniqueInfo(() => [Component.translatable('spell.kubejs.ally_toss.info')])
    .checkPreCastConditions(ctx => {
      var kbOk = global.threeSpellsFindNearestPlayer(ctx.entity, true) != null
      console.log('[ThreeSpells] ally_toss preCheck=' + kbOk)
      return kbOk
    })
    .onCast(ctx => global.threeSpellsThrowBehind(ctx.level, ctx.entity, true))

  event.create('over_shoulder_throw')
    .setCastType('instant')
    .setSchool('irons_spellbooks:nature')
    .setMinRarity('rare')
    .setMaxLevel(1)
    .setCooldownSeconds(7)
    .setBaseManaCost(35)
    .setManaCostPerLevel(0)
    .setFinishSound('minecraft:entity.iron_golem.attack')
    .setAllowLooting(true)
    .setUniqueInfo(() => [Component.translatable('spell.kubejs.over_shoulder_throw.info')])
    .checkPreCastConditions(ctx => {
      var kbOk = global.threeSpellsFindNearestPlayer(ctx.entity, false) != null
      console.log('[ThreeSpells] over_shoulder preCheck=' + kbOk)
      return kbOk
    })
    .onCast(ctx => global.threeSpellsThrowBehind(ctx.level, ctx.entity, false))

  event.create('dwarf_leap')
    .setCastType('instant')
    .setSchool('irons_spellbooks:nature')
    .setMinRarity('uncommon')
    .setMaxLevel(1)
    .setCooldownSeconds(6)
    .setBaseManaCost(25)
    .setManaCostPerLevel(0)
    .setFinishSound('minecraft:entity.goat.long_jump')
    .setAllowLooting(true)
    .setUniqueInfo(() => [Component.translatable('spell.kubejs.dwarf_leap.info')])
    .checkPreCastConditions(ctx => ctx.entity != null && ctx.entity.isPlayer())
    .onCast(ctx => global.threeSpellsDwarfLeap(ctx.entity, ctx.level))

  event.create('guillotine')
    .setCastType('long')
    .setCastTime(20)
    .setCastStartAnimation('irons_spellbooks:overhead_two_handed_swing', true, true)
    .setSchool('irons_spellbooks:blood')
    .setMinRarity('epic')
    .setMaxLevel(1)
    .setCooldownSeconds(60)
    .setBaseManaCost(60)
    .setManaCostPerLevel(0)
    .setStartSound('minecraft:block.chain.place')
    .setFinishSound('minecraft:block.anvil.land')
    .setAllowLooting(true)
    .setUniqueInfo(() => [Component.translatable('spell.kubejs.guillotine.info')])
    .checkPreCastConditions(ctx => ctx.entity != null && ctx.entity.isPlayer())
    .onCast(ctx => global.threeSpellsGuillotine(ctx.entity, ctx.level))
})

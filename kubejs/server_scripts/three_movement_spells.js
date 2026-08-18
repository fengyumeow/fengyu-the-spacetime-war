// Minecraft 1.20.1 Forge
// SERVER 脚本类型：负责补速 tick 监听器。
// 所有法术逻辑函数都在 startup_scripts 里定义并挂在 global 上。

ServerEvents.tick(() => {
  const queue = global.threeSpellsLaunchQueue
  if (queue == null || queue.length === 0) return

  // 倒序遍历 + splice 安全删除；避开 Rhino 对 for...of + 解构的不稳定支持
  for (let i = queue.length - 1; i >= 0; i--) {
    const data = queue[i]
    const player = data.player
    if (player == null || !player.isAlive()) {
      queue.splice(i, 1)
      continue
    }
    if (--data.ticks <= 0) {
      queue.splice(i, 1)
      continue
    }
    // 补速：只重置水平分量，竖直保留当前值（由重力自然处理），
    // 避免持续重置竖直导致玩家越飞越高。
    global.threeSpellsLaunchPlayer(player, data.x, player.motionY, data.z)
    console.log('[ThreeSpells] re-apply v=(' + data.x + ',' + player.motionY + ',' + data.z + ') remaining=' + data.ticks)
  }
})
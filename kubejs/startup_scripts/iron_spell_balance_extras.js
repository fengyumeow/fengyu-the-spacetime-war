// Iron's Spells 1.20.1-3.16.2 / KubeJS 6
// The generated spell JSON format cannot configure cast time or Gust's
// level-based wall-impact damage, so those values are completed here.

const BalanceDamageTypes = Java.loadClass('net.minecraft.world.damagesource.DamageTypes')
const BalanceMobEffectRegistry = Java.loadClass('io.redspace.ironsspellbooks.registries.MobEffectRegistry')
const BalanceMobEffectInstance = Java.loadClass('net.minecraft.world.effect.MobEffectInstance')
const BalanceTargetEntityCastData = Java.loadClass('io.redspace.ironsspellbooks.capabilities.magic.TargetEntityCastData')

ISSEvents.modifySpell(event => {
  event.modify('irons_spellbooks:invisibility', spell => {
    spell.setCastTimeCallback(level => level === 1 ? 20 : 40)
  })

  event.modify('irons_spellbooks:slow', spell => {
    spell.setServerCastCallback(false, ctx => {
      if (ctx.getSpellLevel() !== 1) return

      const castData = ctx.getPlayerMagicData().getAdditionalCastData()
      if (!(castData instanceof BalanceTargetEntityCastData)) return

      const target = castData.getTarget(ctx.getLevel())
      if (target == null) return

      ctx.getLevel().getServer().scheduleInTicks(1, () => {
        if (!target.isAlive()) return

        const effectType = BalanceMobEffectRegistry.SLOWED.get()
        const current = target.getEffect(effectType)
        if (current == null) return

        const amplifier = current.getAmplifier()
        target.removeEffect(effectType)
        target.addEffect(new BalanceMobEffectInstance(effectType, 200, amplifier, false, false, true))
      })
    })
  })

  event.modify('irons_spellbooks:gust', spell => {
    spell.setCastTimeCallback(level => level === 10 ? 10 : 15)
  })
})

ForgeEvents.onEvent('net.minecraftforge.event.entity.living.LivingHurtEvent', event => {
  if (!event.getSource().is(BalanceDamageTypes.FLY_INTO_WALL)) return

  const airborne = event.getEntity().getEffect(BalanceMobEffectRegistry.AIRBORNE.get())
  if (airborne == null || airborne.getAmplifier() !== 9) return

  event.setAmount(12.0)
})

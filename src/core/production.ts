import { BASE_PRODUCTION, MAX_PRODUCTION, MINERAL_SPOIL_CAP, RESOURCES } from './constants';
import { applyColonyEventAfter, applyColonyEventBefore, eventProductionModifier } from './events';
import { neighbours } from './map';
import { shuffle, weighted } from './rng';
import type { ColonyEvent, GameState, Goods, Plot, ProductionReport } from './types';

export const emptyGoods = (): Goods => ({ food: 0, energy: 0, smithore: 0, crystite: 0 });

/** Expected output of a MULE before luck, energy and events. */
export function baseOutput(state: GameState, plot: Plot, mule = plot.mule): number {
  if (!mule || plot.terrain === 'town') return 0;
  const base = mule === 'crystite' ? plot.crystite : BASE_PRODUCTION[mule][plot.terrain];
  if (base <= 0) return 0;
  return base + bonusFor(state, plot, mule);
}

/**
 * Two bonuses, as in the original: the learning curve (+1 when a plot
 * touches another plot of the same owner making the same thing) and
 * economies of scale (+1 for every three plots a player has on the same
 * resource).
 */
export function bonusFor(state: GameState, plot: Plot, mule: NonNullable<Plot['mule']>): number {
  if (plot.owner === null) return 0;
  const adjacent = neighbours(plot.index).some((i) => {
    const n = state.map[i]!;
    return n.owner === plot.owner && n.mule === mule;
  });
  const same = state.map.filter((p) => p.owner === plot.owner && (p === plot ? mule : p.mule) === mule).length;
  return (adjacent ? 1 : 0) + Math.floor(same / 3);
}

/**
 * The production phase: MULEs use energy, goods spoil, MULEs produce, and the
 * colony event (if any) does its work. Mutates `state`.
 */
export function runProduction(state: GameState, event: ColonyEvent | null): ProductionReport {
  if (event) applyColonyEventBefore(state, event);

  const report: ProductionReport = { plots: {}, perPlayer: {} };
  for (const player of state.players) {
    const before = { ...player.goods };
    const usage = emptyGoods();
    const spoiled = emptyGoods();
    const produced = emptyGoods();

    const mules = state.map.filter((p) => p.owner === player.id && p.mule);
    const consumers = mules.filter((p) => p.mule !== 'energy');
    const powered = new Set<number>();
    const energyUsed = Math.min(consumers.length, player.goods.energy);
    for (const p of shuffle(state.rng, [...consumers]).slice(0, energyUsed)) powered.add(p.index);
    usage.energy = energyUsed;
    player.goods.energy -= energyUsed;

    // Spoilage of what was left over from last round.
    spoiled.food = Math.floor(player.goods.food / 2);
    spoiled.energy = Math.floor(player.goods.energy / 4);
    spoiled.smithore = Math.max(0, player.goods.smithore - MINERAL_SPOIL_CAP);
    spoiled.crystite = Math.max(0, player.goods.crystite - MINERAL_SPOIL_CAP);
    for (const r of RESOURCES) player.goods[r] -= spoiled[r];

    for (const p of mules) {
      let amount = 0;
      if (p.mule === 'energy' || powered.has(p.index)) {
        const base = baseOutput(state, p);
        if (base > 0) amount = base + weighted(state.rng, [[-1, 1], [0, 3], [1, 1]] as const);
      }
      amount = eventProductionModifier(state, event, p.index, amount);
      amount = Math.min(Math.max(amount, 0), MAX_PRODUCTION);
      p.lastProduction = amount;
      report.plots[p.index] = amount;
      produced[p.mule!] += amount;
    }
    for (const r of RESOURCES) player.goods[r] += produced[r];

    report.perPlayer[player.id] = {
      before, usage, spoiled, produced,
      shortEnergy: consumers.length - energyUsed,
    };
  }
  // Unowned or idle plots show nothing.
  for (const p of state.map) if (!p.mule) p.lastProduction = null;

  if (event) applyColonyEventAfter(state, event);
  return report;
}

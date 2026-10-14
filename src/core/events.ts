/**
 * Random events. Personal events strike one player at the start of their
 * development turn (good luck never goes to the leader, bad luck never to
 * the player in last place). Colony events hit everyone during production.
 */
import { MAP_ROWS, roundMult } from './constants';
import { plotsOf, ranking } from './economy';
import { isMountain, seedCrystite } from './map';
import { chance, int, pick, type RngState } from './rng';
import type { ColonyEvent, GameState, Player, Resource } from './types';

interface PersonalEvent {
  good: boolean;
  /** Returns the message, having applied the effect; null if it doesn't apply. */
  apply(state: GameState, p: Player, m: number): string | null;
}

const money = (p: Player, amount: number) => {
  p.money = Math.max(0, p.money + amount);
  return Math.abs(amount);
};

const count = (state: GameState, p: Player, r?: Resource) =>
  plotsOf(state, p.id).filter((q) => (r ? q.mule === r : q.mule !== null)).length;

export const PERSONAL_EVENTS: PersonalEvent[] = [
  { good: true, apply: (_s, p) => { p.goods.food += 3; p.goods.energy += 2; return 'A care package from your home world arrived with 3 food and 2 energy.'; } },
  { good: true, apply: (_s, p) => { p.goods.smithore += 2; return 'A wandering trader repaid your hospitality with 2 bars of smithore.'; } },
  { good: true, apply: (_s, p, m) => `Your MULE took first prize at the colony fair. You won $${money(p, 4 * m)}.` },
  { good: true, apply: (_s, p, m) => `Your MULE won the colony dance contest. You collect $${money(p, 2 * m)}.` },
  {
    good: true, apply: (s, p, m) => {
      const n = count(s, p, 'food');
      return n ? `The agriculture council paid you $${money(p, 2 * m * n)} for fine land stewardship.` : null;
    },
  },
  { good: true, apply: (_s, p, m) => `You stopped a burrow-worm infestation and the colony paid you $${money(p, 3 * m)}.` },
  { good: true, apply: (_s, p, m) => `The museum bought your antique calculator for $${money(p, 6 * m)}.` },
  { good: true, apply: (_s, p, m) => `You won the swamp eel eating contest and collected $${money(p, 2 * m)}.` },
  { good: true, apply: (_s, p, m) => `A charity from your home world took pity on you and sent $${money(p, 3 * m)}.` },
  { good: true, apply: (_s, p, m) => `Your off-world investments paid $${money(p, 4 * m)} in dividends.` },
  { good: true, apply: (_s, p, m) => `A distant relative left you a fortune. After taxes it came to $${money(p, 5 * m)}.` },
  { good: true, apply: (_s, p, m) => `You found a moose-rat hide and sold it for $${money(p, 2 * m)}.` },
  { good: false, apply: (_s, p) => { if (p.goods.food < 2) return null; p.goods.food -= Math.floor(p.goods.food / 2); return 'Glacier imps broke into your shed and ate half your food.'; } },
  {
    good: false, apply: (s, p, m) => {
      const n = count(s, p, 'smithore') + count(s, p, 'crystite');
      return n ? `Your mining MULEs wore out from heavy use. Repairs cost $${money(p, -m * n)}.` : null;
    },
  },
  { good: false, apply: (s, p, m) => (count(s, p) ? `One of your MULEs lost a bolt. Repairs cost $${money(p, -3 * m)}.` : null) },
  { good: false, apply: (_s, p, m) => `Your space-gypsy in-laws made a mess of your house. Cleanup cost $${money(p, -3 * m)}.` },
  { good: false, apply: (_s, p, m) => `Flying cat-bugs chewed through your roof. Repairs cost $${money(p, -4 * m)}.` },
  { good: false, apply: (_s, p, m) => `You lost $${money(p, -2 * m)} betting on the kazinga races.` },
  { good: false, apply: (_s, p, m) => `A bat-lizard bit you. The hospital bill came to $${money(p, -2 * m)}.` },
  {
    good: false, apply: (s, p) => {
      const plots = plotsOf(s, p.id);
      if (plots.length < 2) return null;
      const lost = plots[int(s.rng, 0, plots.length - 1)]!;
      lost.owner = null;
      lost.mule = null;
      lost.lastProduction = null;
      return 'The land office lost the paperwork for one of your plots. It is back on the market.';
    },
  },
];

/** Roll a personal event for `p` at the start of their turn; returns the message or null. */
export function rollPersonalEvent(state: GameState, p: Player, chanceOf: number): { text: string; good: boolean } | null {
  if (!chance(state.rng, chanceOf)) return null;
  const order = ranking(state);
  const isLeader = order[0]!.id === p.id;
  const isLast = order[order.length - 1]!.id === p.id;
  const candidates = PERSONAL_EVENTS.filter((e) => (e.good ? !isLeader : !isLast));
  const m = roundMult(state.round);
  for (let tries = 0; tries < 6; tries++) {
    const e = pick(state.rng, candidates);
    const text = e.apply(state, p, m);
    if (text) return { text, good: e.good };
  }
  return null;
}

/** Choose this round's colony event (or none). Effects are applied by production. */
export function rollColonyEvent(state: GameState, chanceOf: number, rng: RngState = state.rng): ColonyEvent | null {
  if (!chance(rng, chanceOf)) return null;
  const types: ColonyEvent['type'][] = ['pests', 'acidrain', 'sunspot', 'quake', 'meteorite', 'radiation', 'fire'];
  if (state.config.difficulty !== 'beginner' && state.players.some((p) => p.goods.crystite > 0)) types.push('pirates');
  if (state.config.difficulty === 'beginner') {
    // No crystite in beginner games, so no meteorites.
    types.splice(types.indexOf('meteorite'), 1);
  }
  for (let tries = 0; tries < 6; tries++) {
    const type = pick(rng, types);
    const ev = buildColonyEvent(state, type, rng);
    if (ev) return ev;
  }
  return null;
}

function buildColonyEvent(state: GameState, type: ColonyEvent['type'], rng: RngState): ColonyEvent | null {
  switch (type) {
    case 'pests': {
      const plots = state.map.filter((p) => p.mule === 'food');
      if (!plots.length) return null;
      const p = pick(rng, plots);
      return { type, plot: p.index, playerId: p.owner!, text: `Pests attacked ${state.players[p.owner!]!.name}'s farm. Its food crop was destroyed.` };
    }
    case 'pirates':
      return { type, text: 'Space pirates raided the colony and stole every unit of crystite.' };
    case 'acidrain': {
      const row = int(rng, 0, MAP_ROWS - 1);
      return { type, row, text: 'An acid rain storm swept across the colony. Food plots in its path grew more, energy plots made less.' };
    }
    case 'sunspot':
      return { type, text: 'Sunspot activity boosted the output of every solar collector.' };
    case 'quake':
      return { type, text: 'A planetquake shook the colony. Mining production was cut in half.' };
    case 'meteorite': {
      const candidates = state.map.filter((p) => p.terrain !== 'town');
      const p = pick(rng, candidates);
      return { type, plot: p.index, text: 'A meteorite struck the planet, leaving a rich crystite deposit behind.' };
    }
    case 'radiation': {
      const plots = state.map.filter((p) => p.mule !== null);
      if (!plots.length) return null;
      const p = pick(rng, plots);
      return { type, plot: p.index, playerId: p.owner!, text: `Radiation sent one of ${state.players[p.owner!]!.name}'s MULEs berserk. It ran off into space.` };
    }
    case 'fire':
      if (Object.values(state.store.stock).every((v) => v === 0)) return null;
      return { type, text: 'Fire broke out in the store. Its entire stock of goods was lost.' };
  }
}

/** Effects that happen before production numbers are computed. */
export function applyColonyEventBefore(state: GameState, ev: ColonyEvent): void {
  if (ev.type === 'radiation' && ev.plot !== undefined) {
    state.map[ev.plot]!.mule = null;
  }
  if (ev.type === 'meteorite' && ev.plot !== undefined) {
    const p = state.map[ev.plot]!;
    p.mule = null;
    seedCrystite(state.map, ev.plot, state.rng);
    p.crystite = 4;
  }
}

/** Per-plot production modifier from the event. */
export function eventProductionModifier(state: GameState, ev: ColonyEvent | null, plotIndex: number, value: number): number {
  if (!ev) return value;
  const p = state.map[plotIndex]!;
  switch (ev.type) {
    case 'pests': return ev.plot === plotIndex ? 0 : value;
    case 'acidrain':
      if (p.row !== ev.row) return value;
      if (p.mule === 'food') return value + 4;
      if (p.mule === 'energy') return Math.max(0, value - 2);
      return value;
    case 'sunspot': return p.mule === 'energy' ? value + 3 : value;
    case 'quake':
      return p.mule === 'smithore' || p.mule === 'crystite' ? Math.floor(value / 2) : value;
    default: return value;
  }
}

/** Effects after production has been added to inventories. */
export function applyColonyEventAfter(state: GameState, ev: ColonyEvent): void {
  if (ev.type === 'pirates') for (const p of state.players) p.goods.crystite = 0;
  if (ev.type === 'fire') for (const r of Object.keys(state.store.stock) as Resource[]) state.store.stock[r] = 0;
}

/** Wampus: hides in a mountain, blinking into view now and then. */
export function moveWampus(state: GameState): number | null {
  const mountains = state.map.filter((p) => isMountain(p.terrain));
  if (!mountains.length) return null;
  return pick(state.rng, mountains).index;
}

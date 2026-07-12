// AI opponents. Each bot has a personality that shifts its thresholds around
// a common core: preflop uses the Chen formula + position, postflop uses
// Monte Carlo equity vs. pot odds, with aggression and bluffing mixed in.

import { chenScore, positionOf, positionName, POSITION_LOOSEN, OPEN_THRESHOLDS } from './strategy.js';
import { estimateEquity } from './equity.js';

export const PERSONALITIES = {
  rock: {
    key: 'rock', style: 'Tight & careful',
    tight: 0.85, aggr: 0.3, bluff: 0.04, call: 0.2,
    blurb: 'Plays very few hands. When this player bets big, believe them.',
  },
  tag: {
    key: 'tag', style: 'Tight-aggressive',
    tight: 0.65, aggr: 0.78, bluff: 0.12, call: 0.3,
    blurb: 'Selective but forceful — the classic winning style.',
  },
  lag: {
    key: 'lag', style: 'Loose & wild',
    tight: 0.22, aggr: 0.85, bluff: 0.3, call: 0.5,
    blurb: 'Raises constantly with all kinds of hands. Call down lighter.',
  },
  station: {
    key: 'station', style: 'Calling station',
    tight: 0.3, aggr: 0.12, bluff: 0.03, call: 0.9,
    blurb: 'Hates folding. Value bet relentlessly, and don\'t bluff.',
  },
  prof: {
    key: 'prof', style: 'Solid all-round',
    tight: 0.55, aggr: 0.6, bluff: 0.1, call: 0.35,
    blurb: 'Balanced and hard to exploit. Pick your battles.',
  },
};

function clampShove(amount, ctx) {
  // If a raise commits most of the stack, just move all-in.
  const max = ctx.maxRaiseTo;
  if (amount >= max * 0.6) return max;
  return amount;
}

function raiseAction(amount, ctx) {
  const amt = Math.max(ctx.minRaiseTo, Math.min(Math.round(amount / 5) * 5, ctx.maxRaiseTo));
  return { type: 'raise', amount: clampShove(amt, ctx) };
}

export function decideAction(p, ctx, rng = Math.random) {
  const s = p.personality;
  if (ctx.street === 'preflop') return preflop(p, ctx, s, rng);
  return postflop(p, ctx, s, rng);
}

function preflop(p, ctx, s, rng) {
  const chen = chenScore(p.cards);
  const pos = positionName(positionOf(ctx.seatIdx, ctx.dealerIdx, ctx.numSeats));
  const loosen = POSITION_LOOSEN[pos] ?? 1;
  const tightAdj = (s.tight - 0.5) * 3; // -0.9 .. +1.05 Chen points

  const unraised = ctx.currentBet <= ctx.bb;
  const stack = p.stack + p.bet;

  if (unraised) {
    const openTh = (OPEN_THRESHOLDS[pos] ?? 8) - loosen * 0.6 + tightAdj;
    if (chen >= openTh || rng() < s.bluff * 0.25) {
      // Standard open ~3bb, a bit more if people limped in.
      const limpMoney = ctx.pot - ctx.sb - ctx.bb;
      return raiseAction(ctx.bb * 3 + Math.max(0, limpMoney), ctx);
    }
    if (ctx.canCheck) return { type: 'check' };
    // Limping range for loose/passive players, or completing the small blind.
    if (chen >= openTh - 2.5 && rng() < s.call) return { type: 'call' };
    if (ctx.toCall <= ctx.bb && chen >= 5.5 && rng() < 0.5 + s.call * 0.4) return { type: 'call' };
    return { type: 'fold' };
  }

  // Facing a raise.
  if (ctx.toCall >= p.stack) {
    // Facing an all-in-sized bet: strict.
    const need = 10.5 - s.call * 2;
    return chen >= need ? { type: 'call' } : { type: 'fold' };
  }

  const threeBetTh = 11.5 - s.aggr * 1.5 + tightAdj * 0.5;
  if (chen >= threeBetTh && rng() < 0.55 + s.aggr * 0.3) {
    return raiseAction(ctx.currentBet * 3, ctx);
  }
  const callTh = 9 + tightAdj - loosen * 0.4 + (ctx.toCall > ctx.bb * 6 ? 1.2 : 0);
  if (chen >= callTh) return { type: 'call' };
  // Set mining / speculative calls when the price is small.
  const isPair = p.cards[0].r === p.cards[1].r;
  if (isPair && ctx.toCall <= stack * 0.08) return { type: 'call' };
  if (chen >= 6.5 && ctx.toCall <= ctx.bb * 3 && rng() < s.call) return { type: 'call' };
  if (rng() < s.bluff * 0.12) return raiseAction(ctx.currentBet * 3, ctx);
  return { type: 'fold' };
}

function postflop(p, ctx, s, rng) {
  const oppCount = Math.min(ctx.opponents, 3);
  const eq = estimateEquity(p.cards, ctx.board, oppCount, 150, rng);
  const multi = 0.045 * (ctx.opponents - 1);

  if (ctx.toCall === 0) {
    const betTh = 0.47 + (0.5 - s.aggr) * 0.18 + multi;
    if (eq > betTh && rng() < 0.45 + s.aggr * 0.45) {
      const frac = 0.45 + s.aggr * 0.35 + rng() * 0.15;
      return raiseAction(ctx.pot * frac, ctx);
    }
    const bluffChance = s.bluff * (ctx.street === 'river' ? 0.7 : 1) * (ctx.opponents <= 2 ? 1 : 0.3);
    if (eq < betTh && rng() < bluffChance) {
      return raiseAction(ctx.pot * (0.5 + rng() * 0.3), ctx);
    }
    return { type: 'check' };
  }

  const required = ctx.toCall / (ctx.pot + ctx.toCall);
  const cushion = (s.tight - 0.5) * 0.09 - s.call * 0.11;
  const raiseTh = 0.62 + (0.5 - s.aggr) * 0.1 + multi;

  if (eq > raiseTh && rng() < s.aggr * 0.75 && ctx.canRaise) {
    return raiseAction(ctx.currentBet * 2.2 + ctx.pot * 0.4, ctx);
  }
  if (eq >= required + cushion) return { type: 'call' };
  // Occasional light peel on early streets when the bet is small.
  if (ctx.street !== 'river' && ctx.toCall <= ctx.pot * 0.4 && rng() < s.call * 0.25) {
    return { type: 'call' };
  }
  // Rare bluff-raise.
  if (rng() < s.bluff * 0.12 && ctx.street !== 'river' && ctx.canRaise) {
    return raiseAction(ctx.currentBet * 2.5 + ctx.pot * 0.5, ctx);
  }
  return { type: 'fold' };
}

// Poker hand evaluation. evaluate5/evaluate7 return { v, cat, tie } where `v`
// is a single comparable number (higher wins), `cat` is the hand category
// 0..8, and `tie` holds the ranks that break ties, most significant first.

import { RANK_WORD, RANK_PLURAL } from './cards.js';

export const CAT_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

export function evaluate5(cs) {
  const rs = cs.map((c) => c.r).sort((a, b) => b - a);
  const isFlush = cs.every((c) => c.s === cs[0].s);

  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  const counts = new Map();
  for (const r of rs) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()]
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);

  let cat;
  let tie;
  if (isFlush && straightHigh) {
    cat = 8; tie = [straightHigh];
  } else if (groups[0].n === 4) {
    cat = 7; tie = [groups[0].r, groups[1].r];
  } else if (groups[0].n === 3 && groups[1].n >= 2) {
    cat = 6; tie = [groups[0].r, groups[1].r];
  } else if (isFlush) {
    cat = 5; tie = rs;
  } else if (straightHigh) {
    cat = 4; tie = [straightHigh];
  } else if (groups[0].n === 3) {
    cat = 3; tie = [groups[0].r, groups[1].r, groups[2].r];
  } else if (groups[0].n === 2 && groups[1].n === 2) {
    cat = 2; tie = [groups[0].r, groups[1].r, groups[2].r];
  } else if (groups[0].n === 2) {
    cat = 1; tie = [groups[0].r, groups[1].r, groups[2].r, groups[3].r];
  } else {
    cat = 0; tie = rs;
  }

  let v = cat;
  const t = tie.slice();
  while (t.length < 5) t.push(0);
  for (const x of t) v = v * 15 + x;
  return { v, cat, tie };
}

// Evaluates the best 5-card hand from 5, 6 or 7 cards.
export function evaluate7(cards) {
  const n = cards.length;
  if (n === 5) return evaluate5(cards);
  let best = null;
  if (n === 6) {
    for (let i = 0; i < 6; i++) {
      const e = evaluate5(cards.filter((_, k) => k !== i));
      if (!best || e.v > best.v) best = e;
    }
    return best;
  }
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const e = evaluate5(cards.filter((_, k) => k !== i && k !== j));
      if (!best || e.v > best.v) best = e;
    }
  }
  return best;
}

export function describeHand(e) {
  const { cat, tie } = e;
  switch (cat) {
    case 8: return tie[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_WORD[tie[0]]} high`;
    case 7: return `Four of a Kind, ${RANK_PLURAL[tie[0]]}`;
    case 6: return `Full House, ${RANK_PLURAL[tie[0]]} full of ${RANK_PLURAL[tie[1]]}`;
    case 5: return `Flush, ${RANK_WORD[tie[0]]} high`;
    case 4: return `Straight, ${RANK_WORD[tie[0]]} high`;
    case 3: return `Three of a Kind, ${RANK_PLURAL[tie[0]]}`;
    case 2: return `Two Pair, ${RANK_PLURAL[tie[0]]} and ${RANK_PLURAL[tie[1]]}`;
    case 1: return `Pair of ${RANK_PLURAL[tie[0]]}`;
    default: return `High Card, ${RANK_WORD[tie[0]]}`;
  }
}

// Monte Carlo equity estimation: how often the hero's hand wins (counting
// split pots fractionally) against `oppCount` random hands, given the board.

import { makeDeck } from './cards.js';
import { evaluate7 } from './evaluator.js';

export function estimateEquity(hole, board, oppCount, trials = 200, rng = Math.random) {
  const known = new Set([...hole, ...board].map((c) => c.r * 4 + c.s));
  const deck = makeDeck().filter((c) => !known.has(c.r * 4 + c.s));
  const need = oppCount * 2 + (5 - board.length);
  let sum = 0;

  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only the first `need` positions must be random.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    let k = 0;
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(deck[k++]);

    const hero = evaluate7([...hole, ...fullBoard]).v;
    let beaten = false;
    let tieCount = 1;
    for (let o = 0; o < oppCount; o++) {
      const ov = evaluate7([deck[k], deck[k + 1], ...fullBoard]).v;
      k += 2;
      if (ov > hero) { beaten = true; break; }
      if (ov === hero) tieCount++;
    }
    if (!beaten) sum += 1 / tieCount;
  }
  return sum / trials;
}

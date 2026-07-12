// Engine test harness: evaluator correctness + full-game simulation checks
// (chip conservation, no negative stacks, pots always awarded).
// Run with: node tests/run-tests.mjs

import { evaluate7, evaluate5, describeHand } from '../js/evaluator.js';
import { estimateEquity } from '../js/equity.js';
import { chenScore } from '../js/strategy.js';
import { Game } from '../js/game.js';
import { PERSONALITIES, decideAction } from '../js/ai.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}

// Deterministic RNG so failures are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = (str) => {
  const ranks = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const suits = { s: 0, h: 1, d: 2, c: 3 };
  return { r: ranks[str[0]], s: suits[str[1]] };
};
const H = (str) => str.split(' ').map(C);

console.log('== Evaluator ==');
{
  const cases = [
    ['As Ks Qs Js Ts', 8, 'Royal Flush'],
    ['9h 8h 7h 6h 5h', 8, 'Straight Flush, Nine high'],
    ['9s 9h 9d 9c 2s', 7, 'Four of a Kind, Nines'],
    ['Ks Kh Kd 2s 2h', 6, 'Full House, Kings full of Twos'],
    ['As Js 9s 5s 2s', 5, 'Flush, Ace high'],
    ['9s 8h 7d 6c 5s', 4, 'Straight, Nine high'],
    ['As 2h 3d 4c 5s', 4, 'Straight, Five high'],
    ['7s 7h 7d Kc 2s', 3, 'Three of a Kind, Sevens'],
    ['As Ah 9d 9c 5s', 2, 'Two Pair, Aces and Nines'],
    ['Qs Qh 9d 7c 5s', 1, 'Pair of Queens'],
    ['As Kh 9d 7c 5s', 0, 'High Card, Ace'],
  ];
  for (const [hand, cat, name] of cases) {
    const e = evaluate5(H(hand));
    check(e.cat === cat, `${hand} category ${e.cat} != ${cat}`);
    check(describeHand(e) === name, `${hand} described as "${describeHand(e)}" != "${name}"`);
  }

  // Comparisons.
  const beats = (a, b) => evaluate7(H(a)).v > evaluate7(H(b)).v;
  check(beats('As Ah Kd Kc 2s 3h 4d', 'As Ah Qd Qc Ks 3h 4d'), 'AAKK beats AAQQ');
  check(beats('6s 7s 8s 9s Ts 2h 2d', '9s 9h 9d 9c As 2h 3d'), 'straight flush beats quads');
  check(beats('Ks Qs Js Ts 9s 2h 2d', 'As 2s 3s 4s 5s Kh Kd'), 'K-high SF beats 5-high SF');
  // Kicker plays across 7 cards.
  check(beats('As Ah Kd 9c 5s 3h 2d', 'Ad Ac Qd 9h 5c 3s 2h'), 'AA K-kicker beats AA Q-kicker');
  // Board plays: identical values.
  const b1 = evaluate7(H('2s 3h As Kh Qd Jc Th')).v;
  const b2 = evaluate7(H('4d 5c As Kh Qd Jc Th')).v;
  check(b1 === b2, 'board straight ties');
  // Wheel loses to 6-high straight.
  check(beats('6h 2d 3s 4h 5c Kd Kh', 'Ah 2h 3d 4s 5s Kc Ks'), '6-high straight beats wheel');
  console.log('  evaluator checks done');
}

console.log('== Chen formula ==');
{
  check(chenScore(H('As Ah')) === 20, 'AA = 20');
  check(chenScore(H('As Ks')) === 12, `AKs = 12 (got ${chenScore(H('As Ks'))})`);
  check(chenScore(H('Ts Js')) === 9, `JTs = 9 (got ${chenScore(H('Ts Js'))})`);
  check(chenScore(H('2s 7h')) === -1, `72o = -1 (got ${chenScore(H('2s 7h'))})`);
  check(chenScore(H('Ks Ah')) === 10, `AKo = 10 (got ${chenScore(H('Ks Ah'))})`);
  check(chenScore(H('5s 5h')) === 5, `55 = 5 (got ${chenScore(H('5s 5h'))})`);
  console.log('  chen checks done');
}

console.log('== Equity sanity ==');
{
  const rng = mulberry32(42);
  const eqAA = estimateEquity(H('As Ah'), [], 1, 2000, rng);
  check(eqAA > 0.8 && eqAA < 0.92, `AA vs 1 random ≈ 85% (got ${eqAA.toFixed(3)})`);
  const eq72 = estimateEquity(H('7s 2h'), [], 1, 2000, rng);
  check(eq72 > 0.25 && eq72 < 0.45, `72o vs 1 random ≈ 35% (got ${eq72.toFixed(3)})`);
  const nuts = estimateEquity(H('As Ks'), H('Qs Js Ts'), 2, 500, rng);
  check(nuts > 0.9, `royal flush equity ~1 (got ${nuts.toFixed(3)})`);
  console.log(`  AA=${eqAA.toFixed(3)} 72o=${eq72.toFixed(3)} nuts=${nuts.toFixed(3)}`);
}

console.log('== Game simulation ==');
{
  const rng = mulberry32(1234);
  const keys = Object.keys(PERSONALITIES);
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, avatar: '🤖', isHuman: false,
    stack: 1000, personality: PERSONALITIES[keys[i % keys.length]],
    inHand: false, folded: true, cards: [], bet: 0, committed: 0,
  }));

  const game = new Game({ players, sb: 5, bb: 10, aiDelay: 0, rng, hooks: {} });

  const HANDS = 3000;
  for (let h = 0; h < HANDS; h++) {
    for (const p of players) if (p.stack <= 0) p.stack = 1000; // rebuy like the app does
    const totalBefore = players.reduce((s, p) => s + p.stack, 0);
    await game.playHand();
    const totalAfter = players.reduce((s, p) => s + p.stack, 0);
    check(totalAfter === totalBefore, `hand ${h + 1}: chips not conserved (${totalBefore} -> ${totalAfter})`);
    for (const p of players) {
      check(p.stack >= 0, `hand ${h + 1}: ${p.name} has negative stack ${p.stack}`);
      check(p.committed === 0 || p.stack >= 0, 'sanity');
    }
    const potLeft = players.reduce((s, p) => s + p.committed, 0);
    const won = players.reduce((s, p) => s + p.wonAmount, 0);
    check(won === potLeft, `hand ${h + 1}: pot ${potLeft} vs awarded ${won}`);
    if (failures > 10) break;
  }
  console.log(`  simulated ${HANDS} hands`);
}

console.log('== AI action legality ==');
{
  const rng = mulberry32(7);
  // Spot check: AI never returns an illegal check when facing a bet.
  for (let i = 0; i < 500; i++) {
    const p = {
      cards: H('7s 2h'), stack: 500, bet: 0, committed: 0,
      personality: PERSONALITIES.station,
    };
    const ctx = {
      street: 'flop', board: H('As Kd 9c'), pot: 100, toCall: 50,
      canCheck: false, canRaise: true, currentBet: 50, minRaiseTo: 100,
      maxRaiseTo: 500, bb: 10, sb: 5, seatIdx: 0, dealerIdx: 1, numSeats: 6,
      opponents: 2, position: 'BTN', player: p,
    };
    const a = decideAction(p, ctx, rng);
    check(a.type !== 'check', 'AI checked facing a bet');
    if (a.type === 'raise') check(a.amount <= ctx.maxRaiseTo + 0.001, 'AI raise above max');
  }
  console.log('  legality checks done');
}

if (failures === 0) {
  console.log('\nAll tests passed ✔');
} else {
  console.error(`\n${failures} failure(s) ✘`);
  process.exit(1);
}

// Shared strategy helpers used by both the AI opponents and the coach.

import { RANK_CHAR, SUIT_SYMBOLS } from './cards.js';

// Chen formula: a classic points system for preflop starting-hand strength.
// Roughly: AA=20, AKs=12, AKo=10.5, JTs=7.5, 72o=1.
export function chenScore(hole) {
  const [a, b] = [...hole].sort((x, y) => y.r - x.r);
  const val = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = val(a.r);
  if (a.r === b.r) {
    score = Math.max(5, score * 2);
  } else {
    if (a.s === b.s) score += 2;
    const gap = a.r - b.r - 1;
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && a.r < 12) score += 1;
  }
  return Math.ceil(score);
}

export function handTier(score) {
  if (score >= 12) return 'Premium';
  if (score >= 10) return 'Strong';
  if (score >= 8) return 'Good';
  if (score >= 6) return 'Speculative';
  return 'Weak';
}

export function holeLabel(hole) {
  const [a, b] = [...hole].sort((x, y) => y.r - x.r);
  if (a.r === b.r) return `pocket pair`;
  const suited = a.s === b.s ? 'suited' : 'offsuit';
  const gap = a.r - b.r - 1;
  if (a.r >= 10 && b.r >= 10) return `${suited} broadway cards`;
  if (gap === 0) return `${suited} connectors`;
  if (gap <= 2) return `${suited} gapper`;
  return `${suited} unconnected cards`;
}

export function holeText(hole) {
  return hole.map((c) => RANK_CHAR[c.r] + SUIT_SYMBOLS[c.s]).join(' ');
}

// Position offset from the dealer: 0=BTN, 1=SB, 2=BB, 3=UTG, 4=HJ, 5=CO (6-max).
export const POSITION_NAMES_6 = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export function positionOf(seatIdx, dealerIdx, n) {
  return (seatIdx - dealerIdx + n) % n;
}

export function positionName(offset) {
  return POSITION_NAMES_6[offset] || `P${offset}`;
}

export const POSITION_NOTES = {
  BTN: 'Button — the best seat: you act last on every street after the flop, so you see everyone else\'s decision first.',
  SB: 'Small blind — the worst seat: you already paid half a blind and act first on every street after the flop.',
  BB: 'Big blind — you get a discount preflop (your blind counts toward a call), but you\'ll be out of position after the flop.',
  UTG: 'Under the gun — first to act preflop with the whole table behind you. Play only strong hands here.',
  HJ: 'Hijack — middle position. You can open a few more hands than UTG, but stay disciplined.',
  CO: 'Cutoff — late position. Only the button acts after you, so you can open a wider range.',
};

// How many extra Chen points of looseness each position affords.
export const POSITION_LOOSEN = { BTN: 2, CO: 1.5, HJ: 1, UTG: 0, SB: 0.5, BB: 1 };

// Chen threshold for a standard open-raise by position (solid baseline).
export const OPEN_THRESHOLDS = { UTG: 9, HJ: 8.5, CO: 7.5, BTN: 7, SB: 7.5, BB: 7 };

export function potOddsPct(toCall, pot) {
  return toCall / (pot + toCall);
}

// Human-readable notes about board texture (for the coach).
export function boardTexture(board) {
  if (board.length < 3) return [];
  const notes = [];

  const suitCounts = [0, 0, 0, 0];
  for (const c of board) suitCounts[c.s]++;
  const maxSuit = Math.max(...suitCounts);
  if (maxSuit >= 3) notes.push('Three or more of one suit — a flush is possible.');
  else if (maxSuit === 2 && board.length < 5) notes.push('Two of one suit — someone may be drawing to a flush.');

  const rs = board.map((c) => c.r);
  const uniq = [...new Set(rs)];
  if (uniq.length < rs.length) notes.push('The board is paired — full houses and trips are possible.');

  const sorted = [...uniq].sort((a, b) => a - b);
  let connected = false;
  for (let i = 0; i + 2 < sorted.length; i++) {
    if (sorted[i + 2] - sorted[i] <= 4) connected = true;
  }
  if (connected) notes.push('The cards are close together — straights and straight draws are live.');

  const high = Math.max(...rs);
  if (high >= 13) notes.push('A high board like this often connects with a raiser\'s range.');
  else if (high <= 9) notes.push('A low board like this misses most raising hands — high pairs still rule, but be alert.');

  return notes;
}

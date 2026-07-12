// The coach: turns the current decision into learning cues — position, hand
// strength, pot odds vs. equity, board texture, thinking prompts — plus a
// concrete suggested play with reasons (solid tight-aggressive baseline).

import { estimateEquity } from './equity.js';
import {
  chenScore, handTier, holeLabel, holeText,
  POSITION_NOTES, OPEN_THRESHOLDS, potOddsPct, boardTexture,
} from './strategy.js';

const PROMPTS = {
  preflop: [
    'Who has entered the pot before you, and are they tight or loose?',
    'If you raise and get re-raised, will you be happy with this hand?',
    'How does your position change which hands are worth playing?',
  ],
  flop: [
    'Did this flop hit YOUR hand — and would it hit the hands your opponents play?',
    'If you\'re drawing, count your outs: roughly outs × 4 = your % chance by the river.',
    'What is the worst hand that might still pay you off if you bet?',
  ],
  turn: [
    'Did the turn card change who has the best hand? New flushes or straights possible?',
    'If you\'re drawing now, it\'s roughly outs × 2 = your % chance on the river.',
    'Is your opponent\'s betting story consistent across streets?',
  ],
  river: [
    'No more cards are coming — you either have the best hand or you don\'t.',
    'If you bet, what worse hands call? If you call, what bluffs is your opponent representing?',
    'Pot odds on a call: you only need to be right that fraction of the time.',
  ],
};

export function buildCues(ctx) {
  const p = ctx.player;
  const items = [];
  const chen = chenScore(p.cards);
  const tier = handTier(chen);

  // Equity vs. random hands (capped opponents for stable numbers).
  const oppCount = Math.max(1, Math.min(ctx.opponents, 4));
  const equity = estimateEquity(p.cards, ctx.board, oppCount, 400);

  // 1. Your hand.
  if (ctx.street === 'preflop') {
    items.push({
      icon: '🂡', title: 'Your hand',
      text: `${holeText(p.cards)} — ${holeLabel(p.cards)}. ${tier} starting hand (Chen score ${chen}).`,
    });
  } else {
    items.push({
      icon: '🂡', title: 'Your hand now',
      text: `${holeText(p.cards)} on this board. Estimated ~${Math.round(equity * 100)}% to win vs. ${oppCount} random hand${oppCount > 1 ? 's' : ''} (real opponents play stronger-than-random hands, so treat this as optimistic).`,
    });
  }

  // 2. Position.
  items.push({ icon: '🧭', title: `Position: ${ctx.position}`, text: POSITION_NOTES[ctx.position] || '' });

  // 3. Pot odds when facing a bet.
  if (ctx.toCall > 0) {
    const req = potOddsPct(ctx.toCall, ctx.pot);
    items.push({
      icon: '⚖️', title: 'Pot odds',
      text: `Call ${ctx.toCall} to win a ${ctx.pot + ctx.toCall} pot → you need ~${Math.round(req * 100)}% equity to break even. Your rough equity: ~${Math.round(equity * 100)}%.`,
    });
  }

  // 4. Board texture.
  if (ctx.street !== 'preflop') {
    for (const note of boardTexture(ctx.board).slice(0, 2)) {
      items.push({ icon: '🃏', title: 'Board texture', text: note });
    }
  }

  // 5. Thinking prompts.
  const prompts = (PROMPTS[ctx.street] || []).slice(0, 2);

  return { items, prompts, equity, chen, suggestion: suggest(ctx, chen, equity) };
}

// A deterministic, solid baseline recommendation with reasons.
function suggest(ctx, chen, equity) {
  const p = ctx.player;
  if (ctx.street === 'preflop') return suggestPreflop(ctx, chen);

  const eqPct = Math.round(equity * 100);
  if (ctx.toCall > 0) {
    const req = potOddsPct(ctx.toCall, ctx.pot);
    const reqPct = Math.round(req * 100);
    if (equity >= 0.66 && ctx.canRaise) {
      return {
        action: 'raise', amount: Math.round((ctx.currentBet * 2.5 + ctx.pot * 0.3) / 5) * 5,
        label: 'Raise',
        reasons: [
          `Your ~${eqPct}% equity is strong — raising builds a pot you usually win.`,
          'Raising also charges any draws that are trying to beat you cheaply.',
        ],
      };
    }
    if (equity >= req + 0.03) {
      return {
        action: 'call', label: `Call ${ctx.toCall}`,
        reasons: [
          `You need ~${reqPct}% equity to call and you have roughly ${eqPct}% — the price is right.`,
          'Your hand isn\'t strong enough to raise for value, so calling keeps weaker hands in.',
        ],
      };
    }
    return {
      action: 'fold', label: 'Fold',
      reasons: [
        `You need ~${reqPct}% equity to call but only have roughly ${eqPct}%.`,
        'Folding costs nothing extra — losing the minimum on bad spots is how you win long-term.',
      ],
    };
  }

  const multi = 0.04 * (ctx.opponents - 1);
  if (equity >= 0.56 + multi) {
    return {
      action: 'raise', amount: Math.round((ctx.pot * 0.66) / 5) * 5,
      label: 'Bet ~⅔ pot',
      reasons: [
        `With ~${eqPct}% equity you likely have the best hand — bet for value.`,
        'Checking lets draws see free cards and misses value from worse hands.',
      ],
    };
  }
  return {
    action: 'check', label: 'Check',
    reasons: [
      `Your ~${eqPct}% equity is marginal — keep the pot small.`,
      'Checking lets you see what opponents do and avoids bloating the pot out of position.',
    ],
  };
}

function suggestPreflop(ctx, chen) {
  const p = ctx.player;
  const unraised = ctx.currentBet <= ctx.bb;
  const openTh = OPEN_THRESHOLDS[ctx.position] ?? 8;

  if (unraised) {
    if (chen >= openTh) {
      const amount = ctx.bb * 3 + Math.max(0, ctx.pot - ctx.sb - ctx.bb);
      return {
        action: 'raise', amount, label: `Raise to ${amount}`,
        reasons: [
          `Chen score ${chen} clears the ~${openTh} bar for opening from the ${ctx.position}.`,
          'Raising (not limping) puts pressure on the blinds and takes control of the pot.',
        ],
      };
    }
    if (ctx.canCheck) {
      return {
        action: 'check', label: 'Check',
        reasons: ['Not a hand worth raising, but the flop is free — take it.'],
      };
    }
    return {
      action: 'fold', label: 'Fold',
      reasons: [
        `Chen score ${chen} is below the ~${openTh} opening bar for the ${ctx.position}.`,
        'Tight preflop play from early position is the single fastest fix for most beginners.',
      ],
    };
  }

  // Facing a raise.
  if (chen >= 12) {
    const amount = Math.round((ctx.currentBet * 3) / 5) * 5;
    return {
      action: 'raise', amount, label: `Re-raise to ${amount}`,
      label2: 'Re-raise',
      reasons: [
        'Premium hand — re-raise for value; flat-calling lets weak hands in cheaply.',
        'If you get shoved on, this hand is usually still happy.',
      ],
    };
  }
  const isPair = p.cards[0].r === p.cards[1].r;
  if (isPair && chen < 9 && ctx.toCall <= (p.stack + p.bet) * 0.08) {
    return {
      action: 'call', label: `Call ${ctx.toCall}`,
      reasons: [
        'Small pair vs. a raise: call cheaply to try to flop three of a kind ("set mining").',
        'You\'ll flop a set ~12% of the time — it only works when the call is small vs. the stacks.',
      ],
    };
  }
  if (chen >= 9.5) {
    return {
      action: 'call', label: `Call ${ctx.toCall}`,
      reasons: [
        `Chen ${chen} is strong enough to continue, but not a clear re-raise vs. a real raise.`,
        'See a flop and re-evaluate — position will matter a lot here.',
      ],
    };
  }
  return {
    action: 'fold', label: 'Fold',
    reasons: [
      `Someone raised, which means a strong range — Chen ${chen} doesn't justify the price.`,
      'Calling raises with weak hands "just to see a flop" is the biggest money leak in poker.',
    ],
  };
}

// Compare the human's action with the coach suggestion (for feedback lines).
export function actionMatches(action, suggestion) {
  if (!suggestion) return true;
  const norm = (t) => (t === 'check' || t === 'call' ? 'passive' : t);
  return norm(action.type) === norm(suggestion.action);
}

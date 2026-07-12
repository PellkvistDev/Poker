// App bootstrap: wires the engine, AI, coach and UI together and owns the
// bankroll + persistence.

import { Game } from './game.js';
import { PERSONALITIES } from './ai.js';
import { buildCues, actionMatches } from './coach.js';
import * as ui from './ui.js';

const SAVE_KEY = 'holdem-trainer-v1';
const BUY_IN = 1000;
const START_BANKROLL = 10000;
const SB = 5;
const BB = 10;

const $ = (id) => document.getElementById(id);

const saved = load();
const state = {
  bankroll: saved?.bankroll ?? START_BANKROLL, // off-table money
  stack: saved?.stack ?? 0,                    // chips currently at the table
  coachOn: saved?.coachOn ?? true,
  stats: saved?.stats ?? { hands: 0, won: 0, buyIns: 0, coachAgree: 0, coachTotal: 0 },
  seated: (saved?.stack ?? 0) > 0,
};

function load() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function save() {
  state.stack = human.stack;
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    bankroll: state.bankroll,
    stack: human.stack,
    coachOn: state.coachOn,
    stats: state.stats,
  }));
}
function profit() {
  return state.bankroll + human.stack - START_BANKROLL;
}

/* ===== Players ===== */

const human = {
  id: 'you', name: 'You', avatar: '🙂', isHuman: true,
  stack: state.stack, personality: null,
  inHand: false, folded: true, cards: [], bet: 0, committed: 0,
};

const bots = [
  { id: 'rocky', name: 'Rocky', avatar: '🪨', personality: PERSONALITIES.rock },
  { id: 'tanya', name: 'Tanya', avatar: '🦈', personality: PERSONALITIES.tag },
  { id: 'loco', name: 'Loco', avatar: '🃏', personality: PERSONALITIES.lag },
  { id: 'callie', name: 'Callie', avatar: '📞', personality: PERSONALITIES.station },
  { id: 'prof', name: 'Prof', avatar: '🎩', personality: PERSONALITIES.prof },
].map((b) => ({
  ...b, isHuman: false, stack: 1000,
  inHand: false, folded: true, cards: [], bet: 0, committed: 0,
}));

const players = [human, ...bots];

/* ===== Engine hooks ===== */

let lastCues = null;

const game = new Game({
  players, sb: SB, bb: BB,
  hooks: {
    render: () => ui.renderTable(game),
    log: (text, cls) => ui.logLine(text, cls),
    getHumanAction: async (ctx) => {
      if (state.coachOn) {
        lastCues = buildCues(ctx);
        ui.renderCoach(lastCues);
      } else {
        lastCues = null;
        ui.renderCoachIdle(false);
      }
      const action = await ui.promptAction(ctx);
      if (lastCues?.suggestion) {
        state.stats.coachTotal++;
        if (actionMatches(action, lastCues.suggestion)) {
          state.stats.coachAgree++;
        } else {
          ui.logLine(`Coach would have chosen: ${lastCues.suggestion.label.toLowerCase()}`, 'coach');
        }
      }
      return action;
    },
  },
});

/* ===== Main loop ===== */

let dealResolve = null;

async function mainLoop() {
  for (;;) {
    // Bots that busted "rebuy" between hands, so the table stays full.
    for (const b of bots) {
      if (b.stack <= 0) {
        b.stack = 1000;
        ui.logLine(`${b.name} rebuys for $1,000`, undefined);
      }
    }

    if (human.stack <= 0) {
      await handleBust();
    }

    ui.setTableMsg('');
    await game.playHand();

    state.stats.hands++;
    if (human.wonAmount > 0) state.stats.won++;
    save();
    refreshHeader();
    ui.renderCoachIdle(state.coachOn);

    if (human.wonAmount > 0) ui.setTableMsg(`You won ${ui.fmt(human.wonAmount)}! 🎉`);

    if ($('auto-deal').checked && human.stack > 0) {
      await new Promise((r) => setTimeout(r, 2600));
    } else {
      ui.showDealBar(true);
      await new Promise((r) => { dealResolve = r; });
      ui.showDealBar(false);
    }
  }
}

function handleBust() {
  return new Promise((resolve) => {
    const canRebuy = state.bankroll >= BUY_IN;
    $('bust-text').textContent = canRebuy
      ? `That happens to everyone. Your bankroll has ${ui.fmt(state.bankroll)} left — grab another $1,000 and think about what you'd do differently.`
      : 'Your bankroll is empty too. No real money was harmed — reset and keep learning.';
    $('btn-rebuy').classList.toggle('hidden', !canRebuy);
    $('btn-reset-bankroll').classList.toggle('hidden', canRebuy);
    ui.showOverlay('overlay-bust', true);

    $('btn-rebuy').onclick = () => {
      state.bankroll -= BUY_IN;
      human.stack = BUY_IN;
      state.stats.buyIns++;
      ui.showOverlay('overlay-bust', false);
      save();
      refreshHeader();
      resolve();
    };
    $('btn-reset-bankroll').onclick = () => {
      state.bankroll = START_BANKROLL - BUY_IN;
      human.stack = BUY_IN;
      state.stats = { hands: 0, won: 0, buyIns: 1, coachAgree: 0, coachTotal: 0 };
      ui.showOverlay('overlay-bust', false);
      save();
      refreshHeader();
      resolve();
    };
  });
}

function refreshHeader() {
  ui.updateHeader({
    bankroll: state.bankroll,
    stats: { hands: state.stats.hands, won: state.stats.won, profit: profit() },
    coachOn: state.coachOn,
  });
}

/* ===== Static UI wiring ===== */

ui.initActionBar();
ui.initSideTabs();

$('btn-deal').addEventListener('click', () => { dealResolve?.(); dealResolve = null; });

$('btn-coach').addEventListener('click', () => {
  state.coachOn = !state.coachOn;
  save();
  refreshHeader();
  ui.renderCoachIdle(state.coachOn);
});

$('btn-guide').addEventListener('click', () => ui.showOverlay('overlay-guide', true));
$('btn-guide-close').addEventListener('click', () => ui.showOverlay('overlay-guide', false));
$('overlay-guide').addEventListener('click', (e) => {
  if (e.target.id === 'overlay-guide') ui.showOverlay('overlay-guide', false);
});

$('btn-cashout').addEventListener('click', () => {
  if (game.street !== 'idle') {
    ui.setTableMsg('Finish the current hand before cashing out.');
    return;
  }
  if (human.stack > 0) {
    state.bankroll += human.stack;
    human.stack = 0;
    save();
    refreshHeader();
  }
  location.reload();
});

$('btn-sit').addEventListener('click', () => {
  if (human.stack <= 0) {
    const buy = Math.min(BUY_IN, state.bankroll);
    state.bankroll -= buy;
    human.stack = buy;
    state.stats.buyIns++;
  }
  save();
  ui.showOverlay('overlay-welcome', false);
  refreshHeader();
  mainLoop();
});

/* ===== Boot ===== */

refreshHeader();
ui.renderCoachIdle(state.coachOn);
ui.renderTable(game);

if (state.seated && state.bankroll + human.stack > 0) {
  // Returning player with chips still on the table: skip the welcome modal.
  mainLoop();
} else {
  if (state.bankroll < BUY_IN && human.stack <= 0) {
    // Fully broke returning player: top the bankroll back up.
    state.bankroll = START_BANKROLL;
  }
  ui.showOverlay('overlay-welcome', true);
}

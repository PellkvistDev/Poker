// All DOM work lives here. The engine stays DOM-free and talks to this
// module through main.js.

import { RANK_CHAR, SUIT_SYMBOLS, isRed } from './cards.js';
import { positionOf, positionName } from './strategy.js';

const $ = (id) => document.getElementById(id);
export const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

function cardEl(c, small = false) {
  const div = document.createElement('div');
  div.className = `card${isRed(c) ? ' red' : ''}${small ? ' small' : ''}`;
  div.innerHTML = `<span class="rank">${RANK_CHAR[c.r]}</span><span class="suit">${SUIT_SYMBOLS[c.s]}</span>`;
  return div;
}

function cardBack(small = false) {
  const div = document.createElement('div');
  div.className = `card back${small ? ' small' : ''}`;
  return div;
}

export function renderTable(game) {
  const seats = $('seats');
  seats.innerHTML = '';
  const showdown = game.street === 'showdown' || game.street === 'idle';

  game.players.forEach((p, idx) => {
    const seat = document.createElement('div');
    seat.className = `seat seat-${idx}`;
    if (idx === game.actingIdx) seat.classList.add('acting');
    if (p.folded && p.inHand) seat.classList.add('folded');
    if (p.wonAmount > 0 && game.street === 'idle') seat.classList.add('winner');

    const cards = document.createElement('div');
    cards.className = 'cards';
    if (p.inHand && !p.folded && p.cards.length) {
      const small = !p.isHuman;
      if (p.isHuman || p.revealed) {
        for (const c of p.cards) cards.appendChild(cardEl(c, small));
      } else {
        cards.appendChild(cardBack(small));
        cards.appendChild(cardBack(small));
      }
    }
    seat.appendChild(cards);

    const plate = document.createElement('div');
    plate.className = 'plate';
    const pos = positionName(positionOf(idx, game.dealerIdx, game.n));
    plate.innerHTML = `
      <span class="avatar">${p.avatar}</span>
      <span class="meta">
        <span class="pname">${p.name}</span>
        <span class="pstyle">${p.isHuman ? 'That\'s you' : p.personality.style}</span>
        <span class="pstack">${fmt(p.stack)}</span>
      </span>
      <span class="pos-badge${pos === 'BTN' ? ' btn' : ''}">${pos}</span>`;
    seat.appendChild(plate);

    const tags = document.createElement('div');
    tags.className = 'seat-tags';
    if (p.bet > 0) tags.innerHTML += `<span class="bet-chip">${fmt(p.bet)}</span>`;
    if (p.lastAction) tags.innerHTML += `<div class="action-tag">${p.lastAction.label}</div>`;
    if (showdown && p.handDesc && !p.folded) tags.innerHTML += `<div class="hand-desc">${p.handDesc}</div>`;
    if (game.street === 'idle' && p.wonAmount > 0) tags.innerHTML += `<div class="hand-desc won-tag">+${fmt(p.wonAmount)}</div>`;
    seat.appendChild(tags);

    seats.appendChild(seat);
  });

  const board = $('board');
  board.innerHTML = '';
  for (const c of game.board) board.appendChild(cardEl(c));

  const pot = game.potTotal();
  const potEl = $('pot');
  if (pot > 0 || game.street !== 'idle') {
    potEl.classList.remove('hidden');
    potEl.textContent = `Pot: ${fmt(pot)}`;
  } else {
    potEl.classList.add('hidden');
  }
}

export function setTableMsg(text) {
  $('table-msg').textContent = text || '';
}

/* ===== Action bar ===== */

let pendingResolve = null;
let currentCtx = null;

export function initActionBar() {
  $('btn-fold').addEventListener('click', () => resolveAction({ type: 'fold' }));
  $('btn-check').addEventListener('click', () => resolveAction({ type: 'check' }));
  $('btn-call').addEventListener('click', () => resolveAction({ type: 'call' }));
  $('btn-raise').addEventListener('click', () => {
    resolveAction({ type: 'raise', amount: Number($('raise-slider').value) });
  });
  $('raise-slider').addEventListener('input', updateRaiseLabel);
  document.querySelectorAll('.quick-sizes button').forEach((b) => {
    b.addEventListener('click', () => {
      if (!currentCtx) return;
      const frac = b.dataset.frac;
      const slider = $('raise-slider');
      let target;
      if (frac === 'min') target = currentCtx.minRaiseTo;
      else if (frac === 'allin') target = currentCtx.maxRaiseTo;
      else target = currentCtx.currentBet + (currentCtx.pot + currentCtx.toCall) * Number(frac);
      target = Math.round(target / 5) * 5;
      slider.value = Math.max(currentCtx.minRaiseTo, Math.min(target, currentCtx.maxRaiseTo));
      updateRaiseLabel();
    });
  });
}

function updateRaiseLabel() {
  if (!currentCtx) return;
  const v = Number($('raise-slider').value);
  const isBet = currentCtx.currentBet === 0;
  const allIn = v >= currentCtx.maxRaiseTo;
  $('btn-raise').textContent = `${isBet ? 'Bet' : 'Raise to'} ${fmt(v)}${allIn ? ' (all-in)' : ''}`;
}

function resolveAction(action) {
  if (!pendingResolve) return;
  const resolve = pendingResolve;
  pendingResolve = null;
  currentCtx = null;
  $('action-bar').classList.add('hidden');
  resolve(action);
}

export function promptAction(ctx) {
  currentCtx = ctx;
  selectSideTab('coach'); // on small screens, bring the cues into view

  const bar = $('action-bar');
  bar.classList.remove('hidden');

  $('action-info').textContent =
    `Pot: ${fmt(ctx.pot)}` +
    (ctx.toCall > 0 ? ` · To call: ${fmt(ctx.toCall)}` : '') +
    ` · Your stack: ${fmt(ctx.player.stack)}`;

  $('btn-fold').classList.toggle('hidden', ctx.canCheck);
  $('btn-check').classList.toggle('hidden', !ctx.canCheck);
  const callBtn = $('btn-call');
  callBtn.classList.toggle('hidden', ctx.toCall <= 0);
  callBtn.textContent = `Call ${fmt(ctx.toCall)}${ctx.toCall >= ctx.player.stack ? ' (all-in)' : ''}`;

  const canRaise = ctx.canRaise;
  $('btn-raise').classList.toggle('hidden', !canRaise);
  $('raise-controls').classList.toggle('hidden', !canRaise);
  if (canRaise) {
    const slider = $('raise-slider');
    slider.min = ctx.minRaiseTo;
    slider.max = ctx.maxRaiseTo;
    slider.value = ctx.minRaiseTo;
    updateRaiseLabel();
  }

  return new Promise((resolve) => { pendingResolve = resolve; });
}

/* ===== Sidebar tabs (mobile only; both panels are visible on desktop) ===== */

export function initSideTabs() {
  $('tab-coach').addEventListener('click', () => selectSideTab('coach'));
  $('tab-log').addEventListener('click', () => selectSideTab('log'));
}

export function selectSideTab(name) {
  const sidebar = $('sidebar');
  sidebar.classList.toggle('show-coach', name === 'coach');
  sidebar.classList.toggle('show-log', name === 'log');
  $('tab-coach').classList.toggle('active', name === 'coach');
  $('tab-log').classList.toggle('active', name === 'log');
}

/* ===== Coach panel ===== */

export function renderCoachIdle(coachOn) {
  $('coach-body').innerHTML = coachOn
    ? '<p class="coach-idle">Cues appear here when it\'s your turn to act.</p>'
    : '<p class="coach-idle">Coach is off — you\'re flying solo. Toggle it back on any time.</p>';
}

export function renderCoach(cues) {
  const body = $('coach-body');
  body.innerHTML = '';

  const eqPct = Math.round(cues.equity * 100);
  const eqWrap = document.createElement('div');
  eqWrap.className = 'equity-bar-wrap';
  eqWrap.innerHTML = `
    <div class="equity-bar-label">Estimated win chance vs. random hands: <strong>${eqPct}%</strong></div>
    <div class="equity-bar"><div class="equity-fill" style="width:${eqPct}%"></div></div>`;
  body.appendChild(eqWrap);

  for (const item of cues.items) {
    const div = document.createElement('div');
    div.className = 'cue';
    div.innerHTML = `<span class="cue-icon">${item.icon}</span><span><span class="cue-title">${item.title}</span><span class="cue-text">${item.text}</span></span>`;
    body.appendChild(div);
  }

  if (cues.prompts.length) {
    const div = document.createElement('div');
    div.className = 'prompts';
    div.innerHTML = `<div class="prompts-title">Think about…</div><ul>${cues.prompts.map((p) => `<li>${p}</li>`).join('')}</ul>`;
    body.appendChild(div);
  }

  if (cues.suggestion) {
    const btn = document.createElement('button');
    btn.id = 'btn-suggest';
    btn.textContent = '💡 Show suggested play';
    body.appendChild(btn);
    const sug = document.createElement('div');
    sug.className = 'suggestion hidden';
    sug.innerHTML = `<div class="sug-action">Suggestion: ${cues.suggestion.label}</div><ul>${cues.suggestion.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>`;
    body.appendChild(sug);
    btn.addEventListener('click', () => {
      btn.classList.add('hidden');
      sug.classList.remove('hidden');
    });
  }
}

/* ===== Log ===== */

export function logLine(text, cls) {
  const log = $('log');
  const div = document.createElement('div');
  if (cls) div.className = `log-${cls}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 400) log.removeChild(log.firstChild);
}

/* ===== Header / overlays / deal bar ===== */

export function updateHeader({ bankroll, stats, coachOn }) {
  $('hdr-bankroll').textContent = fmt(bankroll);
  $('hdr-hands').textContent = stats.hands;
  $('hdr-won').textContent = stats.won;
  const pl = stats.profit;
  const plEl = $('hdr-pl');
  plEl.textContent = (pl >= 0 ? '+' : '−') + fmt(Math.abs(pl));
  plEl.style.color = pl >= 0 ? 'var(--green)' : 'var(--red)';
  const coachBtn = $('btn-coach');
  coachBtn.innerHTML = `🎓 <span class="pill-text">Coach: ${coachOn ? 'ON' : 'OFF'}</span>`;
  coachBtn.classList.toggle('on', coachOn);
}

export function showOverlay(id, show) {
  $(id).classList.toggle('hidden', !show);
}

export function showDealBar(show) {
  $('deal-bar').classList.toggle('hidden', !show);
}

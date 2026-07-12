// The Hold'em engine: deals hands, runs betting rounds, builds side pots and
// awards showdowns. It is DOM-free; the UI drives it through `hooks`:
//   render()                 – repaint the table
//   getHumanAction(ctx)      – resolve with the human's action
//   log(text, cls)           – append a line to the hand log
//   onHandEnd(summary)       – called after pots are awarded
// Actions are { type: 'fold'|'check'|'call'|'raise', amount? } where `amount`
// is the total to raise TO for this street (the engine clamps it to legal).

import { makeDeck, shuffle, cardText } from './cards.js';
import { evaluate7, describeHand } from './evaluator.js';
import { decideAction } from './ai.js';
import { positionOf, positionName } from './strategy.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Game {
  constructor({ players, sb, bb, hooks, aiDelay = 750, rng = Math.random }) {
    this.players = players;
    this.sb = sb;
    this.bb = bb;
    this.hooks = hooks;
    this.aiDelay = aiDelay;
    this.rng = rng;
    this.dealerIdx = Math.floor(rng() * players.length);
    this.handNo = 0;
    this.board = [];
    this.street = 'idle';
    this.actingIdx = -1;
    this.currentBet = 0;
    this.minRaise = bb;
  }

  get n() { return this.players.length; }
  potTotal() { return this.players.reduce((s, p) => s + p.committed, 0); }
  activePlayers() { return this.players.filter((p) => p.inHand && !p.folded); }

  render() { this.hooks.render?.(); }
  log(text, cls) { this.hooks.log?.(text, cls); }

  buildCtx(p) {
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    return {
      street: this.street,
      board: this.board,
      pot: this.potTotal(),
      toCall,
      canCheck: toCall === 0,
      canRaise: p.stack > toCall && this.currentBet < p.bet + p.stack,
      currentBet: this.currentBet,
      minRaiseTo: Math.min(this.currentBet + this.minRaise, p.bet + p.stack),
      maxRaiseTo: p.bet + p.stack,
      bb: this.bb,
      sb: this.sb,
      seatIdx: this.players.indexOf(p),
      dealerIdx: this.dealerIdx,
      numSeats: this.n,
      opponents: this.activePlayers().filter((o) => o !== p).length,
      position: positionName(positionOf(this.players.indexOf(p), this.dealerIdx, this.n)),
      raisers: this.raisers,
      player: p,
    };
  }

  // Moves chips from stack to the table; returns the amount actually paid.
  pay(p, amt) {
    const actual = Math.min(amt, p.stack);
    p.stack -= actual;
    p.bet += actual;
    p.committed += actual;
    if (p.stack === 0) p.allIn = true;
    return actual;
  }

  async playHand() {
    this.handNo++;
    this.deck = shuffle(makeDeck(), this.rng);
    this.board = [];
    this.street = 'preflop';
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.raisers = 0;

    for (const p of this.players) {
      p.inHand = p.stack > 0;
      p.cards = [];
      p.folded = !p.inHand;
      p.bet = 0;
      p.committed = 0;
      p.allIn = false;
      p.hasActed = false;
      p.lastAction = null;
      p.revealed = false;
      p.wonAmount = 0;
      p.handDesc = null;
      p.score = null;
    }

    this.dealerIdx = (this.dealerIdx + 1) % this.n;
    const sbIdx = (this.dealerIdx + 1) % this.n;
    const bbIdx = (this.dealerIdx + 2) % this.n;

    this.log(`— Hand #${this.handNo} — ${this.players[this.dealerIdx].name} has the button`, 'hand');

    const sbPaid = this.pay(this.players[sbIdx], this.sb);
    this.players[sbIdx].lastAction = { label: `SB ${sbPaid}` };
    const bbPaid = this.pay(this.players[bbIdx], this.bb);
    this.players[bbIdx].lastAction = { label: `BB ${bbPaid}` };
    this.log(`${this.players[sbIdx].name} posts small blind ${sbPaid}, ${this.players[bbIdx].name} posts big blind ${bbPaid}`);

    for (let round = 0; round < 2; round++) {
      for (let k = 0; k < this.n; k++) {
        const p = this.players[(this.dealerIdx + 1 + k) % this.n];
        if (p.inHand) p.cards.push(this.deck.pop());
      }
    }

    this.currentBet = this.bb;
    this.render();

    await this.bettingRound((this.dealerIdx + 3) % this.n);

    const streets = [['flop', 3], ['turn', 1], ['river', 1]];
    for (const [name, count] of streets) {
      if (this.activePlayers().length <= 1) break;
      this.street = name;
      this.resetStreet();
      for (let i = 0; i < count; i++) this.board.push(this.deck.pop());
      this.log(`${name[0].toUpperCase()}${name.slice(1)}: ${this.board.map(cardText).join(' ')}`, 'street');

      const canAct = this.activePlayers().filter((p) => !p.allIn);
      if (canAct.length >= 2) {
        this.render();
        await this.bettingRound((this.dealerIdx + 1) % this.n);
      } else {
        // Everyone is all-in: reveal and run the board out with some drama.
        for (const p of this.activePlayers()) p.revealed = true;
        this.render();
        await sleep(this.aiDelay > 0 ? 1100 : 0);
      }
    }

    if (this.activePlayers().length <= 1) this.awardUncontested();
    else await this.showdown();

    this.street = 'idle';
    this.actingIdx = -1;
    this.render();
    this.hooks.onHandEnd?.();
  }

  resetStreet() {
    this.currentBet = 0;
    this.minRaise = this.bb;
    for (const p of this.players) {
      p.bet = 0;
      p.hasActed = false;
      if (!p.folded) p.lastAction = null;
    }
  }

  async bettingRound(startIdx) {
    let i = startIdx;
    for (;;) {
      const active = this.activePlayers();
      if (active.length <= 1) return;
      const actors = active.filter((p) => !p.allIn);
      if (actors.length === 0) return;
      if (actors.every((p) => p.hasActed && p.bet === this.currentBet)) return;

      const p = this.players[i % this.n];
      i++;
      if (!p.inHand || p.folded || p.allIn) continue;
      if (p.hasActed && p.bet === this.currentBet) continue;

      this.actingIdx = this.players.indexOf(p);
      this.render();

      const ctx = this.buildCtx(p);
      let action;
      if (p.isHuman) {
        action = await this.hooks.getHumanAction(ctx);
      } else {
        if (this.aiDelay > 0) await sleep(this.aiDelay * (0.6 + this.rng() * 0.9));
        action = decideAction(p, ctx, this.rng);
      }
      this.applyAction(p, action, ctx);
      this.actingIdx = -1;
      this.render();
    }
  }

  applyAction(p, action, ctx) {
    let label;
    switch (action.type) {
      case 'fold': {
        p.folded = true;
        label = 'Fold';
        break;
      }
      case 'check': {
        if (ctx.toCall > 0) { p.folded = true; label = 'Fold'; break; } // illegal check = fold
        label = 'Check';
        break;
      }
      case 'call': {
        if (ctx.toCall === 0) { label = 'Check'; break; }
        const amt = this.pay(p, this.currentBet - p.bet);
        label = `Call ${amt}${p.allIn ? ' (all-in)' : ''}`;
        break;
      }
      case 'raise': {
        const maxTo = p.bet + p.stack;
        const minTo = Math.min(this.currentBet + this.minRaise, maxTo);
        const target = Math.max(minTo, Math.min(Math.round(action.amount || 0), maxTo));
        const wasBet = this.currentBet === 0;
        this.pay(p, target - p.bet);
        const raiseSize = p.bet - this.currentBet;
        if (raiseSize > 0) {
          if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
          this.currentBet = p.bet;
          this.raisers++;
          for (const o of this.players) if (o !== p) o.hasActed = false;
        }
        label = `${wasBet ? 'Bet' : 'Raise to'} ${p.bet}${p.allIn ? ' (all-in)' : ''}`;
        break;
      }
      default: {
        p.folded = true;
        label = 'Fold';
      }
    }
    p.hasActed = true;
    p.lastAction = { label };
    this.log(`${p.name}: ${label.toLowerCase()}`, p.isHuman ? 'you' : undefined);
  }

  awardUncontested() {
    const winner = this.activePlayers()[0];
    const total = this.potTotal();
    winner.stack += total;
    winner.wonAmount += total;
    this.log(`${winner.name} wins ${total} — everyone else folded`, 'win');
  }

  // Builds main + side pots from cumulative committed amounts.
  buildPots() {
    const contenders = this.activePlayers();
    const levels = [...new Set(contenders.map((p) => p.committed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amt = 0;
      for (const p of this.players) {
        amt += Math.max(0, Math.min(p.committed, level) - prev);
      }
      const eligible = contenders.filter((p) => p.committed >= level);
      if (amt > 0) pots.push({ amt, eligible });
      prev = level;
    }
    return pots;
  }

  async showdown() {
    this.street = 'showdown';
    const active = this.activePlayers();
    for (const p of active) {
      p.revealed = true;
      const e = evaluate7([...p.cards, ...this.board]);
      p.score = e.v;
      p.handDesc = describeHand(e);
      this.log(`${p.name} shows ${p.cards.map(cardText).join(' ')} — ${p.handDesc}`);
    }
    this.render();
    if (this.aiDelay > 0) await sleep(900);

    const pots = this.buildPots();
    pots.forEach((pot, idx) => {
      const best = Math.max(...pot.eligible.map((p) => p.score));
      const winners = pot.eligible.filter((p) => p.score === best);
      const share = Math.floor(pot.amt / winners.length);
      let remainder = pot.amt - share * winners.length;
      for (const w of winners) {
        const got = share + remainder;
        remainder = 0;
        w.stack += got;
        w.wonAmount += got;
      }
      const potName = pots.length > 1 ? (idx === 0 ? 'main pot' : `side pot ${idx}`) : 'the pot';
      const names = winners.map((w) => w.name).join(' and ');
      this.log(`${names} win${winners.length === 1 ? 's' : ''} ${potName} (${pot.amt}) with ${winners[0].handDesc}`, 'win');
    });
  }
}

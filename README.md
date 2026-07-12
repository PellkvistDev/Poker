# ♠ Hold'em Trainer

A Texas Hold'em simulator built for **learning the game**. You play with fake
money against five AI opponents with distinct, clearly labeled playing styles,
and an optional **coach mode** tells you what to think about before every
decision — position, hand strength, pot odds vs. equity, board texture — with
a suggested play hidden behind a button so you decide first.

Pure static HTML/CSS/JS — no build step, no server, no dependencies.

## Features

- **Full 6-max no-limit Hold'em engine** — blinds, all four betting streets,
  min-raise rules, all-ins, side pots, split pots, showdowns.
- **Five AI personalities** to learn to exploit:
  - 🪨 **Rocky** — tight & careful (believe his big bets)
  - 🦈 **Tanya** — tight-aggressive (the dangerous one)
  - 🃏 **Loco** — loose & wild (call down lighter)
  - 📞 **Callie** — calling station (value bet, never bluff)
  - 🎩 **Prof** — solid all-round
  Bots decide using the Chen formula preflop and Monte Carlo equity vs. pot
  odds postflop, shifted by their personality (tightness, aggression, bluffing).
- **🎓 Coach mode** (toggleable): live equity bar, position notes, pot-odds
  math, board-texture warnings, thinking prompts, and a hidden
  "show suggested play" with reasoning. The log notes when your play differed
  from the coach's.
- **Fake bankroll**: start with $10,000, buy in for $1,000, rebuy when busted.
  Bankroll, table stack, and stats persist in `localStorage`.
- **📖 Built-in guide**: hand rankings, position, a pot-odds mini-lesson,
  opponent-type cheat sheet, and a glossary.

## Run locally

Any static file server works (ES modules need HTTP, not `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy on Render (free tier)

This repo is ready to be a Render **Static Site**:

1. In Render: **New → Static Site**, connect this repository.
2. Branch: `main` · Build command: *(leave empty)* · Publish directory: `.`
3. Deploy. Done — there is no build step.

Alternatively use **New → Blueprint** and Render will read `render.yaml`.

## Tests

The engine is DOM-free and has a Node test harness (chip conservation over
thousands of simulated hands, hand-evaluator correctness, side pots):

```bash
node tests/run-tests.mjs
```

## Project layout

```
index.html        app shell, guide content, modals
styles.css        all styling
js/cards.js       deck + card helpers
js/evaluator.js   5/6/7-card hand evaluation
js/equity.js      Monte Carlo equity estimation
js/strategy.js    Chen formula, position, pot odds, board texture
js/ai.js          bot personalities + decision logic
js/game.js        DOM-free game engine (betting, side pots, showdown)
js/coach.js       learning cues + suggested plays
js/ui.js          all DOM rendering
js/main.js        bootstrap, bankroll, persistence
tests/            Node engine tests
render.yaml       Render static-site blueprint
```

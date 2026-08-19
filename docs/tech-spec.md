# Crapette (Russian Bank) — Web App Tech Spec

**v1 scope:** single-player vs CPU, 13-card reserve variant, illegal moves blocked by the engine (no "Stop!" honor system), own-waste-pile-top-card-playable variant enabled. Built with PixiJS + TypeScript. Online multiplayer is explicitly deferred to v2 but the architecture below is designed so v2 doesn't require a rewrite.

---

## 1. Goals / Non-goals

**Goals (v1)**
- Fully playable, rules-correct Crapette against a single CPU opponent, in the browser.
- Engine enforces all rules automatically — a human can only drag a card to a legal destination; compulsory moves are auto-detected and the player is prevented from skipping them (e.g. hand can't be drawn while a compulsory move exists).
- Clear visual feedback: legal drop targets, whose turn it is, remaining pile counts, win/stalemate screen with score.
- Autosave/resume of the current game via `localStorage`.
- **Mobile-friendly responsive layout** — playable in a mobile browser (touch input, responsive canvas), not just desktop. See §5–§6.
- **Multi-language UI and rules text** — all player-facing strings externalized and swappable per locale. See §11.

**Non-goals (v1 — explicitly out of scope)**
- Online/multiplayer, matchmaking.
- Accounts / SSO login and any cross-device stats or history persistence — v1 is local-only (`localStorage`); see §15 for the recommended v2 approach, which is deliberately deferred until a backend exists anyway (bundled with online multiplayer).
- "Stop!" honor-system mode (may be added later as a toggle).
- Sound, theming options, difficulty levels, undo/redo, move hints/animation polish beyond basic tweening.
- A packaged/native mobile app (Capacitor/React Native wrapper) — v1 targets the mobile *browser* responsively; native app packaging is future work (§15) once the web version is solid.

---

## 2. Rules Reference (canonical, for implementation)

Two standard 52-card decks are used, but **digitally there is no need to keep the two decks visually or structurally distinct** — physical decks only get separated at the end of a real-life game to reshuffle each pack; a digital game has no such requirement. Simplify to: build one 104-card pool (two full standard decks), shuffle, deal 52 cards to each player.

**Per-player deal (52 cards each):**
- Reserve: 13 cards, stacked face-down, top card face-up.
- Houses: 4 cards, face-up, one per house, no overlap initially.
- Hand: remaining 35 cards, face-down.
- Waste pile: starts empty.

**Shared tableau:** 8 houses total (4 per player) + 8 foundation slots (empty at start), conceptually sitting between the two house columns.

**First player:** compare top reserve cards, lower rank (A low, K high) goes first; tie-break by comparing next house cards outward, then the next, etc.

**Available cards for the player on turn:**
1. Top (face-up) card of their own reserve.
2. Outer/exposed card of each of the 8 houses (any house, either player's — tableau is shared).
3. Their own hand's top card, once turned up.
4. **[v1 variant enabled]** Top card of their own waste pile.

**Building rules:**
- **Foundation**: empty slot accepts only an Ace. Then build up same suit, ascending, `A 2 3 4 5 6 7 8 9 10 J Q K`.
- **House**: descending rank, alternating color. Empty house accepts any single available card. Cards overlap so the sequence is visible; only the outermost (last-placed) card is available/movable. No moving multi-card runs unless enough empty houses exist to relocate them one card at a time (this restriction can just be enforced naturally — never allow group drag in v1, only single-card drags).
- **Opponent's reserve or waste pile ("loading")**: add a same-suit card that is exactly one rank above or below the current exposed card.
- Illegal destinations, always: your own reserve (never load onto it), either player's hand.

**Compulsory move priority (engine enforces — this is the trickiest part):**
1. If the current player's reserve top card can be played to *any* foundation, that move is forced before anything else.
2. If *any* available card can be played to *any* foundation, one such move must be played next (player may choose which if multiple qualify) before non-foundation moves are allowed.
3. Before the player may turn up a hand card, if their reserve is non-empty, they must first fill all empty tableau houses using reserve cards (if reserve cards can legally fill them — an empty house accepts any card, so this is always possible if the reserve has any card and an empty house exists).

Practically: after every move, recompute the legal-move set. If category 1 or 2 above is non-empty, only those moves are selectable; everything else (including "draw hand") is disabled until resolved. If reserve is non-empty and an empty house exists, "draw hand" stays disabled until the reserve fills it.

**Turn flow:**
- A turn is a sequence of moves. Player keeps moving while legal/compulsory moves exist and they choose to.
- Playing the reserve's top card auto-flips the next reserve card face-up.
- Player may voluntarily turn up their hand's top card only when no compulsory move remains. Once turned up it becomes available.
- If the drawn hand card cannot or will not be played, it goes to the player's waste pile — **this ends the turn.**
- If hand is empty and a new hand card is needed, flip the waste pile over (preserving order) to become the new hand — but only at the *start* of the player's *next* turn if the hand ran out mid-turn (matches physical rules: opponent can still load onto your waste pile before that happens). In practice: mark hand as "needs reshuffle from waste," perform the reshuffle at the beginning of that player's next turn instead of immediately.

**Win condition:** a player with empty hand + empty waste + empty reserve wins immediately.
**Scoring:** winner gets 30 + 1 per opponent's remaining hand+waste card + 2 per opponent's remaining reserve card.
**Stalemate:** if neither player can make any reserve/hand-driven progress over a full round (see §9), score by count difference (2 pts/reserve card, 1 pt/hand+waste card), no 30-pt bonus.

---

## 3. Data Model

```ts
type Suit = 'S' | 'H' | 'D' | 'C';
type Rank = 1|2|3|4|5|6|7|8|9|10|11|12|13; // 1=A, 11=J, 12=Q, 13=K

interface Card {
  id: string;       // unique per physical card instance, e.g. "C-7H-04"
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

type PlayerId = 'human' | 'cpu';

interface PlayerState {
  id: PlayerId;
  reserve: Card[];      // index 0 = bottom, last = top (face-up)
  houses: [Card[], Card[], Card[], Card[]]; // each a face-up overlapping sequence; last = outer/available
  hand: Card[];         // face-down draw pile
  waste: Card[];         // last = top/available
  needsHandReshuffle: boolean; // true if hand emptied mid-turn; reshuffle happens at next turn start
}

interface FoundationSlot {
  suit: Suit | null;   // set once an Ace is placed
  cards: Card[];       // top = cards[cards.length-1]
}

interface GameState {
  players: Record<PlayerId, PlayerState>;
  foundations: FoundationSlot[]; // length 8, but only suit-matching matters; treat as 8 generic slots
  turn: PlayerId;
  turnMoveLog: Move[];   // moves made so far this turn (for animation/replay/debug)
  status: 'in_progress' | 'won' | 'stalemate';
  winner?: PlayerId;
  roundsWithoutProgress: number; // stalemate detection counter, see §9
}

type PileRef =
  | { type: 'reserve'; owner: PlayerId }
  | { type: 'house'; owner: PlayerId; index: 0|1|2|3 }
  | { type: 'hand'; owner: PlayerId }
  | { type: 'waste'; owner: PlayerId }
  | { type: 'foundation'; index: number };

interface Move {
  card: Card;
  from: PileRef;
  to: PileRef;
}

type RejectReason =
  | 'wrong-suit-sequence'      // foundation: not next rank up in same suit, or not an ace on empty
  | 'wrong-house-sequence'     // house: not descending/alternating-color, or house not empty
  | 'wrong-load-match'         // opponent pile: not same suit ±1 rank
  | 'not-available'            // card isn't the exposed/top card of its pile
  | 'compulsory-move-pending'  // another move is mandatory right now, this one isn't it
  | 'forbidden-destination';   // own reserve, own waste (mid-turn from elsewhere), either hand

interface MoveEvaluation {
  move: Move;
  legal: boolean;
  reason?: RejectReason;       // present when legal === false, drives the UI toast copy
}
```

Note: foundations don't need to be pre-assigned to a suit visually before use — any of the 8 slots can accept any Ace. Track `suit: null` until filled.

---

## 4. Architecture

Strict separation of concerns, so the rules engine is reusable server-side for v2 multiplayer without modification:

```
/src
  /engine          <-- pure TypeScript, zero rendering/DOM dependencies
    types.ts
    deck.ts        <-- build/shuffle the 104-card pool, deal
    rules.ts       <-- legality checks: canPlayToFoundation, canPlayToHouse, canLoadPile — each returns a RejectReason on failure, not just false
    moveResolver.ts<-- computes the full legal-move set + compulsory subset for the player on turn; also exposes evaluateMove(state, move) -> MoveEvaluation for the UI to query "why is this drop invalid?" while dragging
    engine.ts       <-- applyMove(state, move) -> new state; pure, immutable-style
    winCheck.ts     <-- win/stalemate detection
  /ai
    cpuPlayer.ts    <-- given GameState + legal moves, picks a move (heuristics, see §8)
  /render
    /pixi           <-- PixiJS scene, sprites, drag/drop, tweening
    layout.ts       <-- screen coordinates for every pile
    cardSprites.ts
  /ui
    hud.ts          <-- turn indicator, pile counts, end-game modal
    about.ts        <-- About/Legal modal: game license + third-party credits (SVG-cards, PixiJS, etc.), see §12
  /state
    gameStore.ts    <-- glues engine + ai + render, owns the single GameState, persistence
  main.ts
```

**Key rule:** `/engine` never imports Pixi, the DOM, or anything render-related. It exposes pure functions operating on plain data (`GameState in -> GameState out`, or `GameState in -> Move[] out`). Two things depend on this discipline being strict:

- **Headless simulation.** The engine must be runnable with zero UI attached — e.g. `node` script that plays a full game between two scripted/random bots purely against `/engine` and `/ai`, start to finish, asserting a valid end state. This isn't just a testing nicety, it's a hard requirement: it's the fastest way to validate rules correctness (thousands of simulated games in seconds) and it's what step 4 of the build order (§14) is for.
- **Portability.** The same `/engine` + `/ai` code can later run: (a) unmodified inside a future mobile app (a WebView-based wrapper like Capacitor, or a React Native port — either way the rules/AI logic ports as-is, only `/render` needs reimplementing per-platform), and (b) unmodified on a Node.js server as the authoritative validator for online multiplayer. Rendering is the only layer that's expected to be rewritten per target platform.

---

## 5. Screen Layout

The physical layout (players sitting across a table, houses in vertical columns) is rotated for a landscape browser window into horizontal rows, top to bottom:

1. **CPU row**: hand (left) — waste pile — reserve (right, top card visible)
2. **CPU houses**: 4 house slots in a horizontal row
3. **Foundations**: 8 slots in a horizontal row (or 2×4 grid if width is tight), shared
4. **Human houses**: 4 house slots in a horizontal row
5. **Human row**: hand (left) — waste pile — reserve (right, top card visible)

This preserves every game-relevant relationship (CPU's houses and human's houses are both equally reachable/shared; foundations sit between them) while fitting a normal 16:9 canvas. Use a fixed logical resolution (e.g. 1280×800) scaled to fit the window via PixiJS `resizeTo` + a uniform scale factor (`Math.min(w/1280, h/800)`), letterboxing rather than distorting.

**Mobile/responsive requirement:** this 5-row layout is landscape-shaped by nature (it mirrors the physical two-player table), so:
- On a landscape viewport (including a phone rotated sideways) — render as above, scaled to fit.
- On a portrait viewport — either (a) prompt the user to rotate the device (simplest, acceptable for v1), or (b) tighten the layout (smaller card size, houses/foundations wrapped into a denser grid rather than a single row) to fit a taller/narrower canvas. Recommendation for v1: do (a) with a simple "rotate your device" overlay below a width/height breakpoint (e.g. `height > width` on a touch device), and revisit (b) only if that proves too restrictive in practice.
- Card and pile hit-targets must stay large enough for a fingertip (roughly 44×44 CSS px minimum) at the smallest supported scale — check this against the 1280×800 logical layout's card size when scaled down to a typical phone viewport (~375×667 landscape → 667×375).

---

## 6. Interaction Model

- **Two input modes, both in v1 (not deferred):** drag-and-drop (mouse/trackpad, and touch-drag also works fine via Pixi's unified pointer events), *and* tap-to-select-then-tap-target as an explicit alternative — detect touch capability (or just always offer both) and support tap-source/tap-target, since dragging a small card precisely on a phone screen is markedly harder than on desktop. Tapping a card highlights its legal destinations exactly as drag-start does (§below); tapping a highlighted destination plays the move; tapping the same card again or tapping empty space deselects.
- On drag start of a card: compute its legal destinations via `moveResolver`, highlight them (e.g. subtle glow/border on valid piles). Illegal destinations reject the drop — the engine never allows an illegal `applyMove` to be constructed, so the UI layer just needs to check "is `to` in this card's legal destination set" before calling `applyMove`.
- **Illegal-move feedback (required, not optional polish):** a rejected drop must give a clear, immediate visual cue — card snaps back to origin with a brief shake/red-flash tween, plus a short-lived toast/label naming why it's invalid (e.g. "Doesn't match suit/rank" or "You must play a foundation move first"). This is purely a UI-layer concern: it reads the *reason* for rejection from `moveResolver` (which should return not just yes/no but a reason code per candidate destination), it never influences engine state.
- If a compulsory move exists, only cards belonging to the compulsory subset should be draggable at all (grey out / disable pointer events on everything else). This makes it physically impossible for the human player to violate priority rules — no "Stop!" needed.
- "Draw hand card" is a click target on the human hand pile; it's disabled (visually greyed) whenever a compulsory move exists or an empty house needs filling from reserve.
- After each move, re-run `moveResolver` and re-render affected piles + HUD.
- CPU's turn: no drag/drop — `cpuPlayer.ts` picks moves from the same legal-move set on an interval (e.g. 500–800ms between moves) so the human can follow what happened; render with the same tween/move animation as human moves.

---

## 7. CPU AI (v1 — rule-based, no search/minimax)

Given the current legal-move set (already split into compulsory vs optional by the engine), the CPU:

1. **Always** plays all compulsory foundation moves first (required anyway).
2. **Always** fills empty houses from reserve when required (also compulsory).
3. Among remaining **optional** legal moves, rank by heuristic priority and take the highest-ranked repeatedly until no optional moves remain worth taking, then draw a hand card:
   - a. Emptying own reserve > emptying own waste > other moves (reserve cards cost the opponent 2 pts each if the CPU wins, and keeping reserve low keeps future compulsory-move flexibility).
   - b. Loading a card onto the human's reserve or waste pile (hurts opponent progress) — prefer this over passive house-building when available, *unless* it would hand the human a card that unblocks one of their own foundation plays (basic 1-ply lookahead: simulate the load, check if it creates a new legal foundation move for the human; if so, deprioritize it).
   - c. Playing a card onto a house that empties one of the CPU's own piles (reserve/waste/hand) over playing onto a house that doesn't.
   - d. Prefer moves that empty a house entirely (creates a flexible empty slot) over moves that fill/extend one, all else equal.
   - e. Fallback: first legal optional move in list order.
4. If genuinely no optional or compulsory moves remain, draw the hand card; if it's unplayable, discard to waste (ends turn).

This is intentionally simple — a single competent heuristic bot, not a search-based AI. Note in code comments that a stronger AI (shallow minimax over the small branching factor, or MCTS) is a natural v1.5 improvement, isolated entirely inside `cpuPlayer.ts` without touching the engine.

---

## 8. Turn Algorithm (pseudocode, drives both human-input gating and CPU)

```
function startTurn(state):
  player = state.players[state.turn]
  if player.needsHandReshuffle:
    player.hand = reverse(player.waste); player.waste = []
    player.needsHandReshuffle = false
  loop:
    legal = moveResolver.getLegalMoves(state, state.turn)
    if legal.compulsory.length > 0:
      // UI: only compulsory-eligible cards draggable; CPU auto-plays highest priority
      move = choose(legal.compulsory)   // human via drag, cpu via heuristic
      state = engine.applyMove(state, move)
      checkWin(state) -> maybe end game
      continue loop
    if reserveNonEmpty(player) and hasEmptyHouse(state):
      // covered by compulsory already (case 3), but double-guard here
      continue loop
    // no compulsory moves remain: player may make optional moves or draw
    if player wants to make an optional move (has one available):
      move = choose(legal.optional)  // human via drag, cpu via heuristic
      state = engine.applyMove(state, move)
      checkWin(state)
      continue loop
    else:
      // must draw or stop
      if player.hand is empty and player.waste is empty and player.reserve is empty:
        break // shouldn't happen, win already triggered
      card = drawHandCard(player)   // flips top of hand face-up, becomes available
      legalForDrawn = moveResolver.getLegalMoves(state, state.turn) // recompute including drawn card
      if legalForDrawn has a move for this card AND player chooses to play it (cpu: yes if any exist; human: may choose to play or discard):
        move = choose(...)
        state = engine.applyMove(state, move)
        checkWin(state)
        continue loop  // may keep playing / draw again next iteration
      else:
        moveToWaste(player, card)
        endTurn(state)
        return state
  endTurn(state)
  return state
```

`moveResolver.getLegalMoves` returns `{ compulsory: Move[], optional: Move[] }` where compulsory = category-1/2 foundation moves (see §2) — computed fresh after every single move, since playing one card can create or remove compulsory obligations.

---

## 9. Win / Stalemate Detection

- **Win**: after every `applyMove`, check if the mover's reserve, hand, and waste are all empty. If so, `status = 'won'`, compute score, stop.
- **Stalemate**: track `roundsWithoutProgress`. "Progress" for a player's turn = any move was made that wasn't purely "draw then immediately discard to waste with zero other moves that turn." If both players, in consecutive turns, make zero progress (every hand card drawn goes straight to waste, no reserve/house/foundation/load move was possible at any point), increment a counter; if it hits 2 consecutive no-progress turns (one per player), declare `status = 'stalemate'` and score by the difference-in-remaining-cards rule. Reset the counter to 0 on any progress.

---

## 10. Persistence

- `localStorage` key `crapette-save-v1`, JSON-serialized `GameState`, written after every completed move (or at minimum after every turn end) — Cards need only plain-data fields, so `JSON.stringify(state)` works directly.
- On load: if a save exists and game is `in_progress`, offer "Resume" vs "New Game"; otherwise start fresh.
- No account/server sync in v1 — purely local single-device.

---

## 11. Internationalization (i18n)

Two categories of text, handled differently:

- **UI chrome & rules/help text** (buttons, HUD labels, toasts, tutorial/rules copy, end-game screen): externalize every user-facing string to per-locale JSON dictionaries from day one — never inline literal strings in `/render` or `/ui` code. Use a small, standard i18n library (e.g. `i18next`, MIT-licensed) rather than hand-rolling it; it's not worth reinventing and the ecosystem tooling (missing-key detection, pluralization) pays for itself once there's more than one language.
- **Card identity** (rank/suit shown on cards, in the move log, etc.): don't translate these as words — use the universal `A/2…10/J/Q/K` + suit glyph (`♠ ♥ ♦ ♣`) notation, which is language-independent and matches the card art anyway. This avoids needing to translate 52 card names per locale.
- **`RejectReason` codes** (§3) are machine keys, not display text — the UI maps each to a localized string via the same i18n dictionary, e.g. `reject.wrong-suit-sequence` → *"Doesn't match suit or rank"* / *"Não corresponde ao naipe ou número"* / etc. This was the point of making them an enum rather than hardcoded English strings in the engine.

**Architecture requirement:** the `/engine` and `/ai` layers must never produce human-readable strings at all — they only ever return typed data (`Move`, `RejectReason`, `GameState`). All copy lives in `/ui`'s locale files. This keeps the engine trivially reusable across locales (and platforms) with zero changes.

**Scope for v1:** ship the full i18n *architecture* (locale-switching, externalized strings, language picker in settings) with English complete, and structure it so adding a new locale is just adding a JSON file — no code changes. Given your own languages, English + Portuguese + Serbian are the natural first three to author (Serbian can ship in Latin script initially; Cyrillic is a straightforward second locale file once the Latin one exists, not extra engineering work). Detect browser language on first load as the default, with a manual switcher, falling back to English for any unsupported locale.

---

## 12. Tech Stack

- **TypeScript**, **Vite** (dev server + build), **PixiJS** (v8, MIT license) for rendering/animation/input.
- **Vitest** (MIT) for unit-testing `/engine` (this is the part most worth testing — the compulsory-move logic is fiddly and easy to get subtly wrong).
- **i18next** (MIT) for the i18n layer described in §11.
- No backend for v1. Static site — deploy on **Vercel** (zero-config for a Vite static build; this is also the natural place to add the v2 backend later, see §15).

**Licensing constraint (applies to every dependency and asset, since this repo is public/open-source on GitHub):** everything used must be permissively licensed — MIT, Apache-2.0, BSD, or CC0 preferred; LGPL is acceptable specifically for *assets* (not code you statically link) as long as the license file/attribution is kept in the repo. Avoid anything requiring a paid commercial license or with a "non-commercial use only" clause, since that's incompatible with a freely redistributable open-source repo even though the project itself isn't monetized. Everything named in this spec (PixiJS, Vite, TypeScript, Vitest, i18next) is MIT/Apache-2.0 and fine.

**Card art — decision:** use **[htdebeer/SVG-cards](https://github.com/htdebeer/SVG-cards)** (LGPL-2.1) as the primary source. Reasoning:
- Pure vector SVG, classic/realistic French-suited face design — fits a "proper" card game better than a pixel-art style, and scales cleanly to any resolution, which matters more now that the layout needs to work across desktop and mobile screen sizes (§5) without shipping multiple fixed-resolution raster sets.
- Ships with pre-rendered PNGs at 1×/2× too (in the `png/` folder), useful if you'd rather bake PixiJS textures at build time instead of rasterizing SVG at runtime — reasonable for performance on lower-end mobile devices.
- Comes with 16 pre-made card-back colors, which conveniently covers the "optional cosmetic distinction between the two players' reserve/hand piles" idea from §2 for free.
- License requirement: LGPL-2.1 explicitly permits use "even in non-free software" for exactly this kind of embedding; keep the `COPYING`/license file in the repo, and surface the credit line in-app via an About/Legal page (see below) rather than just a README.

**About/Legal page (v1 requirement, not just a README note):** a simple in-app page — linked from a persistent footer/menu item, doesn't need its own route/deep-linking for v1, a modal is fine — listing: the game's own license, and third-party credits (SVG-cards LGPL-2.1 + link, PixiJS MIT, any other bundled library that requires attribution). This is the actual mechanism satisfying the LGPL attribution requirement, not an afterthought. Since it's UI text, it goes through the i18n system in §11 like everything else.

**Fallback if you'd rather avoid LGPL entirely:** [Kenney's Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack) is CC0 (public domain, zero conditions, no attribution required even). It reads more "flat/stylized" than "classic casino deck," so it's a style trade-off, not a strictly better pick — swap to this only if the LGPL attribution requirement above is undesirable for some reason.

Only one visual deck design is needed regardless of which is chosen (no need to distinguish "Player A's deck" vs "Player B's deck" visually, per the digital simplification in §2) — use two different card-back colors purely for flavor on the two reserve/hand piles if desired.

---

## 13. Testing Plan

Prioritize `/engine` unit tests since that's where correctness bugs hide:
- Foundation legality (empty slot Ace-only, ascending same-suit sequence).
- House legality (descending alternating color, empty house wildcard, single-card-only enforcement).
- Opponent loading legality (same suit, ±1 rank).
- Compulsory-move computation: reserve-to-foundation forces before all else; any-available-to-foundation forces before house/hand moves; empty-house-fill-from-reserve blocks hand draw.
- Hand→waste→reshuffle-into-hand cycle, including the "don't reshuffle until next turn" timing rule.
- Win detection and stalemate/scoring math.

Manual/integration testing for drag-and-drop and CPU pacing can stay lightweight (playtesting) for v1.

---

## 14. Suggested Build Order

1. `/engine`: types, deck build/shuffle/deal, rules.ts legality checks — with unit tests as you go.
2. `moveResolver.ts` (legal + compulsory move computation) + `engine.applyMove` — unit tests covering the priority rules specifically.
3. `winCheck.ts` (win + stalemate) — unit tests.
4. Headless CLI or console harness: play a full game via random-legal-move bots on both sides, to shake out engine bugs before touching any rendering.
5. `cpuPlayer.ts` heuristic AI, tested against the harness from step 4.
6. PixiJS rendering: static layout first (render a `GameState` snapshot with no interaction), built responsively from the start per §5 (don't hardcode desktop-only coordinates and retrofit later).
7. Input: drag-and-drop *and* tap-to-select (§6), both wired to the engine, with legal-destination highlighting, illegal-drop feedback, and compulsory-move gating.
8. Turn loop wiring: human turn ↔ CPU turn alternation, move animation/pacing.
9. HUD: turn indicator, pile counts, win/stalemate end screen, footer link → About/Legal modal (credits per §12).
10. i18n wiring (§11): externalize the strings written in steps 6–9 into locale files as you go, rather than as a separate retrofit pass — cheapest to do at write-time.
11. `localStorage` autosave/resume.
12. Polish pass: card flip/move tweening, basic sound-free juice; test on an actual phone browser (not just a resized desktop window) for touch-target sizing and layout.

---

## 15. Future Work (v2+, not in scope now)

- **Online multiplayer:** reuse `/engine` unchanged as the authoritative validator. Two realistic paths on Vercel as of mid-2026:
  - Vercel Functions now have native WebSocket support (public beta since June 2026), running on Fluid compute. It's a reasonable fit *specifically because* this game is turn-based, low-message-frequency, 1-on-1 — but note connections are pinned to a single function instance with no built-in cross-instance broadcast, so a reconnect/second-device scenario needs an external store (Vercel's own guidance recommends Redis) to hold authoritative state between connections.
  - Alternative: a managed realtime provider (e.g. Supabase Realtime, which pairs a Postgres DB + Auth + Realtime channels in one free-tier service) sidesteps that complexity and conveniently also solves the accounts/stats need below in the same service. Worth comparing both once this phase starts rather than committing now.
  - Either way: clients send proposed `Move`s, the server validates via the same `rules.ts`/`moveResolver.ts` and broadcasts the resulting `GameState` — no engine changes required.
- **Accounts / Google SSO for stats, history, and cross-device scoring:** makes sense, but only once there's a backend anyway — bundle it with the online multiplayer phase above rather than standing up auth infrastructure just for local single-player stats. Recommendation: **Supabase Auth** (free tier, built-in Google OAuth provider, pairs naturally with Supabase Realtime if that's also the multiplayer choice, and gives you a Postgres table for match history/scoring with very little setup). Auth.js (formerly NextAuth) is a reasonable alternative if the project grows into a Next.js app on Vercel instead of a static Vite site. Until then, keep `localStorage` as the only persistence (§10) — don't build a half-used account system ahead of the feature that needs it.
- Native mobile app packaging: wrap the existing PixiJS canvas in Capacitor for a fast first pass, since Pixi already renders fine in a WebView and the responsive web version (§5–§6) carries over directly; a native-feeling React Native port is a further step and would mean rewriting `/render` and `/ui` only — `/engine` and `/ai` carry over untouched either way.
- Optional "Stop!" honor-system mode as a house rule toggle.
- Difficulty levels for the CPU (shallow search/minimax beyond the current heuristic).
- Undo/redo, move hints, animations/sound polish.

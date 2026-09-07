// §5/§14 steps 6–7: PixiJS rendering of a GameState snapshot, scaled/letterboxed to fit the
// real viewport, plus tap-to-select input. Everything here reads a GameState/PileRef; it
// never mutates one — /render never depends on /engine internals beyond the plain data
// types, and click handling here only ever reports "this slot was clicked" outward via
// onSlotClick. What that click *means* (select / attempt a move / draw / discard) is
// entirely gameStore.ts's call — deliberately reactive-only, no legal-destination
// highlighting or preemptive disabling (see gameStore.ts's file comment for why). The one
// exception is the compulsory-move banner/dimming/ring: that's not a *hint* (it doesn't
// reveal anything the player couldn't already tell from a rejected click), it's surfacing a
// forced state the engine already computes for click-gating — see renderGameState's
// `compulsory` param.
import { Application, Container, FillGradient, type FederatedPointerEvent, Graphics, Rectangle, type Sprite, Text, type Texture } from 'pixi.js';
import { i18next, SUPPORTED_LANGUAGES, setLanguage } from '../../i18n/index.ts';
import type { Card, GameState, Move, PileRef, PlayerId, Suit } from '../../engine/types.ts';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  chooseTableMode,
  computeFoundationDisplayOrder,
  computeTableLayout,
  FOUNDATION_ROW_SUIT,
  HOUSE_FAN_SIGN,
  houseFanPeek,
  logicalSize,
  type PlayerRowLayout,
  type Point,
  type TableMode,
  TOOLBAR_HEIGHT,
} from '../layout.ts';
import { cardTexture, createCardSprite, preloadCardTextures } from './cardSprites.ts';

// Redesign handoff (design_handoff_crapette_board): every OKLCH color token converted once to
// sRGB hex here (Pixi has no native OKLCH fill support) — see docs/known-issues.md for the
// conversion approach if these ever need revisiting.
const FELT_INNER_COLOR = 0x2a4e3a; // oklch(0.39 0.055 158)
const FELT_OUTER_COLOR = 0x0e2619; // oklch(0.245 0.04 158)
const PANEL_GROUND_COLOR = 0x07180f; // oklch(0.19 0.03 158)
const INK_COLOR = 0xf7f4ec;
const HAIRLINE_ALPHA = 0.16;
const GOLD_COLOR = 0xd5b36a; // oklch(0.78 0.10 85)
const GOLD_INK_COLOR = 0xf0d08f; // oklch(0.87 0.09 85)
const GOLD_LABEL_COLOR = 0x221c10; // dark label on a gold-filled button
const RED_COLOR = 0xc13c3b; // oklch(0.55 0.17 25)
const RED_INK_COLOR = 0xff9890; // oklch(0.80 0.14 25)
const RED_WASH_COLOR = 0xa5292b; // oklch(0.48 0.16 25)
const TOAST_BG_COLOR = 0x2e100e; // oklch(0.22 0.05 25)

const FONT_SERIF = "'Instrument Serif', Georgia, serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";
const FONT_BODY = 'Helvetica, Arial, sans-serif';

const SLOT_OUTLINE_COLOR = INK_COLOR;
const SLOT_OUTLINE_ALPHA = 0.14;
const SLOT_CORNER_RADIUS = 8;

// Cheap approximation of the design's `box-shadow` under every card — a flat offset
// rounded-rect, not a real blur filter. A GPU drop-shadow filter per card (pixi-filters isn't
// currently a dependency) would cost a render pass per sprite; with up to ~30+ cards on
// screen and several animating every frame during a move/drag, that's a real perf risk this
// avoids. Documented as a deliberate simplification, see docs/known-issues.md.
const CARD_SHADOW_OFFSET = 4;
const CARD_SHADOW_COLOR = 0x000000;
const CARD_SHADOW_ALPHA = 0.32;

// Depth-cue filler layers for stock-style piles (talon/waste/reserve) — see drawStackedPile.
const STACK_DEPTH_MAX_LAYERS = 6;
const STACK_DEPTH_OFFSET = 3;
const STACK_FILLER_COLOR = 0xece5d8;
const STACK_FILLER_BORDER_ALPHA = 0.25;

const SELECTED_LIFT_Y = 12;
const FEEDBACK_TEXT_Y = TOOLBAR_HEIGHT + 26;
const TURN_TEXT_Y = TOOLBAR_HEIGHT + 54;
const BANNER_TEXT_Y = TURN_TEXT_Y + 34;

// §14 step 12: how long a card takes to slide from its previous rendered position to its new
// one. Exists specifically so CPU moves (and human tap-to-select moves) read as a card
// actually traveling from pile to pile, matching the visual continuity a human's own
// drag-and-drop already has for free.
const CARD_MOVE_DURATION_MS = 260;
// How long a face-down/face-up flip takes (e.g. drawing a hand card face-up in place) — half
// shrinking to a sliver, half growing back out, texture swapped at the midpoint.
const CARD_FLIP_DURATION_MS = 220;

// §14 step 9: a small badge showing exactly how many cards are in a pile — pile counts are
// a HUD feature distinct from stackDepthLayers' *impression* of depth (that's cosmetic only,
// never an exact count). Anchored to each pile's fixed base slot (not a fanned house's
// shifting top-card position), bottom-right corner, so it never moves as the pile changes.
const COUNT_BADGE_RADIUS = 11;
const COUNT_BADGE_COLOR = 0x000000;
const COUNT_BADGE_ALPHA = 0.65;

// §14 step 9: end-of-game overlay + its "Play Again" button.
const OVERLAY_BG_ALPHA = 0.72;
const OVERLAY_TITLE_Y_OFFSET = -40;
const OVERLAY_SCORE_Y_OFFSET = 6;
const OVERLAY_BUTTON_Y_OFFSET = 60;
const PLAY_AGAIN_BUTTON_WIDTH = 170;
const PLAY_AGAIN_BUTTON_HEIGHT = 46;

// §14 step 9: the About/Legal modal (LGPL-2.1 attribution for the vendored card art per
// §12 — see public/cards/CREDIT.md), plus the How to Play modal — both share the same
// dim-backdrop-plus-panel look. Originally opened from a footer row; the redesign v2
// handoff (README.md §0) replaces that footer with the top toolbar below.
const ABOUT_PANEL_WIDTH = 560;
const ABOUT_PANEL_HEIGHT = 300;
const RULES_PANEL_WIDTH = 680;
const RULES_PANEL_HEIGHT = 800;

// Redesign v2 handoff, README.md §0 / DESIGN_RULES.md §3,§8 — the top toolbar band and its
// two anchored popovers (New Game confirm, Settings stub). Sizes/alphas quoted directly
// from the handoff; `letterSpacing` values are already the px conversion of the handoff's
// em tracking figures (DESIGN_RULES.md §3's table — Pixi letterSpacing is px, not em).
const TOOLBAR_BG_ALPHA = 0.22;
const TOOLBAR_BORDER_ALPHA = 0.09;
const TOOLBAR_PADDING_X = 32;
const TOOLBAR_ITEM_GAP = 32;
const TOOLBAR_DIVIDER_ALPHA = 0.16;
const TOOLBAR_LABEL_ALPHA = 0.62;
const TOOLBAR_LABEL_LETTER_SPACING = 1.5; // .14em @ 11px
const WORDMARK_FONT_SIZE = 21;
const QUALIFIER_FONT_SIZE = 9.5;
const QUALIFIER_LETTER_SPACING = 1.7; // .18em @ 9.5px
const QUALIFIER_ALPHA = 0.45;
const DIVIDER_HEIGHT = 19;
const HOVER_UNDERLINE_BLEED = 12;
const HOVER_UNDERLINE_HEIGHT = 2;

const SEGMENTED_TRACK_ALPHA = 0.06;
const SEGMENTED_PADDING = 3;
const SEGMENTED_LABEL_GAP = 2;
const SEGMENTED_LABEL_FONT_SIZE = 10;
const SEGMENTED_LABEL_PAD_X = 10;
const SEGMENTED_TRACK_HEIGHT = 22;

const POPOVER_TOP_MARGIN = 10;
const POPOVER_SIDE_MARGIN = 16;
const POPOVER_PADDING = 18;
const POPOVER_BUTTON_HEIGHT = 38;
const POPOVER_BUTTON_GAP = 9;
const POPOVER_BUTTON_PAD_X = 16;
const NEW_GAME_POPOVER_WIDTH = 322;
const SETTINGS_POPOVER_WIDTH = 300;

export interface FeedbackFlash {
  ref: PileRef;
  message: string;
}

export type SlotClickHandler = (ref: PileRef) => void;
export type CanPickUp = (ref: PileRef) => boolean;
export type DropHandler = (from: PileRef, to: PileRef) => void;

export interface TableSceneHandlers {
  onSlotClick: SlotClickHandler;
  onPlayAgain: () => void;
  // §14 step 10.5: drag-and-drop, added alongside tap-to-select. canPickUp is a pure
  // read-only check the drag controller calls on pointerdown to decide whether to start
  // tracking a drag at all; onDrop fires once per completed drag (never for a plain tap,
  // never for a drop back onto its own origin) — see gameStore.ts's canPickUp/
  // attemptDragMove, which this is wired to in main.ts.
  canPickUp: CanPickUp;
  onDrop: DropHandler;
  // Toolbar "NEW GAME" → confirm popover → this — deals a fresh game the same way "Play
  // Again" does (main.ts wires both to the same function), just reachable mid-game, not
  // only once one has ended.
  onNewGameRequest: () => void;
  // Redesign v2 handoff (README.md §0): NEW GAME "confirms in place" only while a game is
  // actually in progress — with none in progress (fresh load, or after the current one just
  // ended) it acts immediately, no popover, matching "Play Again"'s existing behavior.
  isGameInProgress: () => boolean;
  // Fires after the toolbar's EN/PT segmented control has already switched i18next's active
  // language and refreshed every static (built-once) Text on screen — main.ts just needs to
  // re-render with the current GameState so turn/flash/end-screen text (already dynamic,
  // rebuilt every renderGameState call) picks up the new language too.
  onLanguageChange: () => void;
  // Redesign: fires when a resize crosses the portrait/landscape aspect threshold, after the
  // scene's own static chrome (backdrop, slot outlines, footer/HUD positions) has already
  // been rebuilt for the new mode — main.ts just needs to re-render with the current
  // GameState so cardsLayer/overlayLayer pick up the new pile positions too, same reasoning
  // as onLanguageChange.
  onModeChange: () => void;
}

interface DragController {
  setState(state: GameState): void;
  // Redesign: the landscape/portrait branch changes where every pile actually is — a drag
  // gesture spanning a resize that crosses the mode threshold (rare, but possible) needs the
  // hit-test to use the *current* mode, not whatever was active when the drag started.
  setMode(mode: TableMode): void;
  attach(sprite: Sprite, ref: PileRef, homePoint: Point, cardId: string): void;
  // One-shot: true (and clears itself) exactly once for the card a human drag gesture just
  // released onto a different pile — see placeCard, which uses this to skip re-animating a
  // card that the user's own pointer already smoothly carried to its new position.
  consumeJustDragged(cardId: string): boolean;
}

export interface TableScene {
  app: Application;
  root: Container; // logical space; scaled + centered on resize (letterboxed)
  cardsLayer: Container; // cleared and rebuilt on every renderGameState call
  overlayLayer: Container; // end-of-game overlay, cleared and rebuilt on every renderGameState call
  feedbackText: Text;
  feedbackPanel: Graphics; // toast background behind feedbackText, sized to its measured bounds
  turnText: Text;
  bannerText: Text; // compulsory-move banner, shown only while a forced move is pending
  bannerPanel: Graphics; // red-wash background behind bannerText, sized to its measured bounds
  onSlotClick: SlotClickHandler;
  onPlayAgain: () => void;
  dragController: DragController;
  // Which arrangement is currently active — portrait (piles in rows) or landscape (piles in
  // flanks). Read-only from the outside; only createTableScene's resize handler changes it.
  readonly mode: TableMode;
  // Last rendered position + face-up state per card id, so placeCard can tell "this card just
  // appeared here" (no entry, or a stale one — snap instantly) apart from "this card just
  // moved here from somewhere else" (tween) or "this card just turned face up/down in place"
  // (flip). Cleared on a fresh deal (see main.ts) — card ids are stable (suit+rank+copy, not
  // randomized, see deck.ts) so a stale entry from a finished game would otherwise make the
  // next game's opening deal appear to slide/flip in from the old game's state.
  //
  // `generation` is what makes an entry "stale" apart from just "present": only the TOP card
  // of a stacked pile (hand/waste/reserve/foundation — see drawStackedPile/drawTopCardOnly)
  // gets a placeCard call each render; a card buried underneath simply isn't touched until it
  // resurfaces, potentially many renders (and many other pile moves) later. Without this,
  // placeCard would trust that old entry as a genuine "previous position" and animate the
  // card sliding in from wherever it happened to last be visible (often a waste pile, since
  // most cards pass through one) instead of just appearing — a real, confirmed bug (a card
  // resurfacing as a new pile's top would visibly fly in from an unrelated, long-stale spot).
  // An entry only counts as a valid animation source if its generation is EXACTLY one behind
  // the current render's — i.e. it was placed on the immediately preceding render, so it's
  // known to have been continuously, visibly at that position until right now.
  cardRenderState: Map<string, { point: Point; faceUp: boolean; generation: number }>;
  renderGeneration: number;
}

interface Slot {
  ref: PileRef;
  point: Point;
}

function allBaseSlots(mode: TableMode): Slot[] {
  const table = computeTableLayout(mode);
  const rowSlots = (row: PlayerRowLayout, owner: PlayerId): Slot[] => [
    { ref: { type: 'hand', owner }, point: row.hand },
    { ref: { type: 'waste', owner }, point: row.waste },
    { ref: { type: 'reserve', owner }, point: row.reserve },
    ...row.houses.map((point, index): Slot => ({ ref: { type: 'house', owner, index: index as 0 | 1 | 2 | 3 }, point })),
  ];
  return [
    ...rowSlots(table.cpu, 'cpu'),
    ...rowSlots(table.human, 'human'),
    ...table.foundations.map((point, index): Slot => ({ ref: { type: 'foundation', index }, point })),
  ];
}

function refsEqual(a: PileRef, b: PileRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'foundation' && b.type === 'foundation') return a.index === b.index;
  if (a.type === 'house' && b.type === 'house') return a.owner === b.owner && a.index === b.index;
  if ((a.type === 'reserve' && b.type === 'reserve') || (a.type === 'hand' && b.type === 'hand') || (a.type === 'waste' && b.type === 'waste')) {
    return a.owner === b.owner;
  }
  return false;
}

// A house's *actual* clickable/visual position drifts as it fans out (see drawHouse), and a
// foundation's real engine index isn't necessarily where it's displayed (see
// computeFoundationDisplayOrder) — this resolves a ref to where it really is right now, not
// just its raw base grid slot, so the flash overlay lands on the same spot the click
// hit-tested against.
function effectiveSlotPoint(state: GameState, ref: PileRef, mode: TableMode): Point | undefined {
  if (ref.type === 'foundation') {
    const table = computeTableLayout(mode);
    const visualPosition = computeFoundationDisplayOrder(state.foundations).indexOf(ref.index);
    return table.foundations[visualPosition];
  }
  const base = allBaseSlots(mode).find((s) => refsEqual(s.ref, ref))?.point;
  if (!base || ref.type !== 'house') return base;
  const count = state.players[ref.owner].houses[ref.index].length;
  const sign = HOUSE_FAN_SIGN[ref.owner];
  return { x: base.x + Math.max(count - 1, 0) * sign * houseFanPeek(count), y: base.y };
}

// Logical (root-local, pre-letterbox-scale) pixels of pointer movement before a pointerdown
// counts as a drag rather than a plain tap — small enough that an intentional drag always
// crosses it well before release, large enough that a slightly wobbly tap doesn't misfire as
// a drag (which would otherwise skip past onSlotClick's own tap handling for that gesture).
const DRAG_MOVE_THRESHOLD = 6;

interface DragState {
  ref: PileRef;
  sprite: Sprite;
  homePoint: Point;
  startLocal: Point;
  moved: boolean;
  cardId: string;
}

// §14 step 10.5: drag-and-drop, added alongside tap-to-select rather than replacing it (see
// TableSceneHandlers). Deliberately no legal-destination highlighting mid-drag, matching the
// established reactive-only philosophy (gameStore.ts's file comment) — illegal drops get the
// same red-flash + reason banner a rejected tap gets, nothing is disabled or glowed in
// advance. The dragged sprite is reparented into `dragLayer` (so it renders above every other
// pile) for the gesture's duration and reparented back into `cardsLayer` the moment it ends,
// regardless of outcome — a genuine move re-renders cardsLayer from scratch anyway, so that
// reparent-back is only actually load-bearing for the tap/cancel paths.
function createDragController(
  app: Application,
  root: Container,
  cardsLayer: Container,
  dragLayer: Container,
  canPickUp: CanPickUp,
  onDrop: DropHandler,
): DragController {
  let latestState: GameState | null = null;
  let latestMode: TableMode = 'portrait';
  let dragging: DragState | null = null;
  let justDraggedCardId: string | null = null;

  function toLocal(event: FederatedPointerEvent): Point {
    return root.toLocal(event.global);
  }

  function hitTestDrop(point: Point): PileRef | null {
    if (!latestState) return null;
    const state = latestState;
    const hit = allBaseSlots(latestMode).find(({ ref }) => {
      const p = effectiveSlotPoint(state, ref, latestMode);
      return p !== undefined && Math.abs(point.x - p.x) <= CARD_WIDTH / 2 && Math.abs(point.y - p.y) <= CARD_HEIGHT / 2;
    });
    return hit?.ref ?? null;
  }

  function onMove(event: FederatedPointerEvent): void {
    if (!dragging) return;
    const local = toLocal(event);
    dragging.sprite.position.set(local.x, local.y);
    if (!dragging.moved && Math.hypot(local.x - dragging.startLocal.x, local.y - dragging.startLocal.y) > DRAG_MOVE_THRESHOLD) {
      dragging.moved = true;
    }
  }

  function endDrag(event: FederatedPointerEvent): void {
    if (!dragging) return;
    const { ref, sprite, homePoint, moved, cardId } = dragging;
    dragging = null;
    app.stage.off('pointermove', onMove);
    cardsLayer.addChild(sprite);
    sprite.position.set(homePoint.x, homePoint.y);
    if (!moved) return; // a plain tap — onSlotClick's own pointertap handling covers it
    const target = hitTestDrop(toLocal(event));
    if (target && !refsEqual(target, ref)) {
      // The user's own pointer already smoothly carried this card to its new spot — the
      // upcoming re-render shouldn't tween it again from its pre-drag origin (see placeCard).
      justDraggedCardId = cardId;
      onDrop(ref, target);
    }
  }

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerup', endDrag);
  app.stage.on('pointerupoutside', endDrag);

  return {
    setState(state: GameState): void {
      latestState = state;
    },
    setMode(mode: TableMode): void {
      latestMode = mode;
    },
    consumeJustDragged(cardId: string): boolean {
      if (justDraggedCardId !== cardId) return false;
      justDraggedCardId = null;
      return true;
    },
    attach(sprite: Sprite, ref: PileRef, homePoint: Point, cardId: string): void {
      sprite.on('pointerdown', (event: FederatedPointerEvent) => {
        if (!canPickUp(ref)) return;
        dragLayer.addChild(sprite);
        dragging = { ref, sprite, homePoint, startLocal: toLocal(event), moved: false, cardId };
        app.stage.on('pointermove', onMove);
      });
    },
  };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animateCardTo(app: Application, sprite: Sprite, from: Point, to: Point): void {
  const start = performance.now();
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - start) / CARD_MOVE_DURATION_MS);
    const eased = easeOutCubic(t);
    sprite.position.set(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
    if (t >= 1) app.ticker.remove(tick);
  };
  app.ticker.add(tick);
}

// `sprite`'s CURRENT texture is `oldTexture` (the pre-flip face) going in — placeCard swaps
// it there just before calling this — and this animates a horizontal squash-to-a-sliver,
// swaps to `newTexture` (the actual post-flip face) at the midpoint, then grows back out.
// Renormalizes width/height after the swap rather than assuming both textures share a native
// size, so this stays correct even if a face/back SVG's natural dimensions ever drift apart.
function flipCard(app: Application, sprite: Sprite, newTexture: Texture): void {
  const start = performance.now();
  const half = CARD_FLIP_DURATION_MS / 2;
  let baseScaleX = sprite.scale.x;
  let swapped = false;
  const tick = (): void => {
    const elapsed = performance.now() - start;
    if (!swapped && elapsed >= half) {
      sprite.texture = newTexture;
      sprite.width = CARD_WIDTH;
      sprite.height = CARD_HEIGHT;
      baseScaleX = sprite.scale.x;
      swapped = true;
    }
    const factor = swapped ? Math.min(1, (elapsed - half) / half) : Math.max(0, 1 - elapsed / half);
    sprite.scale.x = baseScaleX * factor;
    if (elapsed >= CARD_FLIP_DURATION_MS) {
      sprite.scale.x = baseScaleX;
      app.ticker.remove(tick);
    }
  };
  app.ticker.add(tick);
}

// Every card sprite's position goes through here instead of a raw `sprite.position.set` —
// §14 step 12: if this exact card (by id) rendered somewhere else last render, slide it from
// there to `point` instead of popping directly there (animateCardTo); if it rendered at the
// *same* point but with the other face showing (a hand card just turned up, most commonly),
// flip it in place (flipCard) instead. Skips all animation (snaps straight to `point`,
// current face) for a card seen for the first time (nothing to animate from), a card whose
// position and face both stayed the same, or a card the human's own drag gesture just
// carried here (see DragController.consumeJustDragged — that motion already happened, live,
// under the pointer).
function placeCard(scene: TableScene, sprite: Sprite, card: Card, owner: PlayerId, point: Point): void {
  const stored = scene.cardRenderState.get(card.id);
  // Only trust a stored entry as a genuine "where this card was, continuously, until just
  // now" if it was set on the immediately preceding render — anything older means the card
  // was buried (not this pile's top) for at least one render in between and its position is
  // stale, not a real place to animate from (see the field comment on cardRenderState).
  const previous = stored && stored.generation === scene.renderGeneration - 1 ? stored : undefined;
  const justDragged = scene.dragController.consumeJustDragged(card.id);
  scene.cardRenderState.set(card.id, { point, faceUp: card.faceUp, generation: scene.renderGeneration });

  const samePoint = previous !== undefined && previous.point.x === point.x && previous.point.y === point.y;

  if (!justDragged && previous && samePoint && previous.faceUp !== card.faceUp) {
    sprite.position.set(point.x, point.y);
    sprite.texture = cardTexture({ ...card, faceUp: previous.faceUp }, owner);
    sprite.width = CARD_WIDTH;
    sprite.height = CARD_HEIGHT;
    flipCard(scene.app, sprite, cardTexture(card, owner));
    return;
  }

  if (justDragged || !previous || samePoint) {
    sprite.position.set(point.x, point.y);
    return;
  }
  animateCardTo(scene.app, sprite, previous.point, point);
}

// Approximates the design's `radial-gradient(105% 78% at 50% 50%, ...)` felt background —
// Pixi's radial gradient is circular by default, `scale` elongates it to roughly match the
// mockup's wider-than-tall ellipse for any canvas shape (portrait or landscape).
function feltGradientFill(width: number, height: number): FillGradient {
  return new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.62,
    scale: height / width,
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: FELT_INNER_COLOR },
      { offset: 1, color: FELT_OUTER_COLOR },
    ],
  });
}

export async function createTableScene(container: HTMLElement, handlers: TableSceneHandlers): Promise<TableScene> {
  const { onSlotClick, onPlayAgain, canPickUp, onDrop, onNewGameRequest, isGameInProgress, onLanguageChange, onModeChange } = handlers;
  const app = new Application();
  // `resolution` defaults to 1 (CSS px per physical px) — on any high-DPI/retina screen that
  // renders the whole canvas at a lower density than the display, then lets the browser
  // upscale it, blurring everything (not just card art). `autoDensity` keeps the canvas's CSS
  // size correct once `resolution` inflates its backing store.
  await app.init({
    resizeTo: window,
    backgroundColor: FELT_OUTER_COLOR, // shows in the letterbox pillarbox bars, outside `root`
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);

  await preloadCardTextures();
  // The two Google Fonts (Instrument Serif, IBM Plex Mono — see index.html's <link> tags)
  // load asynchronously; waiting for them here means the very first frame already has the
  // right typography instead of flashing a fallback font on every player-facing label.
  await document.fonts.ready;

  let mode: TableMode = chooseTableMode(app.screen.width, app.screen.height);

  const root = new Container();
  app.stage.addChild(root);

  const backdrop = new Graphics();
  root.addChild(backdrop);

  const outlinesLayer = new Container();
  root.addChild(outlinesLayer);

  const cardsLayer = new Container();
  root.addChild(cardsLayer);

  const dragLayer = new Container();
  root.addChild(dragLayer);

  const overlayLayer = new Container();
  root.addChild(overlayLayer);

  const dragController = createDragController(app, root, cardsLayer, dragLayer, canPickUp, onDrop);
  dragController.setMode(mode);

  const feedbackPanel = new Graphics();
  root.addChild(feedbackPanel);
  const feedbackText = new Text({
    text: '',
    style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 15, lineHeight: 20, align: 'center' },
  });
  feedbackText.anchor.set(0.5);
  root.addChild(feedbackText);

  const turnText = new Text({
    text: '',
    style: { fill: INK_COLOR, fontFamily: FONT_SERIF, fontSize: 22, align: 'center' },
  });
  turnText.anchor.set(0.5);
  root.addChild(turnText);

  const bannerPanel = new Graphics();
  root.addChild(bannerPanel);
  const bannerText = new Text({
    text: '',
    style: {
      fill: RED_INK_COLOR,
      fontFamily: FONT_BODY,
      fontSize: 14,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 520,
    },
  });
  bannerText.anchor.set(0.5, 0);
  root.addChild(bannerText);

  // Redesign v2 handoff (README.md §0): a full-width toolbar band pinned to the top of the
  // logical canvas, replacing the old bottom footer row. Pure presentation, no game-state
  // involvement, so it lives outside the gameStore/renderGameState pipeline; each entry
  // either toggles its own layer's visibility directly, or (language) switches i18next's
  // active language in place.
  const toolbarBand = new Graphics();
  root.addChild(toolbarBand);

  const wordmarkText = new Text({ text: i18next.t('toolbar.wordmark'), style: { fill: INK_COLOR, fontFamily: FONT_SERIF, fontSize: WORDMARK_FONT_SIZE } });
  wordmarkText.anchor.set(0, 0.5);
  root.addChild(wordmarkText);

  const wordmarkDivider = new Graphics();
  root.addChild(wordmarkDivider);

  const qualifierText = new Text({
    text: i18next.t('toolbar.qualifier'),
    style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: QUALIFIER_FONT_SIZE, fontWeight: '500', letterSpacing: QUALIFIER_LETTER_SPACING },
  });
  qualifierText.anchor.set(0, 0.5);
  qualifierText.alpha = QUALIFIER_ALPHA;
  root.addChild(qualifierText);

  // Each modal/popover layer starts empty and hidden; its content is built fresh every time
  // it opens rather than once up front and merely toggled visible — see drawTextModal's
  // comment for why (a real PixiJS hit-testing gotcha, not stylistic preference).
  const aboutLayer = new Container();
  aboutLayer.visible = false;
  root.addChild(aboutLayer);

  const rulesLayer = new Container();
  rulesLayer.visible = false;
  root.addChild(rulesLayer);

  const newGamePopoverLayer = new Container();
  newGamePopoverLayer.visible = false;
  root.addChild(newGamePopoverLayer);

  const settingsPopoverLayer = new Container();
  settingsPopoverLayer.visible = false;
  root.addChild(settingsPopoverLayer);

  function openAboutLayer(): void {
    aboutLayer.visible = true;
    aboutLayer.removeChildren();
    drawTextModal(aboutLayer, ABOUT_PANEL_WIDTH, ABOUT_PANEL_HEIGHT, i18next.t('about.title'), i18next.t('about.body'), logicalSize(mode), () => {
      aboutLayer.visible = false;
    });
  }

  interface ToolbarButton {
    text: Text;
    underline: Graphics;
  }

  // A toolbar label carries its own hover underline (a Graphics sibling, toggled — never
  // interactive itself) and its own hit target, per the standing rule that interactivity
  // lives on a Text, never a Graphics (see makeButtonHitTarget's comment). The tap handler
  // is attached once, here, at creation time; layoutToolbar() only ever updates position and
  // hitArea afterward — re-attaching a listener on every layout pass would stack duplicate
  // handlers and fire the action multiple times per click.
  function makeToolbarButton(label: string, onTap: () => void): ToolbarButton {
    const text = new Text({
      text: label,
      style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: 11, fontWeight: '500', letterSpacing: TOOLBAR_LABEL_LETTER_SPACING },
    });
    text.anchor.set(0.5);
    text.alpha = TOOLBAR_LABEL_ALPHA;
    makeButtonHitTarget(text, 1, 1, onTap); // real size set per layout in layoutToolbar
    root.addChild(text);
    const underline = new Graphics();
    underline.visible = false;
    root.addChild(underline);
    text.on('pointerover', () => {
      text.alpha = 1;
      underline.visible = true;
    });
    text.on('pointerout', () => {
      text.alpha = TOOLBAR_LABEL_ALPHA;
      underline.visible = false;
    });
    return { text, underline };
  }

  const newGameButton = makeToolbarButton(i18next.t('toolbar.newGame'), () => {
    if (!isGameInProgress()) {
      onNewGameRequest();
      return;
    }
    if (newGamePopoverLayer.visible) {
      newGamePopoverLayer.visible = false;
      return;
    }
    settingsPopoverLayer.visible = false;
    newGamePopoverLayer.visible = true;
    newGamePopoverLayer.removeChildren();
    drawNewGamePopover(
      newGamePopoverLayer,
      newGameButton.text.x,
      logicalSize(mode),
      () => {
        newGamePopoverLayer.visible = false;
        onNewGameRequest();
      },
      () => {
        newGamePopoverLayer.visible = false;
      },
    );
  });

  const rulesButton = makeToolbarButton(i18next.t('toolbar.howToPlay'), () => {
    if (rulesLayer.visible) {
      rulesLayer.visible = false;
      return;
    }
    rulesLayer.visible = true;
    rulesLayer.removeChildren();
    drawTextModal(rulesLayer, RULES_PANEL_WIDTH, RULES_PANEL_HEIGHT, i18next.t('rules.title'), i18next.t('rules.body'), logicalSize(mode), () => {
      rulesLayer.visible = false;
    });
  });

  const settingsButton = makeToolbarButton(i18next.t('toolbar.settings'), () => {
    if (settingsPopoverLayer.visible) {
      settingsPopoverLayer.visible = false;
      return;
    }
    newGamePopoverLayer.visible = false;
    settingsPopoverLayer.visible = true;
    settingsPopoverLayer.removeChildren();
    drawSettingsPopover(
      settingsPopoverLayer,
      settingsButton.text.x,
      logicalSize(mode),
      () => {
        settingsPopoverLayer.visible = false;
        openAboutLayer();
      },
      () => {
        settingsPopoverLayer.visible = false;
      },
    );
  });

  const aboutButton = makeToolbarButton(i18next.t('toolbar.about'), () => {
    if (aboutLayer.visible) {
      aboutLayer.visible = false;
      return;
    }
    openAboutLayer();
  });

  const toolbarDivider = new Graphics();
  root.addChild(toolbarDivider);

  // EN/PT segmented control — replaces the old single-toggle footer language button with
  // both languages shown at once, the active one on a gold pill (README.md §0).
  const segmentedTrack = new Graphics();
  root.addChild(segmentedTrack);
  const segmentedPill = new Graphics();
  root.addChild(segmentedPill);
  const segmentedLabels = SUPPORTED_LANGUAGES.map((lang) => {
    const text = new Text({ text: lang.toUpperCase(), style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: SEGMENTED_LABEL_FONT_SIZE, fontWeight: '500' } });
    text.anchor.set(0.5);
    makeButtonHitTarget(text, 1, 1, () => {
      if (lang === i18next.language) return;
      setLanguage(lang).then(() => {
        refreshStaticText();
        onLanguageChange();
      });
    });
    root.addChild(text);
    return { lang, text };
  });

  // Every mode-dependent piece of *static* chrome (built once, not per-renderGameState-call)
  // gets repositioned/redrawn here — called at startup, on every resize (toolbar item widths
  // depend on the logical width), and again whenever a resize crosses the portrait/landscape
  // aspect threshold (see the resize handler below). Gameplay content (cardsLayer/
  // overlayLayer) doesn't need a mirror of this: it's already fully rebuilt every
  // renderGameState call, so simply triggering one (onModeChange) picks up the new mode.
  function layoutToolbar(width: number): void {
    toolbarBand.clear().rect(0, 0, width, TOOLBAR_HEIGHT).fill({ color: 0x000000, alpha: TOOLBAR_BG_ALPHA });
    toolbarBand
      .moveTo(0, TOOLBAR_HEIGHT - 0.5)
      .lineTo(width, TOOLBAR_HEIGHT - 0.5)
      .stroke({ color: INK_COLOR, alpha: TOOLBAR_BORDER_ALPHA, width: 1 });

    let leftX = TOOLBAR_PADDING_X;
    wordmarkText.position.set(leftX, TOOLBAR_HEIGHT / 2);
    leftX += wordmarkText.width + 14;
    wordmarkDivider.clear().rect(leftX, (TOOLBAR_HEIGHT - DIVIDER_HEIGHT) / 2, 1, DIVIDER_HEIGHT).fill({ color: INK_COLOR, alpha: TOOLBAR_DIVIDER_ALPHA });
    leftX += 1 + 14;
    qualifierText.position.set(leftX, TOOLBAR_HEIGHT / 2);

    // Right group, right-to-left: segmented control, a divider, then the four buttons —
    // widths are measured (not assumed), since string length varies by locale.
    const labelWidths = segmentedLabels.map(({ text }) => text.width);
    const pillWidths = labelWidths.map((w) => w + SEGMENTED_LABEL_PAD_X * 2);
    const trackWidth = SEGMENTED_PADDING * 2 + pillWidths[0] + SEGMENTED_LABEL_GAP + pillWidths[1];
    const trackX = width - TOOLBAR_PADDING_X - trackWidth;
    const trackY = (TOOLBAR_HEIGHT - SEGMENTED_TRACK_HEIGHT) / 2;
    segmentedTrack
      .clear()
      .roundRect(trackX, trackY, trackWidth, SEGMENTED_TRACK_HEIGHT, SEGMENTED_TRACK_HEIGHT / 2)
      .fill({ color: INK_COLOR, alpha: SEGMENTED_TRACK_ALPHA });

    const activeIndex = segmentedLabels.findIndex(({ lang }) => lang === i18next.language);
    segmentedPill.clear();
    let pillX = trackX + SEGMENTED_PADDING;
    segmentedLabels.forEach(({ text }, i) => {
      const pillWidth = pillWidths[i];
      if (i === activeIndex) {
        const pillHeight = SEGMENTED_TRACK_HEIGHT - SEGMENTED_PADDING * 2;
        segmentedPill.roundRect(pillX, trackY + SEGMENTED_PADDING, pillWidth, pillHeight, pillHeight / 2).fill(GOLD_COLOR);
      }
      text.style.fill = i === activeIndex ? GOLD_LABEL_COLOR : INK_COLOR;
      text.position.set(pillX + pillWidth / 2, TOOLBAR_HEIGHT / 2);
      text.hitArea = new Rectangle(-pillWidth / 2, -SEGMENTED_TRACK_HEIGHT / 2, pillWidth, SEGMENTED_TRACK_HEIGHT);
      pillX += pillWidth + SEGMENTED_LABEL_GAP;
    });

    let rightEdge = trackX - TOOLBAR_ITEM_GAP;
    toolbarDivider.clear().rect(rightEdge - 1, (TOOLBAR_HEIGHT - DIVIDER_HEIGHT) / 2, 1, DIVIDER_HEIGHT).fill({ color: INK_COLOR, alpha: TOOLBAR_DIVIDER_ALPHA });
    rightEdge -= 1 + TOOLBAR_ITEM_GAP;

    for (const button of [aboutButton, settingsButton, rulesButton, newGameButton]) {
      const labelWidth = button.text.width;
      const centerX = rightEdge - labelWidth / 2;
      button.text.position.set(centerX, TOOLBAR_HEIGHT / 2);
      button.text.hitArea = new Rectangle(-labelWidth / 2 - 8, -TOOLBAR_HEIGHT / 2, labelWidth + 16, TOOLBAR_HEIGHT);
      button.underline.clear();
      button.underline
        .rect(centerX - labelWidth / 2 - HOVER_UNDERLINE_BLEED, TOOLBAR_HEIGHT - HOVER_UNDERLINE_HEIGHT, labelWidth + HOVER_UNDERLINE_BLEED * 2, HOVER_UNDERLINE_HEIGHT)
        .fill(GOLD_COLOR);
      rightEdge -= labelWidth + TOOLBAR_ITEM_GAP;
    }
  }

  // Every mode-dependent piece of *static* chrome (built once, not per-renderGameState-call)
  // gets repositioned/redrawn here — called at startup and again whenever a resize crosses
  // the portrait/landscape aspect threshold (see the resize handler below). Gameplay content
  // (cardsLayer/overlayLayer) doesn't need a mirror of this: it's already fully rebuilt every
  // renderGameState call, so simply triggering one (onModeChange) picks up the new mode.
  function layoutChrome(): void {
    const { width, height } = logicalSize(mode);
    backdrop.clear();
    backdrop.rect(0, 0, width, height).fill(feltGradientFill(width, height));
    outlinesLayer.removeChildren();
    drawSlotOutlines(outlinesLayer, mode);
    feedbackText.position.set(width / 2, FEEDBACK_TEXT_Y);
    turnText.position.set(width / 2, TURN_TEXT_Y);
    bannerText.position.set(width / 2, BANNER_TEXT_Y);
    layoutToolbar(width);
  }
  layoutChrome();

  // Only the persistent toolbar labels need refreshing on a language switch — the layered
  // modals/popovers above always rebuild with the current language on their next open
  // anyway. Also re-runs layoutToolbar since every label's measured width (and therefore the
  // whole right group's position) can change when the copy changes language.
  function refreshStaticText(): void {
    wordmarkText.text = i18next.t('toolbar.wordmark');
    qualifierText.text = i18next.t('toolbar.qualifier');
    newGameButton.text.text = i18next.t('toolbar.newGame');
    rulesButton.text.text = i18next.t('toolbar.howToPlay');
    settingsButton.text.text = i18next.t('toolbar.settings');
    aboutButton.text.text = i18next.t('toolbar.about');
    layoutToolbar(logicalSize(mode).width);
  }
  refreshStaticText();

  const applyLetterbox = (): void => {
    const { width, height } = logicalSize(mode);
    const scale = Math.min(app.screen.width / width, app.screen.height / height);
    root.scale.set(scale);
    root.x = (app.screen.width - width * scale) / 2;
    root.y = (app.screen.height - height * scale) / 2;
    // `app.stage.hitArea` is a snapshot Rectangle, not live-bound to `app.screen` — refresh it
    // whenever the screen resizes so the drag controller's stage-wide pointermove/pointerup
    // tracking (see createDragController) keeps covering the whole canvas.
    app.stage.hitArea = app.screen;
  };
  applyLetterbox();
  // `resizeTo` doesn't resize synchronously with the window's own 'resize' event (it's
  // driven by a ResizeObserver internally) — listen on the renderer's own 'resize' instead,
  // which fires only after app.screen has actually been updated. A resize can also cross the
  // portrait/landscape aspect threshold (window resize, tablet rotation) — when it does, the
  // static chrome is rebuilt for the new mode and onModeChange asks main.ts for a fresh
  // renderGameState call so pile positions catch up too (see layoutChrome's comment).
  app.renderer.on('resize', () => {
    const nextMode = chooseTableMode(app.screen.width, app.screen.height);
    if (nextMode !== mode) {
      mode = nextMode;
      dragController.setMode(mode);
      layoutChrome();
      onModeChange();
    }
    applyLetterbox();
  });

  return {
    app,
    root,
    cardsLayer,
    overlayLayer,
    feedbackText,
    feedbackPanel,
    turnText,
    bannerText,
    bannerPanel,
    onSlotClick,
    onPlayAgain,
    dragController,
    get mode() {
      return mode;
    },
    cardRenderState: new Map(),
    renderGeneration: 0,
  };
}

// Purely visual, drawn once per mode — every slot's base grid position, whether or not it
// currently holds a card. The actual click targets live in cardsLayer (see makeClickable
// below) so they can track a fanned house's real position instead of a fixed rectangle.
function drawSlotOutlines(layer: Container, mode: TableMode): void {
  for (const { point } of allBaseSlots(mode)) {
    layer.addChild(
      new Graphics()
        .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
        .stroke({ color: SLOT_OUTLINE_COLOR, alpha: SLOT_OUTLINE_ALPHA, width: 2 }),
    );
  }
}

function makeClickable(target: Sprite | Graphics, ref: PileRef, onSlotClick: SlotClickHandler): void {
  target.eventMode = 'static';
  target.cursor = 'pointer';
  target.on('pointertap', () => onSlotClick(ref));
}

// An empty pile has no sprite to attach a click handler to, but it's still a perfectly
// valid destination (an empty house/foundation accepts a card) — an invisible but fully
// hit-testable filled rect at its base slot covers that. Used for hand/waste/reserve, which
// have no special empty-state visual in the redesign; foundations and houses use the more
// elaborate drawEmptyFoundationSlot/drawEmptyHouseSlot below instead.
// An empty pile has nothing to hang a click handler on — but per the hard-won rule above
// (see makeButtonHitTarget's comment), a Graphics object with eventMode:'static' reliably
// fails hit-testing in this codebase's pixi.js version; that turned out NOT to be limited to
// modal layers as first diagnosed, it reproduces on board Graphics hit-zones too (confirmed
// directly: an empty foundation built as an interactive Graphics silently ate every click).
// So every empty-slot hit target here is a Text object (visible label or an empty dummy),
// exactly like a modal button, never a Graphics rect.
function drawEmptyHitZone(layer: Container, ref: PileRef, point: Point, onSlotClick: SlotClickHandler): void {
  const hit = new Text({ text: '', style: { fontSize: 1 } });
  hit.anchor.set(0.5);
  hit.position.set(point.x, point.y);
  makeButtonHitTarget(hit, CARD_WIDTH, CARD_HEIGHT, () => onSlotClick(ref));
  layer.addChild(hit);
}

const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

// A foundation's row has an intended suit (FOUNDATION_ROW_SUIT) independent of whether any
// card of that suit has actually landed there yet — showing that glyph even while the slot
// is empty previews what belongs there, matching the redesign. The background/border
// Graphics is purely decorative; the glyph Text carries all the interactivity (see
// drawEmptyHitZone's comment above).
function drawEmptyFoundationSlot(layer: Container, ref: PileRef, point: Point, suit: Suit, onSlotClick: SlotClickHandler): void {
  layer.addChild(
    new Graphics()
      .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
      .fill({ color: INK_COLOR, alpha: 0.05 })
      .stroke({ color: INK_COLOR, alpha: HAIRLINE_ALPHA, width: 1 }),
  );
  const glyph = new Text({ text: SUIT_GLYPH[suit], style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 26 } });
  glyph.alpha = 0.22;
  glyph.anchor.set(0.5);
  glyph.position.set(point.x, point.y);
  makeButtonHitTarget(glyph, CARD_WIDTH, CARD_HEIGHT, () => onSlotClick(ref));
  layer.addChild(glyph);
}

// Pixi has no native dashed-stroke option — approximated as a plain solid low-alpha border
// rather than hand-building a dash pattern from short line segments. Documented as a
// deliberate simplification, see docs/known-issues.md. The border Graphics is purely
// decorative; the label Text carries all the interactivity (see drawEmptyHitZone's comment).
function drawEmptyHouseSlot(layer: Container, ref: PileRef, point: Point, onSlotClick: SlotClickHandler): void {
  layer.addChild(
    new Graphics().roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS).stroke({ color: INK_COLOR, alpha: 0.24, width: 1 }),
  );
  const label = new Text({
    text: i18next.t('board.emptyHouse'),
    style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 0.6, align: 'center', wordWrap: true, wordWrapWidth: CARD_WIDTH - 10 },
  });
  label.alpha = 0.55;
  label.anchor.set(0.5);
  label.position.set(point.x, point.y);
  makeButtonHitTarget(label, CARD_WIDTH, CARD_HEIGHT, () => onSlotClick(ref));
  layer.addChild(label);
}

function drawCardShadow(layer: Container, point: Point): void {
  layer.addChild(
    new Graphics()
      .roundRect(point.x - CARD_WIDTH / 2 + CARD_SHADOW_OFFSET, point.y - CARD_HEIGHT / 2 + CARD_SHADOW_OFFSET, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
      .fill({ color: CARD_SHADOW_COLOR, alpha: CARD_SHADOW_ALPHA }),
  );
}

function drawSelectionBorder(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2 - 4, point.y - CARD_HEIGHT / 2 - 4 - SELECTED_LIFT_Y, CARD_WIDTH + 8, CARD_HEIGHT + 8, SLOT_CORNER_RADIUS + 2)
    .stroke({ color: GOLD_COLOR, width: 3 });
  layer.addChild(g);
}

// The compulsory-move source gets a heavier, glowing-adjacent ring (approximated as a
// thicker solid stroke — no blur filter, same reasoning as CARD_SHADOW's approximation) to
// distinguish "this one you're forced to play" from an ordinary tap-selection.
function drawForcedRing(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2 - 5, point.y - CARD_HEIGHT / 2 - 5, CARD_WIDTH + 10, CARD_HEIGHT + 10, SLOT_CORNER_RADIUS + 2)
    .stroke({ color: GOLD_COLOR, width: 4 });
  layer.addChild(g);
}

// Doc's "REJECTED" drag state: a red ring plus a soft red fill, not just a flat fill.
function drawFlashOverlay(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
    .fill({ color: RED_COLOR, alpha: 0.18 })
    .stroke({ color: RED_COLOR, width: 2 });
  layer.addChild(g);
}

function drawCountBadge(layer: Container, point: Point, count: number): void {
  if (count <= 0) return;
  const cx = point.x + CARD_WIDTH / 2;
  const cy = point.y + CARD_HEIGHT / 2;
  layer.addChild(new Graphics().circle(cx, cy, COUNT_BADGE_RADIUS).fill({ color: COUNT_BADGE_COLOR, alpha: COUNT_BADGE_ALPHA }));
  const text = new Text({ text: String(count), style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: 12, fontWeight: '600' } });
  text.anchor.set(0.5);
  text.position.set(cx, cy);
  layer.addChild(text);
}

// Shared by the About/Legal and How to Play modals — (re)built fresh into `layer` every time
// it's opened (see openModal in createTableScene): a dim full-canvas backdrop (click to
// close) plus a centered panel with a title, a body of text, and an explicit close button.
//
// Deliberately NOT built once and left toggling `.visible` — a PixiJS gotcha found the hard
// way: an `eventMode: 'static'` Graphics/Text object created while its container is
// `visible: false` never becomes properly hit-testable, even after the container is later
// set back to `visible: true` (confirmed via a minimal repro: the exact same shape/listener
// setup worked immediately when created *after* setting the container visible, and never
// worked when pre-built invisible and toggled later — huge thanks to spending an entire
// debugging pass on this exact class of bug, isolating it down to that one variable). Content
// is passed in directly (not returned as refs to patch later) since rebuilding on every open
// already picks up the current language automatically — no separate refresh path needed.
function drawTextModal(layer: Container, width: number, height: number, title: string, body: string, logical: { width: number; height: number }, onClose: () => void): void {
  const backdrop = new Graphics().rect(0, 0, logical.width, logical.height).fill({ color: 0x000000, alpha: OVERLAY_BG_ALPHA });
  backdrop.eventMode = 'static';
  backdrop.on('pointertap', onClose);
  layer.addChild(backdrop);

  const panelX = (logical.width - width) / 2;
  const panelY = (logical.height - height) / 2;
  const panel = new Graphics().roundRect(panelX, panelY, width, height, 14).fill(PANEL_GROUND_COLOR).stroke({ color: INK_COLOR, alpha: HAIRLINE_ALPHA, width: 1 });
  panel.eventMode = 'static'; // swallow taps so clicking the panel itself doesn't close it via the backdrop
  layer.addChild(panel);

  const titleText = new Text({ text: title, style: { fill: INK_COLOR, fontFamily: FONT_SERIF, fontSize: 24 } });
  titleText.position.set(panelX + 24, panelY + 20);
  layer.addChild(titleText);

  const bodyText = new Text({
    text: body,
    style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 14, lineHeight: 20, wordWrap: true, wordWrapWidth: width - 48 },
  });
  bodyText.alpha = 0.85;
  bodyText.position.set(panelX + 24, panelY + 62);
  layer.addChild(bodyText);

  const closeText = new Text({ text: '✕', style: { fill: INK_COLOR, fontFamily: FONT_MONO, fontSize: 18, fontWeight: '600' } });
  closeText.anchor.set(0.5);
  closeText.position.set(panelX + width - 22, panelY + 22);
  closeText.eventMode = 'static';
  closeText.cursor = 'pointer';
  closeText.on('pointertap', onClose);
  layer.addChild(closeText);
}

// A button rendered as a non-interactive Graphics background plus a Text label that carries
// ALL the interactivity itself (eventMode/cursor/hitArea/pointertap) — deliberately NOT the
// more obvious "put the listener on the Graphics rect" approach. Found via direct EventBoundary
// introspection (Playwright + scene.app.renderer.events.rootBoundary.hitTest, not guesswork):
// in pixi.js 8.19.0, a Graphics object sitting among these particular modal-layer siblings
// reliably FAILS hit-testing — confirmed false for both an explicit `.hitArea` Rectangle *and*
// Pixi's own auto-computed bounds from the drawn shape, and even for a brand-new Graphics added
// fresh at runtime — while a Text object in the exact same layer, same position, hit-tests
// correctly every time (auto text bounds or an explicit Rectangle hitArea, both verified). This
// is what silently broke the New Game confirm dialog's buttons despite the earlier explicit-
// hitArea fix (see historical comment this replaces) — that fix targeted the wrong object type.
function makeButtonHitTarget(text: Text, width: number, height: number, onTap: () => void): void {
  text.eventMode = 'static';
  text.cursor = 'pointer';
  text.hitArea = new Rectangle(-width / 2, -height / 2, width, height);
  text.on('pointertap', onTap);
}

// Redesign v2 handoff (README.md §0): a small panel anchored below the toolbar item that
// opened it — unlike the full-screen, centered About/Rules modals. Rebuilt fresh on every
// open, same reasoning as drawTextModal. Deliberately never Graphics-interactive: even
// "tap outside to close" and "tapping the panel itself doesn't close it" route through
// invisible Text hit zones (see drawEmptyHitZone above) — this file must not gain a new
// Graphics-based button (see known-issues.md's Graphics hit-test entry).
function drawInvisibleHitZone(layer: Container, x: number, y: number, width: number, height: number, onTap: () => void): void {
  const hit = new Text({ text: '', style: { fontSize: 1 } });
  hit.anchor.set(0.5);
  hit.position.set(x, y);
  makeButtonHitTarget(hit, width, height, onTap);
  layer.addChild(hit);
}

// Clamps the popover so it never runs past the canvas edge — the button that opened it can
// sit anywhere along the toolbar, near either edge.
function popoverAnchorX(buttonCenterX: number, popoverWidth: number, logicalWidth: number): number {
  const raw = buttonCenterX - popoverWidth / 2;
  return Math.min(Math.max(raw, POPOVER_SIDE_MARGIN), logicalWidth - POPOVER_SIDE_MARGIN - popoverWidth);
}

function drawPopoverPanel(layer: Container, x: number, y: number, width: number, height: number, borderColor: number, borderAlpha: number): void {
  layer.addChild(new Graphics().roundRect(x, y + 6, width, height, 12).fill({ color: CARD_SHADOW_COLOR, alpha: 0.35 }));
  layer.addChild(new Graphics().roundRect(x, y, width, height, 12).fill(PANEL_GROUND_COLOR).stroke({ color: borderColor, alpha: borderAlpha, width: 1 }));
}

function drawPopoverButton(layer: Container, centerX: number, centerY: number, label: string, filled: boolean, onTap: () => void): number {
  const text = new Text({
    text: label,
    style: { fill: filled ? GOLD_LABEL_COLOR : INK_COLOR, fontFamily: FONT_MONO, fontSize: 11, fontWeight: filled ? '600' : '500', letterSpacing: 1.1 },
  });
  const width = text.width + POPOVER_BUTTON_PAD_X * 2;
  const bg = new Graphics().roundRect(centerX - width / 2, centerY - POPOVER_BUTTON_HEIGHT / 2, width, POPOVER_BUTTON_HEIGHT, 10);
  if (filled) bg.fill(GOLD_COLOR);
  else bg.fill({ color: INK_COLOR, alpha: 0.04 }).stroke({ color: INK_COLOR, alpha: 0.2, width: 1 });
  layer.addChild(bg);
  text.anchor.set(0.5);
  text.position.set(centerX, centerY);
  makeButtonHitTarget(text, width, POPOVER_BUTTON_HEIGHT, onTap);
  layer.addChild(text);
  return width;
}

// New Game "confirms in place" (README.md §0) — only shown while a game is actually in
// progress (see isGameInProgress in TableSceneHandlers); with none in progress it's never
// called at all, the toolbar acts immediately instead.
function drawNewGamePopover(layer: Container, anchorX: number, logical: { width: number; height: number }, onConfirm: () => void, onClose: () => void): void {
  const width = NEW_GAME_POPOVER_WIDTH;
  const x = popoverAnchorX(anchorX, width, logical.width);
  const y = TOOLBAR_HEIGHT + POPOVER_TOP_MARGIN;

  drawInvisibleHitZone(layer, logical.width / 2, logical.height / 2, logical.width, logical.height, onClose);

  const messageText = new Text({
    text: i18next.t('newGameConfirm.message'),
    style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 14, lineHeight: 20, wordWrap: true, wordWrapWidth: width - POPOVER_PADDING * 2 },
  });
  const buttonY = y + POPOVER_PADDING + messageText.height + 16 + POPOVER_BUTTON_HEIGHT / 2;
  const height = POPOVER_PADDING * 2 + messageText.height + 16 + POPOVER_BUTTON_HEIGHT;

  drawPopoverPanel(layer, x, y, width, height, GOLD_COLOR, 0.3);
  drawInvisibleHitZone(layer, x + width / 2, y + height / 2, width, height, () => {}); // swallow taps on the panel itself
  messageText.position.set(x + POPOVER_PADDING, y + POPOVER_PADDING);
  layer.addChild(messageText);

  // Measure both button labels before placing either, so the secondary (left) button's
  // position can account for the primary (right) button's actual width.
  const measure = (label: string, fontWeight: '500' | '600'): number =>
    new Text({ text: label, style: { fontFamily: FONT_MONO, fontSize: 11, fontWeight, letterSpacing: 1.1 } }).width + POPOVER_BUTTON_PAD_X * 2;
  const confirmLabel = i18next.t('newGameConfirm.confirm');
  const keepLabel = i18next.t('newGameConfirm.keepPlaying');
  const confirmWidth = measure(confirmLabel, '600');
  const keepWidth = measure(keepLabel, '500');
  const rightEdge = x + width - POPOVER_PADDING;
  drawPopoverButton(layer, rightEdge - confirmWidth / 2, buttonY, confirmLabel, true, onConfirm);
  drawPopoverButton(layer, rightEdge - confirmWidth - POPOVER_BUTTON_GAP - keepWidth / 2, buttonY, keepLabel, false, onClose);
}

// Settings stub (per this round's scope decision — see the plan/known-issues.md): the only
// row that has anything real behind it today is the About/Legal one, so that's the only row
// built. Deck art / Table view / Pile layout stay out until those features actually exist.
function drawSettingsPopover(layer: Container, anchorX: number, logical: { width: number; height: number }, onOpenAbout: () => void, onClose: () => void): void {
  const width = SETTINGS_POPOVER_WIDTH;
  const x = popoverAnchorX(anchorX, width, logical.width);
  const y = TOOLBAR_HEIGHT + POPOVER_TOP_MARGIN;
  const rowHeight = 48;
  const height = POPOVER_PADDING * 2 + rowHeight;

  drawInvisibleHitZone(layer, logical.width / 2, logical.height / 2, logical.width, logical.height, onClose);
  drawPopoverPanel(layer, x, y, width, height, INK_COLOR, HAIRLINE_ALPHA);

  const rowCenterY = y + POPOVER_PADDING + rowHeight / 2;
  const titleText = new Text({ text: i18next.t('settings.aboutLegalTitle'), style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 13.5 } });
  titleText.position.set(x + POPOVER_PADDING, rowCenterY - 15);
  const subText = new Text({ text: i18next.t('settings.aboutLegalSub'), style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 11 } });
  subText.alpha = 0.45;
  subText.position.set(x + POPOVER_PADDING, rowCenterY + 3);
  const disclosure = new Text({ text: '›', style: { fill: INK_COLOR, fontFamily: FONT_BODY, fontSize: 18 } });
  disclosure.alpha = 0.45;
  disclosure.anchor.set(1, 0.5);
  disclosure.position.set(x + width - POPOVER_PADDING, rowCenterY);
  layer.addChild(titleText, subText, disclosure);

  drawInvisibleHitZone(layer, x + width / 2, rowCenterY, width - POPOVER_PADDING * 2, rowHeight, () => {
    onClose();
    onOpenAbout();
  });
}

function endScreenTitle(state: GameState): string {
  if (state.status === 'won' && state.winner) return i18next.t(state.winner === 'human' ? 'end.youWon' : 'end.cpuWon');
  if (state.status === 'stalemate') {
    if (!state.winner) return i18next.t('end.stalemate');
    const winner = i18next.t(state.winner === 'human' ? 'end.stalemateHumanWins' : 'end.stalemateCpuWins');
    return i18next.t('end.stalemateWinner', { winner });
  }
  return '';
}

// §14 step 9: the win/stalemate end screen — a dedicated overlay (not just turnText, which
// is blanked once the game ends, see turnLabel) so the result and a way to start over are
// impossible to miss.
function drawEndScreen(layer: Container, state: GameState, onPlayAgain: () => void, logical: { width: number; height: number }): void {
  const centerX = logical.width / 2;
  const centerY = logical.height / 2;
  layer.addChild(new Graphics().rect(0, 0, logical.width, logical.height).fill({ color: 0x000000, alpha: OVERLAY_BG_ALPHA }));

  const title = new Text({ text: endScreenTitle(state), style: { fill: INK_COLOR, fontFamily: FONT_SERIF, fontSize: 42, align: 'center' } });
  title.anchor.set(0.5);
  title.position.set(centerX, centerY + OVERLAY_TITLE_Y_OFFSET);
  layer.addChild(title);

  const scores = state.scores;
  const scoreLine = scores ? i18next.t('end.scoreLine', { human: scores.human, cpu: scores.cpu }) : '';
  const scoreText = new Text({ text: scoreLine, style: { fill: GOLD_INK_COLOR, fontFamily: FONT_MONO, fontSize: 18, align: 'center' } });
  scoreText.anchor.set(0.5);
  scoreText.position.set(centerX, centerY + OVERLAY_SCORE_Y_OFFSET);
  layer.addChild(scoreText);

  const buttonY = centerY + OVERLAY_BUTTON_Y_OFFSET;
  const buttonX = centerX - PLAY_AGAIN_BUTTON_WIDTH / 2;
  layer.addChild(new Graphics().roundRect(buttonX, buttonY - PLAY_AGAIN_BUTTON_HEIGHT / 2, PLAY_AGAIN_BUTTON_WIDTH, PLAY_AGAIN_BUTTON_HEIGHT, 10).fill(GOLD_COLOR));

  const buttonText = new Text({ text: i18next.t('end.playAgain'), style: { fill: GOLD_LABEL_COLOR, fontFamily: FONT_MONO, fontSize: 14, fontWeight: '600', letterSpacing: 1 } });
  buttonText.anchor.set(0.5);
  buttonText.position.set(centerX, buttonY);
  makeButtonHitTarget(buttonText, PLAY_AGAIN_BUTTON_WIDTH, PLAY_AGAIN_BUTTON_HEIGHT, onPlayAgain);
  layer.addChild(buttonText);
}

// A foundation runs exactly A(1) through K(13), one card per rank (canPlayToFoundation
// only ever allows the next rank up) — so `cards.length === FOUNDATION_COMPLETE_SIZE`
// reliably means the top card is the King and the run is done.
const FOUNDATION_COMPLETE_SIZE = 13;

// Foundations only ever show their top card (§2/§3) — the rest is simply not the
// visible/available one, and there's no useful "how many are underneath" signal for a
// foundation the way there is for a stock pile.
function drawTopCardOnly(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef, rowSuit: Suit): void {
  if (cards.length === 0) {
    drawEmptyFoundationSlot(layer, ref, point, rowSuit, scene.onSlotClick);
    return;
  }
  const rawCard = cards[cards.length - 1];
  // Display-only convention (pagat.com's rules page: "it is usual to turn the King
  // face-down to indicate that the foundation pile is complete") — doesn't touch the
  // actual GameState card, and doesn't need to: a full foundation already naturally
  // accepts no further cards (canPlayToFoundation only allows the next rank up), so this
  // has no legality consequence, purely a "this one's done" visual signal.
  const complete = cards.length === FOUNDATION_COMPLETE_SIZE;
  const card = complete ? { ...rawCard, faceUp: false } : rawCard;
  drawCardShadow(layer, point);
  const sprite = createCardSprite(card);
  placeCard(scene, sprite, card, 'human', point);
  makeClickable(sprite, ref, scene.onSlotClick);
  layer.addChild(sprite);
  drawCountBadge(layer, point, cards.length);
}

// Roughly how many cards are "underneath" a stock-style pile, translated into a small
// number of cheap filler layers — a depth *impression*, not an exact count (a real pile of
// cards doesn't let you count it by eye either).
function stackDepthLayers(cardCount: number): number {
  if (cardCount <= 1) return 0;
  return Math.min(STACK_DEPTH_MAX_LAYERS, Math.ceil((cardCount - 1) / 4));
}

function drawStackFiller(layer: Container, point: Point, layerIndex: number): void {
  const offset = layerIndex * STACK_DEPTH_OFFSET;
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2 + offset, point.y - CARD_HEIGHT / 2 + offset, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
    .fill(STACK_FILLER_COLOR)
    .stroke({ color: 0x000000, alpha: STACK_FILLER_BORDER_ALPHA, width: 1 });
  layer.addChild(g);
}

// A pile's tap-selection state (`lifted`), whether it's the source of a currently-pending
// compulsory move (`forced` — gets the heavier ring), and whether it should read as
// ineligible while some *other* pile is that forced source (`dimmed`) — see pileHighlight.
interface PileHighlight {
  lifted: boolean;
  forced: boolean;
  dimmed: boolean;
}

// Talon/waste/reserve only ever show their top card too, but as a *pile* (unlike a
// foundation) — fan a few filler layers behind the top card so its thickness hints at how
// much is left, per the request that you shouldn't have to guess whether the reserve is
// nearly empty.
function drawStackedPile(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef, owner: PlayerId, highlight: PileHighlight): void {
  if (cards.length === 0) {
    drawEmptyHitZone(layer, ref, point, scene.onSlotClick);
    return;
  }
  const layers = stackDepthLayers(cards.length);
  for (let i = layers; i >= 1; i--) {
    drawStackFiller(layer, point, i);
  }
  const card = cards[cards.length - 1];
  drawCardShadow(layer, point);
  const sprite = createCardSprite(card, owner);
  sprite.alpha = highlight.dimmed ? 0.5 : 1;
  const spritePoint = { x: point.x, y: point.y - (highlight.lifted ? SELECTED_LIFT_Y : 0) };
  placeCard(scene, sprite, card, owner, spritePoint);
  makeClickable(sprite, ref, scene.onSlotClick);
  scene.dragController.attach(sprite, ref, spritePoint, card.id);
  layer.addChild(sprite);
  if (highlight.lifted) drawSelectionBorder(layer, point);
  if (highlight.forced) drawForcedRing(layer, point);
  drawCountBadge(layer, point, cards.length);
}

// Houses fan sideways from `point` — outward, away from the shared foundation columns in
// the middle (see HOUSE_FAN_SIGN) — so the descending-alternating-color sequence stays
// legible, matching Russian Bank's traditional physical layout. Only the actual top
// (available) card is clickable; a house long enough to run its fan off the edge of the
// canvas is a real (if rare) visual edge case left for a later polish pass.
function drawHouse(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef, owner: PlayerId, highlight: PileHighlight): void {
  if (cards.length === 0) {
    drawEmptyHouseSlot(layer, ref, point, scene.onSlotClick);
    return;
  }
  const sign = HOUSE_FAN_SIGN[owner];
  const peek = houseFanPeek(cards.length);
  let topSprite: Sprite | undefined;
  let topSpritePoint: Point | undefined;
  let topCardId: string | undefined;
  cards.forEach((card, i) => {
    const cardPoint = { x: point.x + i * sign * peek, y: point.y - (i === cards.length - 1 && highlight.lifted ? SELECTED_LIFT_Y : 0) };
    drawCardShadow(layer, cardPoint);
    const sprite = createCardSprite(card);
    sprite.alpha = highlight.dimmed ? 0.5 : 1;
    const isTop = i === cards.length - 1;
    placeCard(scene, sprite, card, 'human', cardPoint);
    layer.addChild(sprite);
    if (isTop) {
      topSprite = sprite;
      topSpritePoint = cardPoint;
      topCardId = card.id;
    }
  });
  if (topSprite && topSpritePoint && topCardId) {
    makeClickable(topSprite, ref, scene.onSlotClick);
    scene.dragController.attach(topSprite, ref, topSpritePoint, topCardId);
  }
  const topPoint = { x: point.x + (cards.length - 1) * sign * peek, y: point.y };
  if (highlight.lifted) drawSelectionBorder(layer, topPoint);
  if (highlight.forced) drawForcedRing(layer, topPoint);
  drawCountBadge(layer, point, cards.length);
}

function isCompulsorySource(compulsory: Move[] | null, ref: PileRef): boolean {
  return compulsory !== null && compulsory.some((m) => refsEqual(m.from, ref));
}

function pileHighlight(compulsory: Move[] | null, ref: PileRef, lifted: boolean): PileHighlight {
  const forced = isCompulsorySource(compulsory, ref);
  const dimmed = compulsory !== null && compulsory.length > 0 && !forced;
  return { lifted, forced, dimmed };
}

function drawPlayerRow(scene: TableScene, layer: Container, state: GameState, player: PlayerId, row: PlayerRowLayout, selected: PileRef | null, compulsory: Move[] | null): void {
  const p = state.players[player];
  const isSelected = (type: 'hand' | 'waste' | 'reserve'): boolean => selected !== null && selected.type === type && selected.owner === player;
  const handRef: PileRef = { type: 'hand', owner: player };
  const wasteRef: PileRef = { type: 'waste', owner: player };
  const reserveRef: PileRef = { type: 'reserve', owner: player };
  drawStackedPile(scene, layer, p.hand, row.hand, handRef, player, pileHighlight(compulsory, handRef, isSelected('hand')));
  drawStackedPile(scene, layer, p.waste, row.waste, wasteRef, player, pileHighlight(compulsory, wasteRef, isSelected('waste')));
  drawStackedPile(scene, layer, p.reserve, row.reserve, reserveRef, player, pileHighlight(compulsory, reserveRef, isSelected('reserve')));
  p.houses.forEach((house, i) => {
    const index = i as 0 | 1 | 2 | 3;
    const houseRef: PileRef = { type: 'house', owner: player, index };
    const lifted = selected !== null && selected.type === 'house' && selected.owner === player && selected.index === index;
    drawHouse(scene, layer, house, row.houses[i], houseRef, player, pileHighlight(compulsory, houseRef, lifted));
  });
}

// Blank once the game has ended — the dedicated end screen (drawEndScreen) covers that, so
// this only ever needs to say whose turn it currently is.
function turnLabel(state: GameState): string {
  if (state.status !== 'in_progress') return '';
  return i18next.t(state.turn === 'human' ? 'turn.human' : 'turn.cpu');
}

export function renderGameState(scene: TableScene, state: GameState, selected: PileRef | null, flash: FeedbackFlash | null, compulsory: Move[] | null): void {
  scene.renderGeneration += 1;
  scene.dragController.setState(state);
  scene.dragController.setMode(scene.mode);
  scene.cardsLayer.removeChildren();
  const table = computeTableLayout(scene.mode);
  drawPlayerRow(scene, scene.cardsLayer, state, 'cpu', table.cpu, selected, compulsory);
  drawPlayerRow(scene, scene.cardsLayer, state, 'human', table.human, selected, compulsory);
  computeFoundationDisplayOrder(state.foundations).forEach((realIndex, visualPosition) =>
    drawTopCardOnly(
      scene,
      scene.cardsLayer,
      state.foundations[realIndex].cards,
      table.foundations[visualPosition],
      { type: 'foundation', index: realIndex },
      FOUNDATION_ROW_SUIT[Math.floor(visualPosition / 2)],
    ),
  );

  if (flash) {
    const flashPoint = effectiveSlotPoint(state, flash.ref, scene.mode);
    if (flashPoint) drawFlashOverlay(scene.cardsLayer, flashPoint);
  }
  scene.feedbackText.text = flash?.message ?? '';
  scene.feedbackPanel.clear();
  if (flash) {
    const paddingX = 13;
    const paddingY = 11;
    const w = scene.feedbackText.width + paddingX * 2;
    const h = scene.feedbackText.height + paddingY * 2;
    scene.feedbackPanel
      .roundRect(scene.feedbackText.x - w / 2, scene.feedbackText.y - h / 2, w, h, 10)
      .fill(TOAST_BG_COLOR)
      .stroke({ color: RED_COLOR, alpha: 0.45, width: 1 });
  }
  scene.turnText.text = turnLabel(state);

  // Only the human's own pending compulsory move gets a banner — the CPU resolves its own
  // forced moves automatically (cpuStep in gameStore.ts), so there's nothing for a person to
  // read or act on while it's the CPU's turn.
  const bannerActive = state.status === 'in_progress' && state.turn === 'human' && compulsory !== null && compulsory.length > 0;
  scene.bannerText.text = bannerActive ? i18next.t('reject.compulsoryMovePending') : '';
  scene.bannerPanel.clear();
  if (bannerActive) {
    const paddingX = 15;
    const paddingY = 10;
    const w = scene.bannerText.width + paddingX * 2;
    const h = scene.bannerText.height + paddingY * 2;
    scene.bannerPanel
      .roundRect(scene.bannerText.x - w / 2, scene.bannerText.y - paddingY, w, h, 12)
      .fill({ color: RED_WASH_COLOR, alpha: 0.16 })
      .stroke({ color: RED_COLOR, alpha: 0.5, width: 1 });
  }

  scene.overlayLayer.removeChildren();
  if (state.status !== 'in_progress') {
    drawEndScreen(scene.overlayLayer, state, scene.onPlayAgain, logicalSize(scene.mode));
  }
}

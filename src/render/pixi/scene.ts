// §5/§14 steps 6–7: PixiJS rendering of a GameState snapshot, scaled/letterboxed to fit the
// real viewport, plus tap-to-select input. Everything here reads a GameState/PileRef; it
// never mutates one — /render never depends on /engine internals beyond the plain data
// types, and click handling here only ever reports "this slot was clicked" outward via
// onSlotClick. What that click *means* (select / attempt a move / draw / discard) is
// entirely gameStore.ts's call — deliberately reactive-only, no legal-destination
// highlighting or preemptive disabling (see gameStore.ts's file comment for why).
import { Application, Container, type FederatedPointerEvent, Graphics, Rectangle, type Sprite, Text, type Texture } from 'pixi.js';
import { i18next, SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../../i18n/index.ts';
import type { Card, GameState, PileRef, PlayerId } from '../../engine/types.ts';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HOUSE_FAN_SIGN,
  HOUSE_OVERLAP_X,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  computeFoundationDisplayOrder,
  computeTableLayout,
  type PlayerRowLayout,
  type Point,
} from '../layout.ts';
import { cardTexture, createCardSprite, preloadCardTextures } from './cardSprites.ts';

const TABLE_BG_COLOR = 0x0f5132; // felt green
const SLOT_OUTLINE_COLOR = 0xffffff;
const SLOT_OUTLINE_ALPHA = 0.25;
const SLOT_CORNER_RADIUS = 8;

// Depth-cue filler layers for stock-style piles (talon/waste/reserve) — see drawStackedPile.
const STACK_DEPTH_MAX_LAYERS = 6;
const STACK_DEPTH_OFFSET = 3;
const STACK_FILLER_COLOR = 0xece5d8;
const STACK_FILLER_BORDER_ALPHA = 0.25;

const SELECTED_LIFT_Y = 12;
const SELECTED_BORDER_COLOR = 0xffd54a;
const FLASH_FILL_COLOR = 0xcc3333;
const FLASH_FILL_ALPHA = 0.45;
const FEEDBACK_TEXT_Y = 26;
const TURN_TEXT_Y = 54;

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
const OVERLAY_BG_COLOR = 0x000000;
const OVERLAY_BG_ALPHA = 0.72;
const OVERLAY_TITLE_Y_OFFSET = -40;
const OVERLAY_SCORE_Y_OFFSET = 6;
const OVERLAY_BUTTON_Y_OFFSET = 60;
const PLAY_AGAIN_BUTTON_WIDTH = 170;
const PLAY_AGAIN_BUTTON_HEIGHT = 46;
const PLAY_AGAIN_BUTTON_COLOR = 0x2f8f5b;

// §14 step 9: footer row + the About/Legal modal it opens (LGPL-2.1 attribution for the
// vendored card art per §12 — see public/cards/CREDIT.md). Extended later (still §14) with
// three more footer entries — New Game, How to Play, and a language toggle — all sharing the
// same dim-backdrop-plus-panel modal look as the About/Legal one.
const FOOTER_LINK_Y_OFFSET = -20;
const MODAL_PANEL_COLOR = 0x143a2b;
const ABOUT_PANEL_WIDTH = 560;
const ABOUT_PANEL_HEIGHT = 300;
const RULES_PANEL_WIDTH = 680;
const RULES_PANEL_HEIGHT = 800;
const CONFIRM_PANEL_WIDTH = 440;
const CONFIRM_PANEL_HEIGHT = 170;
const CONFIRM_BUTTON_WIDTH = 170;
const CONFIRM_BUTTON_HEIGHT = 42;

// Proper names, not translated content — a language's own name for itself ("Português") is
// conventionally written the same way regardless of the UI's current language, unlike every
// other string in this file. The footer toggle always shows the *other* language's name (the
// one you'd switch to), not the current one.
const LANGUAGE_AUTONYM: Record<SupportedLanguage, string> = { en: 'English', pt: 'Português' };

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
  // Footer "New Game" → confirm dialog → this — deals a fresh game the same way "Play Again"
  // does (main.ts wires both to the same function), just reachable mid-game, not only once
  // one has ended.
  onNewGameRequest: () => void;
  // Fires after the footer language toggle has already switched i18next's active language
  // and refreshed every static (built-once) Text on screen — main.ts just needs to re-render
  // with the current GameState so turn/flash/end-screen text (already dynamic, rebuilt every
  // renderGameState call) picks up the new language too.
  onLanguageChange: () => void;
}

interface DragController {
  setState(state: GameState): void;
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
  turnText: Text;
  onSlotClick: SlotClickHandler;
  onPlayAgain: () => void;
  dragController: DragController;
  // Last rendered position + face-up state per card id, so placeCard can tell "this card just
  // appeared here" (no entry — snap instantly) apart from "this card just moved here from
  // somewhere else" (tween) or "this card just turned face up/down in place" (flip). Cleared
  // on a fresh deal (see main.ts) — card ids are stable (suit+rank+copy, not randomized, see
  // deck.ts) so a stale entry from a finished game would otherwise make the next game's
  // opening deal appear to slide/flip in from the old game's state.
  cardRenderState: Map<string, { point: Point; faceUp: boolean }>;
}

interface Slot {
  ref: PileRef;
  point: Point;
}

function allBaseSlots(): Slot[] {
  const table = computeTableLayout();
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
function effectiveSlotPoint(state: GameState, ref: PileRef): Point | undefined {
  if (ref.type === 'foundation') {
    const table = computeTableLayout();
    const visualPosition = computeFoundationDisplayOrder(state.foundations).indexOf(ref.index);
    return table.foundations[visualPosition];
  }
  const base = allBaseSlots().find((s) => refsEqual(s.ref, ref))?.point;
  if (!base || ref.type !== 'house') return base;
  const count = state.players[ref.owner].houses[ref.index].length;
  const sign = HOUSE_FAN_SIGN[ref.owner];
  return { x: base.x + Math.max(count - 1, 0) * sign * HOUSE_OVERLAP_X, y: base.y };
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
  let dragging: DragState | null = null;
  let justDraggedCardId: string | null = null;

  function toLocal(event: FederatedPointerEvent): Point {
    return root.toLocal(event.global);
  }

  function hitTestDrop(point: Point): PileRef | null {
    if (!latestState) return null;
    const state = latestState;
    const hit = allBaseSlots().find(({ ref }) => {
      const p = effectiveSlotPoint(state, ref);
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
  const previous = scene.cardRenderState.get(card.id);
  const justDragged = scene.dragController.consumeJustDragged(card.id);
  scene.cardRenderState.set(card.id, { point, faceUp: card.faceUp });

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

function otherLanguage(): SupportedLanguage {
  return SUPPORTED_LANGUAGES.find((lang) => lang !== i18next.language) ?? 'en';
}

export async function createTableScene(container: HTMLElement, handlers: TableSceneHandlers): Promise<TableScene> {
  const { onSlotClick, onPlayAgain, canPickUp, onDrop, onNewGameRequest, onLanguageChange } = handlers;
  const app = new Application();
  // `resolution` defaults to 1 (CSS px per physical px) — on any high-DPI/retina screen that
  // renders the whole canvas at a lower density than the display, then lets the browser
  // upscale it, blurring everything (not just card art). `autoDensity` keeps the canvas's CSS
  // size correct once `resolution` inflates its backing store.
  await app.init({
    resizeTo: window,
    backgroundColor: TABLE_BG_COLOR,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);

  await preloadCardTextures();

  const root = new Container();
  app.stage.addChild(root);
  root.addChild(new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(TABLE_BG_COLOR));

  const outlinesLayer = new Container();
  root.addChild(outlinesLayer);
  drawSlotOutlines(outlinesLayer);

  const cardsLayer = new Container();
  root.addChild(cardsLayer);

  const dragLayer = new Container();
  root.addChild(dragLayer);

  const overlayLayer = new Container();
  root.addChild(overlayLayer);

  const dragController = createDragController(app, root, cardsLayer, dragLayer, canPickUp, onDrop);

  const feedbackText = new Text({
    text: '',
    style: { fill: 0xffe28a, fontSize: 20, fontWeight: 'bold', align: 'center' },
  });
  feedbackText.anchor.set(0.5);
  feedbackText.position.set(LOGICAL_WIDTH / 2, FEEDBACK_TEXT_Y);
  root.addChild(feedbackText);

  const turnText = new Text({
    text: '',
    style: { fill: 0xffffff, fontSize: 16, align: 'center' },
  });
  turnText.anchor.set(0.5);
  turnText.position.set(LOGICAL_WIDTH / 2, TURN_TEXT_Y);
  root.addChild(turnText);

  // §14: footer row — New Game | How to Play | language toggle | About/Legal. Pure
  // presentation, no game-state involvement, so it all lives outside the gameStore/
  // renderGameState pipeline; each entry either toggles its own static modal layer's
  // visibility directly, or (language) switches i18next's active language in place.
  function makeFooterButton(text: string): Text {
    const t = new Text({ text, style: { fill: 0xbbbbbb, fontSize: 14 } });
    t.anchor.set(0.5);
    t.eventMode = 'static';
    t.cursor = 'pointer';
    return t;
  }

  const footerY = LOGICAL_HEIGHT + FOOTER_LINK_Y_OFFSET;
  const newGameFooterButton = makeFooterButton(i18next.t('footer.newGame'));
  newGameFooterButton.position.set(LOGICAL_WIDTH * (1 / 5), footerY);
  root.addChild(newGameFooterButton);

  const rulesFooterButton = makeFooterButton(i18next.t('footer.howToPlay'));
  rulesFooterButton.position.set(LOGICAL_WIDTH * (2 / 5), footerY);
  root.addChild(rulesFooterButton);

  const languageFooterButton = makeFooterButton(LANGUAGE_AUTONYM[otherLanguage()]);
  languageFooterButton.position.set(LOGICAL_WIDTH * (3 / 5), footerY);
  root.addChild(languageFooterButton);

  const aboutFooterButton = makeFooterButton(i18next.t('footer.aboutLegal'));
  aboutFooterButton.position.set(LOGICAL_WIDTH * (4 / 5), footerY);
  root.addChild(aboutFooterButton);

  // Each modal layer starts empty and hidden; its content is built fresh every time it opens
  // rather than once up front and merely toggled visible — see drawTextModal's comment for
  // why (a real PixiJS hit-testing gotcha, not stylistic preference).
  const aboutLayer = new Container();
  aboutLayer.visible = false;
  root.addChild(aboutLayer);
  aboutFooterButton.on('pointertap', () => {
    if (aboutLayer.visible) {
      aboutLayer.visible = false;
      return;
    }
    aboutLayer.visible = true;
    aboutLayer.removeChildren();
    drawTextModal(aboutLayer, ABOUT_PANEL_WIDTH, ABOUT_PANEL_HEIGHT, i18next.t('about.title'), i18next.t('about.body'), () => {
      aboutLayer.visible = false;
    });
  });

  const rulesLayer = new Container();
  rulesLayer.visible = false;
  root.addChild(rulesLayer);
  rulesFooterButton.on('pointertap', () => {
    if (rulesLayer.visible) {
      rulesLayer.visible = false;
      return;
    }
    rulesLayer.visible = true;
    rulesLayer.removeChildren();
    drawTextModal(rulesLayer, RULES_PANEL_WIDTH, RULES_PANEL_HEIGHT, i18next.t('rules.title'), i18next.t('rules.body'), () => {
      rulesLayer.visible = false;
    });
  });

  const confirmLayer = new Container();
  confirmLayer.visible = false;
  root.addChild(confirmLayer);
  newGameFooterButton.on('pointertap', () => {
    confirmLayer.visible = true;
    confirmLayer.removeChildren();
    drawConfirmModal(
      confirmLayer,
      i18next.t('newGameConfirm.message'),
      i18next.t('newGameConfirm.confirm'),
      i18next.t('newGameConfirm.cancel'),
      () => {
        confirmLayer.visible = false;
        onNewGameRequest();
      },
      () => {
        confirmLayer.visible = false;
      },
    );
  });

  // Only the persistent footer labels need refreshing on a language switch — the three
  // modals above always rebuild with the current language on their next open anyway.
  function refreshStaticText(): void {
    newGameFooterButton.text = i18next.t('footer.newGame');
    rulesFooterButton.text = i18next.t('footer.howToPlay');
    languageFooterButton.text = LANGUAGE_AUTONYM[otherLanguage()];
    aboutFooterButton.text = i18next.t('footer.aboutLegal');
  }
  refreshStaticText();

  languageFooterButton.on('pointertap', () => {
    setLanguage(otherLanguage()).then(() => {
      refreshStaticText();
      onLanguageChange();
    });
  });

  const applyLetterbox = (): void => {
    const scale = Math.min(app.screen.width / LOGICAL_WIDTH, app.screen.height / LOGICAL_HEIGHT);
    root.scale.set(scale);
    root.x = (app.screen.width - LOGICAL_WIDTH * scale) / 2;
    root.y = (app.screen.height - LOGICAL_HEIGHT * scale) / 2;
    // `app.stage.hitArea` is a snapshot Rectangle, not live-bound to `app.screen` — refresh it
    // whenever the screen resizes so the drag controller's stage-wide pointermove/pointerup
    // tracking (see createDragController) keeps covering the whole canvas.
    app.stage.hitArea = app.screen;
  };
  applyLetterbox();
  // `resizeTo` doesn't resize synchronously with the window's own 'resize' event (it's
  // driven by a ResizeObserver internally) — listen on the renderer's own 'resize' instead,
  // which fires only after app.screen has actually been updated.
  app.renderer.on('resize', applyLetterbox);

  return { app, root, cardsLayer, overlayLayer, feedbackText, turnText, onSlotClick, onPlayAgain, dragController, cardRenderState: new Map() };
}

// Purely visual, drawn once — every slot's base grid position, whether or not it currently
// holds a card. The actual click targets live in cardsLayer (see makeClickable below) so
// they can track a fanned house's real position instead of a fixed rectangle.
function drawSlotOutlines(layer: Container): void {
  for (const { point } of allBaseSlots()) {
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
// hit-testable filled rect at its base slot covers that.
function drawEmptyHitZone(layer: Container, ref: PileRef, point: Point, onSlotClick: SlotClickHandler): void {
  const g = new Graphics()
    .rect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT)
    .fill({ color: 0x000000, alpha: 0 });
  makeClickable(g, ref, onSlotClick);
  layer.addChild(g);
}

function drawSelectionBorder(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2 - SELECTED_LIFT_Y, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
    .stroke({ color: SELECTED_BORDER_COLOR, width: 3 });
  layer.addChild(g);
}

function drawFlashOverlay(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
    .fill({ color: FLASH_FILL_COLOR, alpha: FLASH_FILL_ALPHA });
  layer.addChild(g);
}

function drawCountBadge(layer: Container, point: Point, count: number): void {
  if (count <= 0) return;
  const cx = point.x + CARD_WIDTH / 2;
  const cy = point.y + CARD_HEIGHT / 2;
  layer.addChild(new Graphics().circle(cx, cy, COUNT_BADGE_RADIUS).fill({ color: COUNT_BADGE_COLOR, alpha: COUNT_BADGE_ALPHA }));
  const text = new Text({ text: String(count), style: { fill: 0xffffff, fontSize: 12, fontWeight: 'bold' } });
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
function drawTextModal(layer: Container, width: number, height: number, title: string, body: string, onClose: () => void): void {
  const backdrop = new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill({ color: OVERLAY_BG_COLOR, alpha: OVERLAY_BG_ALPHA });
  backdrop.eventMode = 'static';
  backdrop.on('pointertap', onClose);
  layer.addChild(backdrop);

  const panelX = (LOGICAL_WIDTH - width) / 2;
  const panelY = (LOGICAL_HEIGHT - height) / 2;
  const panel = new Graphics().roundRect(panelX, panelY, width, height, 12).fill(MODAL_PANEL_COLOR);
  panel.eventMode = 'static'; // swallow taps so clicking the panel itself doesn't close it via the backdrop
  layer.addChild(panel);

  const titleText = new Text({ text: title, style: { fill: 0xffffff, fontSize: 22, fontWeight: 'bold' } });
  titleText.position.set(panelX + 24, panelY + 20);
  layer.addChild(titleText);

  const bodyText = new Text({ text: body, style: { fill: 0xe5e5e5, fontSize: 14, lineHeight: 20, wordWrap: true, wordWrapWidth: width - 48 } });
  bodyText.position.set(panelX + 24, panelY + 62);
  layer.addChild(bodyText);

  const closeText = new Text({ text: '✕', style: { fill: 0xffffff, fontSize: 18, fontWeight: 'bold' } });
  closeText.anchor.set(0.5);
  closeText.position.set(panelX + width - 22, panelY + 22);
  closeText.eventMode = 'static';
  closeText.cursor = 'pointer';
  closeText.on('pointertap', onClose);
  layer.addChild(closeText);
}

// §14: the "New Game" footer entry's confirmation dialog — discarding an in-progress game is
// exactly the kind of hard-to-reverse action worth an explicit "are you sure?" rather than
// acting on the first click. Rebuilt fresh on every open, same reasoning as drawTextModal.
function drawConfirmModal(layer: Container, message: string, confirmLabel: string, cancelLabel: string, onConfirm: () => void, onCancel: () => void): void {
  const backdrop = new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill({ color: OVERLAY_BG_COLOR, alpha: OVERLAY_BG_ALPHA });
  backdrop.eventMode = 'static';
  backdrop.on('pointertap', onCancel);
  layer.addChild(backdrop);

  const panelX = (LOGICAL_WIDTH - CONFIRM_PANEL_WIDTH) / 2;
  const panelY = (LOGICAL_HEIGHT - CONFIRM_PANEL_HEIGHT) / 2;
  const panel = new Graphics().roundRect(panelX, panelY, CONFIRM_PANEL_WIDTH, CONFIRM_PANEL_HEIGHT, 12).fill(MODAL_PANEL_COLOR);
  panel.eventMode = 'static';
  layer.addChild(panel);

  const centerX = panelX + CONFIRM_PANEL_WIDTH / 2;
  const messageText = new Text({
    text: message,
    style: { fill: 0xffffff, fontSize: 16, align: 'center', wordWrap: true, wordWrapWidth: CONFIRM_PANEL_WIDTH - 48 },
  });
  messageText.anchor.set(0.5, 0);
  messageText.position.set(centerX, panelY + 24);
  layer.addChild(messageText);

  const buttonY = panelY + CONFIRM_PANEL_HEIGHT - 24 - CONFIRM_BUTTON_HEIGHT / 2;
  const gap = 16;

  const cancelX = centerX - gap / 2 - CONFIRM_BUTTON_WIDTH;
  const cancelBg = new Graphics().roundRect(cancelX, buttonY - CONFIRM_BUTTON_HEIGHT / 2, CONFIRM_BUTTON_WIDTH, CONFIRM_BUTTON_HEIGHT, 10).fill(0x3a3a3a);
  // An explicit `hitArea` (rather than relying on Pixi computing one from the drawn geometry)
  // is what makes this reliably hit-testable — see the file-level note above drawTextModal.
  cancelBg.hitArea = new Rectangle(cancelX, buttonY - CONFIRM_BUTTON_HEIGHT / 2, CONFIRM_BUTTON_WIDTH, CONFIRM_BUTTON_HEIGHT);
  cancelBg.eventMode = 'static';
  cancelBg.cursor = 'pointer';
  cancelBg.on('pointertap', onCancel);
  layer.addChild(cancelBg);
  const cancelButtonText = new Text({ text: cancelLabel, style: { fill: 0xffffff, fontSize: 15, fontWeight: 'bold' } });
  cancelButtonText.anchor.set(0.5);
  cancelButtonText.position.set(centerX - gap / 2 - CONFIRM_BUTTON_WIDTH / 2, buttonY);
  layer.addChild(cancelButtonText);

  const confirmX = centerX + gap / 2;
  const confirmBg = new Graphics().roundRect(confirmX, buttonY - CONFIRM_BUTTON_HEIGHT / 2, CONFIRM_BUTTON_WIDTH, CONFIRM_BUTTON_HEIGHT, 10).fill(PLAY_AGAIN_BUTTON_COLOR);
  confirmBg.hitArea = new Rectangle(confirmX, buttonY - CONFIRM_BUTTON_HEIGHT / 2, CONFIRM_BUTTON_WIDTH, CONFIRM_BUTTON_HEIGHT);
  confirmBg.eventMode = 'static';
  confirmBg.cursor = 'pointer';
  confirmBg.on('pointertap', onConfirm);
  layer.addChild(confirmBg);
  const confirmButtonText = new Text({ text: confirmLabel, style: { fill: 0xffffff, fontSize: 15, fontWeight: 'bold' } });
  confirmButtonText.anchor.set(0.5);
  confirmButtonText.position.set(centerX + gap / 2 + CONFIRM_BUTTON_WIDTH / 2, buttonY);
  layer.addChild(confirmButtonText);
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
function drawEndScreen(layer: Container, state: GameState, onPlayAgain: () => void): void {
  const centerX = LOGICAL_WIDTH / 2;
  const centerY = LOGICAL_HEIGHT / 2;
  layer.addChild(new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill({ color: OVERLAY_BG_COLOR, alpha: OVERLAY_BG_ALPHA }));

  const title = new Text({ text: endScreenTitle(state), style: { fill: 0xffffff, fontSize: 40, fontWeight: 'bold', align: 'center' } });
  title.anchor.set(0.5);
  title.position.set(centerX, centerY + OVERLAY_TITLE_Y_OFFSET);
  layer.addChild(title);

  const scores = state.scores;
  const scoreLine = scores ? i18next.t('end.scoreLine', { human: scores.human, cpu: scores.cpu }) : '';
  const scoreText = new Text({ text: scoreLine, style: { fill: 0xffe28a, fontSize: 20, align: 'center' } });
  scoreText.anchor.set(0.5);
  scoreText.position.set(centerX, centerY + OVERLAY_SCORE_Y_OFFSET);
  layer.addChild(scoreText);

  const buttonY = centerY + OVERLAY_BUTTON_Y_OFFSET;
  const buttonX = centerX - PLAY_AGAIN_BUTTON_WIDTH / 2;
  const button = new Graphics().roundRect(buttonX, buttonY - PLAY_AGAIN_BUTTON_HEIGHT / 2, PLAY_AGAIN_BUTTON_WIDTH, PLAY_AGAIN_BUTTON_HEIGHT, 10).fill(PLAY_AGAIN_BUTTON_COLOR);
  // See drawConfirmModal's comment — an explicit hitArea is what makes a Graphics button
  // reliably hit-testable here, not just its auto-computed bounds.
  button.hitArea = new Rectangle(buttonX, buttonY - PLAY_AGAIN_BUTTON_HEIGHT / 2, PLAY_AGAIN_BUTTON_WIDTH, PLAY_AGAIN_BUTTON_HEIGHT);
  button.eventMode = 'static';
  button.cursor = 'pointer';
  button.on('pointertap', onPlayAgain);
  layer.addChild(button);

  const buttonText = new Text({ text: i18next.t('end.playAgain'), style: { fill: 0xffffff, fontSize: 18, fontWeight: 'bold' } });
  buttonText.anchor.set(0.5);
  buttonText.position.set(centerX, buttonY);
  layer.addChild(buttonText);
}

// Foundations only ever show their top card (§2/§3) — the rest is simply not the
// visible/available one, and there's no useful "how many are underneath" signal for a
// foundation the way there is for a stock pile.
function drawTopCardOnly(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef): void {
  if (cards.length === 0) {
    drawEmptyHitZone(layer, ref, point, scene.onSlotClick);
    return;
  }
  const card = cards[cards.length - 1];
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

// Talon/waste/reserve only ever show their top card too, but as a *pile* (unlike a
// foundation) — fan a few filler layers behind the top card so its thickness hints at how
// much is left, per the request that you shouldn't have to guess whether the reserve is
// nearly empty.
function drawStackedPile(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef, owner: PlayerId, lifted: boolean): void {
  if (cards.length === 0) {
    drawEmptyHitZone(layer, ref, point, scene.onSlotClick);
    return;
  }
  const layers = stackDepthLayers(cards.length);
  for (let i = layers; i >= 1; i--) {
    drawStackFiller(layer, point, i);
  }
  const card = cards[cards.length - 1];
  const sprite = createCardSprite(card, owner);
  const spritePoint = { x: point.x, y: point.y - (lifted ? SELECTED_LIFT_Y : 0) };
  placeCard(scene, sprite, card, owner, spritePoint);
  makeClickable(sprite, ref, scene.onSlotClick);
  scene.dragController.attach(sprite, ref, spritePoint, card.id);
  layer.addChild(sprite);
  if (lifted) drawSelectionBorder(layer, point);
  drawCountBadge(layer, point, cards.length);
}

// Houses fan sideways from `point` — outward, away from the shared foundation columns in
// the middle (see HOUSE_FAN_SIGN) — so the descending-alternating-color sequence stays
// legible, matching Russian Bank's traditional physical layout. Only the actual top
// (available) card is clickable; a house long enough to run its fan off the edge of the
// canvas is a real (if rare) visual edge case left for a later polish pass.
function drawHouse(scene: TableScene, layer: Container, cards: Card[], point: Point, ref: PileRef, owner: PlayerId, lifted: boolean): void {
  if (cards.length === 0) {
    drawEmptyHitZone(layer, ref, point, scene.onSlotClick);
    return;
  }
  const sign = HOUSE_FAN_SIGN[owner];
  let topSprite: Sprite | undefined;
  let topSpritePoint: Point | undefined;
  let topCardId: string | undefined;
  cards.forEach((card, i) => {
    const sprite = createCardSprite(card);
    const isTop = i === cards.length - 1;
    const cardPoint = { x: point.x + i * sign * HOUSE_OVERLAP_X, y: point.y - (isTop && lifted ? SELECTED_LIFT_Y : 0) };
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
  if (lifted) drawSelectionBorder(layer, { x: point.x + (cards.length - 1) * sign * HOUSE_OVERLAP_X, y: point.y });
  drawCountBadge(layer, point, cards.length);
}

function drawPlayerRow(scene: TableScene, layer: Container, state: GameState, player: PlayerId, row: PlayerRowLayout, selected: PileRef | null): void {
  const p = state.players[player];
  const isSelected = (type: 'hand' | 'waste' | 'reserve'): boolean => selected !== null && selected.type === type && selected.owner === player;
  drawStackedPile(scene, layer, p.hand, row.hand, { type: 'hand', owner: player }, player, isSelected('hand'));
  drawStackedPile(scene, layer, p.waste, row.waste, { type: 'waste', owner: player }, player, isSelected('waste'));
  drawStackedPile(scene, layer, p.reserve, row.reserve, { type: 'reserve', owner: player }, player, isSelected('reserve'));
  p.houses.forEach((house, i) => {
    const index = i as 0 | 1 | 2 | 3;
    const lifted = selected !== null && selected.type === 'house' && selected.owner === player && selected.index === index;
    drawHouse(scene, layer, house, row.houses[i], { type: 'house', owner: player, index }, player, lifted);
  });
}

// Blank once the game has ended — the dedicated end screen (drawEndScreen) covers that, so
// this only ever needs to say whose turn it currently is.
function turnLabel(state: GameState): string {
  if (state.status !== 'in_progress') return '';
  return i18next.t(state.turn === 'human' ? 'turn.human' : 'turn.cpu');
}

export function renderGameState(scene: TableScene, state: GameState, selected: PileRef | null, flash: FeedbackFlash | null): void {
  scene.dragController.setState(state);
  scene.cardsLayer.removeChildren();
  const table = computeTableLayout();
  drawPlayerRow(scene, scene.cardsLayer, state, 'cpu', table.cpu, selected);
  drawPlayerRow(scene, scene.cardsLayer, state, 'human', table.human, selected);
  computeFoundationDisplayOrder(state.foundations).forEach((realIndex, visualPosition) =>
    drawTopCardOnly(scene, scene.cardsLayer, state.foundations[realIndex].cards, table.foundations[visualPosition], { type: 'foundation', index: realIndex }),
  );

  if (flash) {
    const flashPoint = effectiveSlotPoint(state, flash.ref);
    if (flashPoint) drawFlashOverlay(scene.cardsLayer, flashPoint);
  }
  scene.feedbackText.text = flash?.message ?? '';
  scene.turnText.text = turnLabel(state);

  scene.overlayLayer.removeChildren();
  if (state.status !== 'in_progress') {
    drawEndScreen(scene.overlayLayer, state, scene.onPlayAgain);
  }
}

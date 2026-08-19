// §5/§14 steps 6–7: PixiJS rendering of a GameState snapshot, scaled/letterboxed to fit the
// real viewport, plus tap-to-select input. Everything here reads a GameState/PileRef; it
// never mutates one — /render never depends on /engine internals beyond the plain data
// types, and click handling here only ever reports "this slot was clicked" outward via
// onSlotClick. What that click *means* (select / attempt a move / draw / discard) is
// entirely gameStore.ts's call — deliberately reactive-only, no legal-destination
// highlighting or preemptive disabling (see gameStore.ts's file comment for why).
import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { Card, GameState, PileRef, PlayerId } from '../../engine/types.ts';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HOUSE_OVERLAP_Y,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  computeTableLayout,
  type PlayerRowLayout,
  type Point,
} from '../layout.ts';
import { createCardSprite, preloadCardTextures } from './cardSprites.ts';

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

export interface FeedbackFlash {
  ref: PileRef;
  message: string;
}

export type SlotClickHandler = (ref: PileRef) => void;

export interface TableScene {
  app: Application;
  root: Container; // logical space; scaled + centered on resize (letterboxed)
  cardsLayer: Container; // cleared and rebuilt on every renderGameState call
  feedbackText: Text;
}

interface Slot {
  ref: PileRef;
  point: Point;
}

function allSlots(): Slot[] {
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

export async function createTableScene(container: HTMLElement, onSlotClick: SlotClickHandler): Promise<TableScene> {
  const app = new Application();
  await app.init({ resizeTo: window, backgroundColor: TABLE_BG_COLOR, antialias: true });
  container.appendChild(app.canvas);

  await preloadCardTextures();

  const root = new Container();
  app.stage.addChild(root);
  root.addChild(new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(TABLE_BG_COLOR));

  const slotsLayer = new Container();
  root.addChild(slotsLayer);
  drawInteractiveSlots(slotsLayer, onSlotClick);

  const cardsLayer = new Container();
  root.addChild(cardsLayer);

  const feedbackText = new Text({
    text: '',
    style: { fill: 0xffe28a, fontSize: 20, fontWeight: 'bold', align: 'center' },
  });
  feedbackText.anchor.set(0.5);
  feedbackText.position.set(LOGICAL_WIDTH / 2, FEEDBACK_TEXT_Y);
  root.addChild(feedbackText);

  const applyLetterbox = (): void => {
    const scale = Math.min(app.screen.width / LOGICAL_WIDTH, app.screen.height / LOGICAL_HEIGHT);
    root.scale.set(scale);
    root.x = (app.screen.width - LOGICAL_WIDTH * scale) / 2;
    root.y = (app.screen.height - LOGICAL_HEIGHT * scale) / 2;
  };
  applyLetterbox();
  // `resizeTo` doesn't resize synchronously with the window's own 'resize' event (it's
  // driven by a ResizeObserver internally) — listen on the renderer's own 'resize' instead,
  // which fires only after app.screen has actually been updated.
  app.renderer.on('resize', applyLetterbox);

  return { app, root, cardsLayer, feedbackText };
}

// Persistent, built once — independent of cardsLayer, which is torn down and rebuilt every
// renderGameState call. A slot stays clickable whether or not it currently holds a card
// (an empty house/foundation is a perfectly valid destination), and cardsLayer sits above
// this layer so a drawn card visually covers its slot without blocking the click.
function drawInteractiveSlots(layer: Container, onSlotClick: SlotClickHandler): void {
  for (const { ref, point } of allSlots()) {
    const g = new Graphics()
      .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
      .stroke({ color: SLOT_OUTLINE_COLOR, alpha: SLOT_OUTLINE_ALPHA, width: 2 });
    g.eventMode = 'static';
    g.cursor = 'pointer';
    // A stroke-only Graphics' default hit area follows just the stroked outline, not the
    // enclosed area — the whole slot (including its middle) needs to be tappable.
    g.hitArea = new Rectangle(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT);
    g.on('pointertap', () => onSlotClick(ref));
    layer.addChild(g);
  }
}

// Foundations only ever show their top card (§2/§3) — the rest is simply not the
// visible/available one, and there's no useful "how many are underneath" signal for a
// foundation the way there is for a stock pile.
function drawTopCardOnly(layer: Container, cards: Card[], point: Point, lifted: boolean): void {
  if (cards.length === 0) return;
  const sprite = createCardSprite(cards[cards.length - 1]);
  sprite.position.set(point.x, point.y - (lifted ? SELECTED_LIFT_Y : 0));
  layer.addChild(sprite);
  if (lifted) drawSelectionBorder(layer, point);
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

// Talon/waste/reserve only ever show their top card too, but as a *pile* (unlike a
// foundation) — fan a few filler layers behind the top card so its thickness hints at how
// much is left, per the request that you shouldn't have to guess whether the reserve is
// nearly empty.
function drawStackedPile(layer: Container, cards: Card[], point: Point, owner: PlayerId, lifted: boolean): void {
  if (cards.length === 0) return;
  const layers = stackDepthLayers(cards.length);
  for (let i = layers; i >= 1; i--) {
    drawStackFiller(layer, point, i);
  }
  const sprite = createCardSprite(cards[cards.length - 1], owner);
  sprite.position.set(point.x, point.y - (lifted ? SELECTED_LIFT_Y : 0));
  layer.addChild(sprite);
  if (lifted) drawSelectionBorder(layer, point);
}

// Houses fan their full sequence downward from `point` so every card's rank/color stays
// legible (§2). A house long enough to run into a neighboring row is a real (if rare, since
// a fresh deal starts every house at 1 card) visual edge case left for a later polish pass.
function drawHouse(layer: Container, cards: Card[], point: Point, lifted: boolean): void {
  cards.forEach((card, i) => {
    const sprite = createCardSprite(card);
    const isTop = i === cards.length - 1;
    sprite.position.set(point.x, point.y + i * HOUSE_OVERLAP_Y - (isTop && lifted ? SELECTED_LIFT_Y : 0));
    layer.addChild(sprite);
  });
  if (lifted) drawSelectionBorder(layer, { x: point.x, y: point.y + (cards.length - 1) * HOUSE_OVERLAP_Y });
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

function drawPlayerRow(layer: Container, state: GameState, player: PlayerId, row: PlayerRowLayout, selected: PileRef | null): void {
  const p = state.players[player];
  const isSelected = (type: 'hand' | 'waste' | 'reserve'): boolean => selected !== null && selected.type === type && selected.owner === player;
  drawStackedPile(layer, p.hand, row.hand, player, isSelected('hand'));
  drawStackedPile(layer, p.waste, row.waste, player, isSelected('waste'));
  drawStackedPile(layer, p.reserve, row.reserve, player, isSelected('reserve'));
  p.houses.forEach((house, i) => {
    const lifted = selected !== null && selected.type === 'house' && selected.owner === player && selected.index === i;
    drawHouse(layer, house, row.houses[i], lifted);
  });
}

export function renderGameState(scene: TableScene, state: GameState, selected: PileRef | null, flash: FeedbackFlash | null): void {
  scene.cardsLayer.removeChildren();
  const table = computeTableLayout();
  drawPlayerRow(scene.cardsLayer, state, 'cpu', table.cpu, selected);
  drawPlayerRow(scene.cardsLayer, state, 'human', table.human, selected);
  state.foundations.forEach((foundation, i) => drawTopCardOnly(scene.cardsLayer, foundation.cards, table.foundations[i], false));

  if (flash) {
    const flashPoint = allSlots().find((s) => refsEqual(s.ref, flash.ref))?.point;
    if (flashPoint) drawFlashOverlay(scene.cardsLayer, flashPoint);
  }
  scene.feedbackText.text = flash?.message ?? '';
}

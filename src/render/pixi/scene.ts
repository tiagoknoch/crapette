// §5/§14 step 6: static PixiJS rendering of a GameState snapshot — builds the table once,
// scaled/letterboxed to fit the real viewport, no drag/drop or tap interaction yet (§14
// step 7). Everything here reads a GameState; it never mutates one — /render never depends
// on /engine internals beyond the plain data types.
import { Application, Container, Graphics } from 'pixi.js';
import type { Card, GameState, PlayerId } from '../../engine/types.ts';
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

export interface TableScene {
  app: Application;
  root: Container; // logical 1280×800 space; scaled + centered on resize (letterboxed)
  cardsLayer: Container; // cleared and rebuilt on every renderGameState call
}

export async function createTableScene(container: HTMLElement): Promise<TableScene> {
  const app = new Application();
  await app.init({ resizeTo: window, backgroundColor: TABLE_BG_COLOR, antialias: true });
  container.appendChild(app.canvas);

  await preloadCardTextures();

  const root = new Container();
  app.stage.addChild(root);
  root.addChild(new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(TABLE_BG_COLOR));

  const slotsLayer = new Container();
  root.addChild(slotsLayer);
  drawEmptySlotOutlines(slotsLayer);

  const cardsLayer = new Container();
  root.addChild(cardsLayer);

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

  return { app, root, cardsLayer };
}

function outlineSlot(layer: Container, point: Point): void {
  const g = new Graphics()
    .roundRect(point.x - CARD_WIDTH / 2, point.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, SLOT_CORNER_RADIUS)
    .stroke({ color: SLOT_OUTLINE_COLOR, alpha: SLOT_OUTLINE_ALPHA, width: 2 });
  layer.addChild(g);
}

function forEachSlot(row: PlayerRowLayout, fn: (point: Point) => void): void {
  fn(row.hand);
  fn(row.waste);
  fn(row.reserve);
  row.houses.forEach(fn);
}

function drawEmptySlotOutlines(layer: Container): void {
  const table = computeTableLayout();
  forEachSlot(table.cpu, (p) => outlineSlot(layer, p));
  forEachSlot(table.human, (p) => outlineSlot(layer, p));
  table.foundations.forEach((p) => outlineSlot(layer, p));
}

// Foundations only ever show their top card (§2/§3) — the rest is simply not the
// visible/available one, and there's no useful "how many are underneath" signal for a
// foundation the way there is for a stock pile.
function drawTopCardOnly(layer: Container, cards: Card[], point: Point): void {
  if (cards.length === 0) return;
  const sprite = createCardSprite(cards[cards.length - 1]);
  sprite.position.set(point.x, point.y);
  layer.addChild(sprite);
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
function drawStackedPile(layer: Container, cards: Card[], point: Point, owner: PlayerId): void {
  if (cards.length === 0) return;
  const layers = stackDepthLayers(cards.length);
  for (let i = layers; i >= 1; i--) {
    drawStackFiller(layer, point, i);
  }
  const sprite = createCardSprite(cards[cards.length - 1], owner);
  sprite.position.set(point.x, point.y);
  layer.addChild(sprite);
}

// Houses fan their full sequence downward from `point` so every card's rank/color stays
// legible (§2). A house long enough to run into a neighboring row is a real (if rare, since
// a fresh deal starts every house at 1 card) visual edge case left for a later polish pass.
function drawHouse(layer: Container, cards: Card[], point: Point): void {
  cards.forEach((card, i) => {
    const sprite = createCardSprite(card);
    sprite.position.set(point.x, point.y + i * HOUSE_OVERLAP_Y);
    layer.addChild(sprite);
  });
}

function drawPlayerRow(layer: Container, state: GameState, player: PlayerId, row: PlayerRowLayout): void {
  const p = state.players[player];
  drawStackedPile(layer, p.hand, row.hand, player);
  drawStackedPile(layer, p.waste, row.waste, player);
  drawStackedPile(layer, p.reserve, row.reserve, player);
  p.houses.forEach((house, i) => drawHouse(layer, house, row.houses[i]));
}

export function renderGameState(scene: TableScene, state: GameState): void {
  scene.cardsLayer.removeChildren();
  const table = computeTableLayout();
  drawPlayerRow(scene.cardsLayer, state, 'cpu', table.cpu);
  drawPlayerRow(scene.cardsLayer, state, 'human', table.human);
  state.foundations.forEach((foundation, i) => drawTopCardOnly(scene.cardsLayer, foundation.cards, table.foundations[i]));
}

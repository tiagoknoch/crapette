// §14 step 6: screen coordinates for every pile. Matches Russian Bank's traditional
// physical tableau (see Wikipedia's setup photo/description): each player's 4 houses form a
// vertical column on their own side, flanking a 4×2 block of the 8 shared foundations in the
// middle. Two arrangements share that exact middle block unchanged (see computeTableLayout):
// a **portrait** one, where each player's talon/waste/reserve sits in its own row above (cpu)
// or below (human) the middle grid, and a **landscape** one (redesign handoff, "the table is
// always the portrait graph; a landscape window only rotates each player's three-pile group
// 90° into their own outer flank"), where those same three piles stack vertically in a
// flank on that player's own side instead. Kept free of Pixi imports — it's just geometry,
// easy to unit-test independent of rendering.
import type { FoundationSlot, PlayerId, Suit } from '../engine/types.ts';

// The source card art's natural size (htdebeer/SVG-cards, see public/cards/CREDIT.md) is
// 169.075×244.64 — this is that aspect ratio, not a pixel size (the art is vector, rasterized
// at whatever size cardSprites.ts asks for, so there's no fixed native resolution to match).
export const CARD_ASPECT = 244.64 / 169.075;
export const CARD_WIDTH = 96;
export const CARD_HEIGHT = Math.round(CARD_WIDTH * CARD_ASPECT);

// Horizontal peek per stacked card in a house (matches the Wikipedia setup photo — houses
// fan sideways, not into a tall vertical cascade), so the descending-alternating-color
// sequence stays legible. Each house fans *outward*, away from the shared foundation
// columns in the middle (cpu's houses fan left, human's fan right) — see HOUSE_FAN_SIGN.
export const HOUSE_OVERLAP_X = 26;

// Gap from the true canvas edge — used for the talon/waste/reserve row's outer slots,
// which don't fan and so don't need extra clearance.
const ROW_MARGIN = 60;
// How many extra fanned-out cards a house can grow by before its fan would run off the
// edge of the canvas. Generous, not exact — a house deep enough to exceed this is a rare,
// acceptable edge case (same caveat as the old vertical cascade had). Also reused, unchanged,
// as the landscape arrangement's flank-to-middle-block clearance — a house's fan grows
// toward that same gap in landscape mode too, so the room it needs doesn't change.
const HOUSE_FAN_ALLOWANCE = 6 * HOUSE_OVERLAP_X;
// The house columns sit further in from the edge than the plain row margin, to leave that
// fan-out room. Portrait-only — landscape's middle block is positioned relative to its own
// flanks instead (see LANDSCAPE_MIDDLE_ORIGIN), not the canvas edge.
const GRID_MARGIN = ROW_MARGIN + HOUSE_FAN_ALLOWANCE;

const COLUMN_GAP = 36;
const ROW_GAP = 30;

// The middle grid is 4 columns wide (cpu houses | 2 foundation columns | human houses) and 4
// rows tall — shared, unchanged, by both arrangements. Portrait adds a talon/waste/reserve
// row above and below (2 more rows); landscape adds no extra rows, moving those same three
// piles into vertical flanks beside the middle block instead (see computeLandscapeLayout).
const MIDDLE_COLUMNS = 4;
const MIDDLE_ROWS = 4;
const TOTAL_ROWS = MIDDLE_ROWS + 2;
const MIDDLE_WIDTH = MIDDLE_COLUMNS * CARD_WIDTH + (MIDDLE_COLUMNS - 1) * COLUMN_GAP;
const MIDDLE_HEIGHT = MIDDLE_ROWS * CARD_HEIGHT + (MIDDLE_ROWS - 1) * ROW_GAP;

export const LOGICAL_WIDTH = 2 * GRID_MARGIN + MIDDLE_WIDTH;
export const LOGICAL_HEIGHT = 2 * ROW_MARGIN + TOTAL_ROWS * CARD_HEIGHT + (TOTAL_ROWS - 1) * ROW_GAP;

// Landscape's middle block sits between the two flanks rather than at the canvas edge, so its
// horizontal origin is derived from the flank width + clearance instead of GRID_MARGIN.
const LANDSCAPE_MIDDLE_ORIGIN = ROW_MARGIN + CARD_WIDTH + HOUSE_FAN_ALLOWANCE;
export const LOGICAL_WIDTH_LANDSCAPE = 2 * ROW_MARGIN + 2 * CARD_WIDTH + 2 * HOUSE_FAN_ALLOWANCE + MIDDLE_WIDTH;
export const LOGICAL_HEIGHT_LANDSCAPE = 2 * ROW_MARGIN + MIDDLE_HEIGHT;

// +1 fans rightward (human, on the right column), -1 fans leftward (cpu, on the left
// column) — always away from the foundations in between.
export const HOUSE_FAN_SIGN: Record<PlayerId, 1 | -1> = { human: 1, cpu: -1 };

// §14: per direct user direction, foundations always visually group by suit, one suit per
// row (both decks' copies of a suit share a row, one per column) — alternating black/red
// row-to-row for legibility. This is a *display-only* convention: the engine still treats
// all 8 foundations as interchangeable (any empty one accepts any ace, see moveResolver.ts)
// — nothing about legality depends on this ordering, only where a card is drawn.
export const FOUNDATION_ROW_SUIT: [Suit, Suit, Suit, Suit] = ['S', 'H', 'C', 'D'];

// Maps each real engine foundation index (state.foundations[i]) to the visual grid position
// it should render at, grouped by FOUNDATION_ROW_SUIT — returns displayOrder such that
// displayOrder[visualPosition] = realFoundationIndex. A suit can never claim more than 2 of
// the 8 slots (there are only 2 aces of any suit across both decks), so every suit's row
// always has exactly 2 slots to fill: however many are already suited, plus enough
// still-unassigned (suit === null) slots — taken in original index order, so which *empty*
// slot backs a given visual position stays stable across renders — to make 2.
export function computeFoundationDisplayOrder(foundations: FoundationSlot[]): number[] {
  const bySuit: Record<Suit, number[]> = { S: [], H: [], D: [], C: [] };
  const unassigned: number[] = [];
  foundations.forEach((f, i) => {
    if (f.suit) bySuit[f.suit].push(i);
    else unassigned.push(i);
  });

  const displayOrder: number[] = [];
  for (const suit of FOUNDATION_ROW_SUIT) {
    const claimed = bySuit[suit];
    const filler = unassigned.splice(0, 2 - claimed.length);
    displayOrder.push(...claimed, ...filler);
  }
  return displayOrder;
}

export interface Point {
  x: number;
  y: number;
}

// One player's talon/waste/reserve row plus their house column.
export interface PlayerRowLayout {
  hand: Point; // talon: face-down draw stock
  waste: Point;
  reserve: Point; // the 13-card "crapette" pile
  houses: [Point, Point, Point, Point];
}

export interface TableLayout {
  cpu: PlayerRowLayout;
  human: PlayerRowLayout;
  foundations: Point[]; // length 8, row-major within the 4×2 center block
}

// Redesign handoff: "the table is always the portrait graph... A landscape window does not
// re-flow the table, it only rotates each player's three-pile group 90° as a unit." Chosen by
// simple aspect comparison — a viewport at least as wide as it is tall gets the landscape
// flank arrangement, otherwise the portrait row arrangement.
export type TableMode = 'portrait' | 'landscape';

export function chooseTableMode(viewportWidth: number, viewportHeight: number): TableMode {
  return viewportWidth >= viewportHeight ? 'landscape' : 'portrait';
}

export function logicalSize(mode: TableMode): { width: number; height: number } {
  return mode === 'landscape'
    ? { width: LOGICAL_WIDTH_LANDSCAPE, height: LOGICAL_HEIGHT_LANDSCAPE }
    : { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT };
}

function rowY(rowIndex: number): number {
  return ROW_MARGIN + CARD_HEIGHT / 2 + rowIndex * (CARD_HEIGHT + ROW_GAP);
}

// `origin` is the x-coordinate of the middle block's own left edge — portrait derives it
// from the canvas edge (GRID_MARGIN), landscape derives it from the cpu flank's width plus
// clearance (LANDSCAPE_MIDDLE_ORIGIN) — everything else about the 4-column grid is identical.
function middleColumnX(col: number, origin: number): number {
  return origin + CARD_WIDTH / 2 + col * (CARD_WIDTH + COLUMN_GAP);
}

// Talon/waste/reserve spread evenly across the full width, independent of the middle grid's
// column positions (matches the confirmed mockup, which treats each pile row as its own
// 3-slot band rather than aligning to the 4-column grid below/above it). Portrait-only.
function pileRowSlots(y: number): { left: Point; center: Point; right: Point } {
  return {
    left: { x: ROW_MARGIN + CARD_WIDTH / 2, y },
    center: { x: LOGICAL_WIDTH / 2, y },
    right: { x: LOGICAL_WIDTH - ROW_MARGIN - CARD_WIDTH / 2, y },
  };
}

// Landscape's talon/waste/reserve stack vertically instead, at a fixed x (the flank column),
// vertically centered against the middle block's own height — the flank (3 cards, 2 gaps) is
// shorter than the middle block (4 rows), so it sits centered within that span rather than
// pinned to specific shared rows.
function flankSlots(x: number): { top: Point; middle: Point; bottom: Point } {
  const middleTop = rowY(0) - CARD_HEIGHT / 2;
  const flankHeight = 3 * CARD_HEIGHT + 2 * ROW_GAP;
  const topOffset = (MIDDLE_HEIGHT - flankHeight) / 2;
  const firstCenterY = middleTop + topOffset + CARD_HEIGHT / 2;
  return {
    top: { x, y: firstCenterY },
    middle: { x, y: firstCenterY + (CARD_HEIGHT + ROW_GAP) },
    bottom: { x, y: firstCenterY + 2 * (CARD_HEIGHT + ROW_GAP) },
  };
}

// `rowOffset` is which shared row index (0-based) the house column's first slot starts at —
// portrait's middle block starts at row 1 (row 0 is the cpu pile row above it), landscape's
// starts at row 0 (there's no pile row there anymore, piles moved to the flanks).
function houseColumn(col: number, rowOffset: number, origin: number): [Point, Point, Point, Point] {
  const x = middleColumnX(col, origin);
  return [0, 1, 2, 3].map((row) => ({ x, y: rowY(rowOffset + row) })) as [Point, Point, Point, Point];
}

function foundationBlock(rowOffset: number, origin: number): Point[] {
  const points: Point[] = [];
  for (let row = 0; row < MIDDLE_ROWS; row++) {
    points.push({ x: middleColumnX(1, origin), y: rowY(rowOffset + row) });
    points.push({ x: middleColumnX(2, origin), y: rowY(rowOffset + row) });
  }
  return points;
}

// §14 step 6 confirmed layout: cpu's row is mirrored (reserve—waste—talon, left to right)
// relative to human's (talon—waste—reserve), matching the physical game's convention of each
// player reading their own row left-to-right from their own seat; each player's house column
// sits on the same side as their own reserve. Landscape keeps the exact same ordering, just
// read top-to-bottom instead of left-to-right (see flankSlots).
function computePortraitLayout(): TableLayout {
  const cpuRow = pileRowSlots(rowY(0));
  const humanRow = pileRowSlots(rowY(1 + MIDDLE_ROWS));

  return {
    cpu: { reserve: cpuRow.left, waste: cpuRow.center, hand: cpuRow.right, houses: houseColumn(0, 1, GRID_MARGIN) },
    human: { hand: humanRow.left, waste: humanRow.center, reserve: humanRow.right, houses: houseColumn(3, 1, GRID_MARGIN) },
    foundations: foundationBlock(1, GRID_MARGIN),
  };
}

function computeLandscapeLayout(): TableLayout {
  const cpuX = ROW_MARGIN + CARD_WIDTH / 2;
  const humanX = LOGICAL_WIDTH_LANDSCAPE - ROW_MARGIN - CARD_WIDTH / 2;
  const cpuFlank = flankSlots(cpuX);
  const humanFlank = flankSlots(humanX);
  const origin = LANDSCAPE_MIDDLE_ORIGIN;

  return {
    cpu: { reserve: cpuFlank.top, waste: cpuFlank.middle, hand: cpuFlank.bottom, houses: houseColumn(0, 0, origin) },
    human: { hand: humanFlank.top, waste: humanFlank.middle, reserve: humanFlank.bottom, houses: houseColumn(3, 0, origin) },
    foundations: foundationBlock(0, origin),
  };
}

export function computeTableLayout(mode: TableMode): TableLayout {
  return mode === 'landscape' ? computeLandscapeLayout() : computePortraitLayout();
}

export function rowLayoutFor(table: TableLayout, player: PlayerId): PlayerRowLayout {
  return table[player];
}

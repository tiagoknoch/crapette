// §14 step 6: screen coordinates for every pile. Matches Russian Bank's traditional
// physical tableau (see Wikipedia's setup photo/description): each player's 4 houses form a
// vertical column on their own side, flanking a 4×2 block of the 8 shared foundations in the
// middle; each player's talon/waste/reserve sits in its own row above (cpu) or below (human)
// that middle grid, mirrored left-right between the two rows just like the physical game.
// Kept free of Pixi imports — it's just geometry, easy to unit-test independent of rendering.
import type { PlayerId } from '../engine/types.ts';

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
// acceptable edge case (same caveat as the old vertical cascade had).
const HOUSE_FAN_ALLOWANCE = 6 * HOUSE_OVERLAP_X;
// The house columns sit further in from the edge than the plain row margin, to leave that
// fan-out room.
const GRID_MARGIN = ROW_MARGIN + HOUSE_FAN_ALLOWANCE;

const COLUMN_GAP = 36;
const ROW_GAP = 30;

// The middle grid is 4 columns wide (cpu houses | 2 foundation columns | human houses) and 4
// rows tall; the talon/waste/reserve row above and below add 2 more rows.
const MIDDLE_COLUMNS = 4;
const MIDDLE_ROWS = 4;
const TOTAL_ROWS = MIDDLE_ROWS + 2;

export const LOGICAL_WIDTH = 2 * GRID_MARGIN + MIDDLE_COLUMNS * CARD_WIDTH + (MIDDLE_COLUMNS - 1) * COLUMN_GAP;
export const LOGICAL_HEIGHT = 2 * ROW_MARGIN + TOTAL_ROWS * CARD_HEIGHT + (TOTAL_ROWS - 1) * ROW_GAP;

// +1 fans rightward (human, on the right column), -1 fans leftward (cpu, on the left
// column) — always away from the foundations in between.
export const HOUSE_FAN_SIGN: Record<PlayerId, 1 | -1> = { human: 1, cpu: -1 };

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

function rowY(rowIndex: number): number {
  return ROW_MARGIN + CARD_HEIGHT / 2 + rowIndex * (CARD_HEIGHT + ROW_GAP);
}

function middleColumnX(col: number): number {
  return GRID_MARGIN + CARD_WIDTH / 2 + col * (CARD_WIDTH + COLUMN_GAP);
}

// Talon/waste/reserve spread evenly across the full width, independent of the middle grid's
// column positions (matches the confirmed mockup, which treats each pile row as its own
// 3-slot band rather than aligning to the 4-column grid below/above it).
function pileRowSlots(y: number): { left: Point; center: Point; right: Point } {
  return {
    left: { x: ROW_MARGIN + CARD_WIDTH / 2, y },
    center: { x: LOGICAL_WIDTH / 2, y },
    right: { x: LOGICAL_WIDTH - ROW_MARGIN - CARD_WIDTH / 2, y },
  };
}

function houseColumn(col: number): [Point, Point, Point, Point] {
  const x = middleColumnX(col);
  return [1, 2, 3, 4].map((row) => ({ x, y: rowY(row) })) as [Point, Point, Point, Point];
}

function foundationBlock(): Point[] {
  const points: Point[] = [];
  for (let row = 0; row < MIDDLE_ROWS; row++) {
    points.push({ x: middleColumnX(1), y: rowY(1 + row) });
    points.push({ x: middleColumnX(2), y: rowY(1 + row) });
  }
  return points;
}

// §14 step 6 confirmed layout: cpu's row is mirrored (reserve—waste—talon, left to right)
// relative to human's (talon—waste—reserve), matching the physical game's convention of each
// player reading their own row left-to-right from their own seat; each player's house column
// sits on the same side as their own reserve.
export function computeTableLayout(): TableLayout {
  const cpuRow = pileRowSlots(rowY(0));
  const humanRow = pileRowSlots(rowY(1 + MIDDLE_ROWS));

  return {
    cpu: { reserve: cpuRow.left, waste: cpuRow.center, hand: cpuRow.right, houses: houseColumn(0) },
    human: { hand: humanRow.left, waste: humanRow.center, reserve: humanRow.right, houses: houseColumn(3) },
    foundations: foundationBlock(),
  };
}

export function rowLayoutFor(table: TableLayout, player: PlayerId): PlayerRowLayout {
  return table[player];
}

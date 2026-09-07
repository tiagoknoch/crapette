import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH,
  chooseTableMode,
  computeFoundationDisplayOrder,
  computeTableLayout,
  FOUNDATION_ROW_SUIT,
  HOUSE_OVERLAP_X,
  houseFanPeek,
  TOOLBAR_HEIGHT,
} from './layout.ts';
import type { FoundationSlot } from '../engine/types.ts';

function emptyFoundations(): FoundationSlot[] {
  return Array.from({ length: 8 }, () => ({ suit: null, cards: [] }));
}

describe('computeFoundationDisplayOrder', () => {
  it('returns a permutation of all 8 real indices when nothing is suited yet', () => {
    const order = computeFoundationDisplayOrder(emptyFoundations());
    expect(order).toHaveLength(8);
    expect(new Set(order)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it('groups both foundations of a suit into that suit\'s row, regardless of their real index', () => {
    const foundations = emptyFoundations();
    // Two clubs foundations end up at arbitrary real indices 5 and 1 (e.g. whichever empty
    // slots the engine happened to assign first) — display should still put both of them in
    // club's row together.
    foundations[5] = { suit: 'C', cards: [] };
    foundations[1] = { suit: 'C', cards: [] };

    const order = computeFoundationDisplayOrder(foundations);
    const clubRowIndex = FOUNDATION_ROW_SUIT.indexOf('C');
    const clubRow = order.slice(clubRowIndex * 2, clubRowIndex * 2 + 2);
    expect(new Set(clubRow)).toEqual(new Set([5, 1]));
  });

  it('is stable: an already-suited slot never moves once assigned', () => {
    const foundations = emptyFoundations();
    foundations[3] = { suit: 'H', cards: [] };
    const before = computeFoundationDisplayOrder(foundations);

    // Simulate more of the game happening — another suit gets claimed elsewhere.
    foundations[6] = { suit: 'D', cards: [] };
    const after = computeFoundationDisplayOrder(foundations);

    const heartRowIndex = FOUNDATION_ROW_SUIT.indexOf('H');
    expect(before.slice(heartRowIndex * 2, heartRowIndex * 2 + 2)).toContain(3);
    expect(after.slice(heartRowIndex * 2, heartRowIndex * 2 + 2)).toContain(3);
  });

  it('fills a suit\'s second column from the unassigned pool once its first ace lands', () => {
    const foundations = emptyFoundations();
    foundations[0] = { suit: 'S', cards: [] };

    const order = computeFoundationDisplayOrder(foundations);
    const spadeRowIndex = FOUNDATION_ROW_SUIT.indexOf('S');
    const spadeRow = order.slice(spadeRowIndex * 2, spadeRowIndex * 2 + 2);
    expect(spadeRow).toContain(0);
    expect(spadeRow.some((i) => i !== 0)).toBe(true);
  });
});

describe('chooseTableMode', () => {
  it('picks landscape when at least as wide as tall', () => {
    expect(chooseTableMode(1440, 900)).toBe('landscape');
    expect(chooseTableMode(1024, 1024)).toBe('landscape');
  });

  it('picks portrait when taller than wide', () => {
    expect(chooseTableMode(1024, 1366)).toBe('portrait');
    expect(chooseTableMode(390, 844)).toBe('portrait');
  });
});

describe('computeTableLayout landscape branch', () => {
  it('reuses the exact same middle block (houses + foundations) as portrait', () => {
    const portrait = computeTableLayout('portrait');
    const landscape = computeTableLayout('landscape');
    // The middle block's internal shape (relative offsets between its own points) must be
    // identical between modes — only its absolute position on the canvas may differ, since
    // landscape's canvas origin for the middle block is derived from the flank width instead
    // of the fixed portrait edge margin.
    const relative = (points: { x: number; y: number }[]): { x: number; y: number }[] => {
      const minX = Math.min(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      return points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    };
    // Landscape's middle block starts at row 0 (no pile row above it); portrait's starts at
    // row 1 (row 0 is the cpu pile row) — so absolute y differs by design, only the relative
    // shape (spacing between rows/columns) needs to match exactly.
    expect(relative(landscape.foundations)).toEqual(relative(portrait.foundations));
    expect(relative(landscape.cpu.houses)).toEqual(relative(portrait.cpu.houses));
    expect(relative(landscape.human.houses)).toEqual(relative(portrait.human.houses));
  });

  it('stacks each player\'s talon/waste/reserve vertically, cpu on the left, human on the right', () => {
    const landscape = computeTableLayout('landscape');
    expect(landscape.cpu.reserve.x).toBe(landscape.cpu.waste.x);
    expect(landscape.cpu.waste.x).toBe(landscape.cpu.hand.x);
    expect(landscape.human.hand.x).toBe(landscape.human.waste.x);
    expect(landscape.human.waste.x).toBe(landscape.human.reserve.x);
    expect(landscape.cpu.reserve.x).toBeLessThan(landscape.human.hand.x);
    // Same left-to-right ordering as portrait (reserve—waste—talon for cpu, talon—waste—
    // reserve for human), just read top-to-bottom instead.
    expect(landscape.cpu.reserve.y).toBeLessThan(landscape.cpu.waste.y);
    expect(landscape.cpu.waste.y).toBeLessThan(landscape.cpu.hand.y);
    expect(landscape.human.hand.y).toBeLessThan(landscape.human.waste.y);
    expect(landscape.human.waste.y).toBeLessThan(landscape.human.reserve.y);
  });
});

describe('houseFanPeek (DESIGN_RULES.md §6 fan clamp)', () => {
  it('uses the natural (maximum) peek for a house short enough to fan freely', () => {
    expect(houseFanPeek(0)).toBe(HOUSE_OVERLAP_X);
    expect(houseFanPeek(1)).toBe(HOUSE_OVERLAP_X);
    // clear (6 * HOUSE_OVERLAP_X = 156) / (n - 1) still >= HOUSE_OVERLAP_X through n = 7.
    expect(houseFanPeek(7)).toBe(HOUSE_OVERLAP_X);
  });

  it('compresses evenly once the natural peek would exceed the clear space', () => {
    const peek = houseFanPeek(8);
    expect(peek).toBeLessThan(HOUSE_OVERLAP_X);
    expect(peek).toBeCloseTo((6 * HOUSE_OVERLAP_X) / 7);
  });

  it('never compresses below the legibility floor, however long the house grows', () => {
    const floor = 0.1 * CARD_WIDTH;
    expect(houseFanPeek(18)).toBeCloseTo(floor);
    expect(houseFanPeek(52)).toBeCloseTo(floor); // a near-worst-case house (most of a deck)
    expect(houseFanPeek(52)).toBeGreaterThanOrEqual(floor - 1e-9);
  });

  it('is monotonically non-increasing as a house grows — never gets peekier by adding a card', () => {
    let previous = houseFanPeek(1);
    for (let n = 2; n <= 40; n++) {
      const peek = houseFanPeek(n);
      expect(peek).toBeLessThanOrEqual(previous + 1e-9);
      previous = peek;
    }
  });
});

describe('TOOLBAR_HEIGHT', () => {
  it('reserves a full-width band at the very top of the logical canvas in both modes', () => {
    // No slot in either arrangement may render above the toolbar band — every row-derived
    // y-coordinate must clear TOOLBAR_HEIGHT by at least half a card height (the topmost
    // row's center sits at TOOLBAR_HEIGHT + ROW_MARGIN + CARD_HEIGHT / 2).
    const portrait = computeTableLayout('portrait');
    const landscape = computeTableLayout('landscape');
    const allYs = (layout: ReturnType<typeof computeTableLayout>): number[] => [
      layout.cpu.hand.y,
      layout.cpu.waste.y,
      layout.cpu.reserve.y,
      layout.human.hand.y,
      layout.human.waste.y,
      layout.human.reserve.y,
      ...layout.cpu.houses.map((p) => p.y),
      ...layout.human.houses.map((p) => p.y),
      ...layout.foundations.map((p) => p.y),
    ];
    for (const y of [...allYs(portrait), ...allYs(landscape)]) {
      expect(y).toBeGreaterThan(TOOLBAR_HEIGHT);
    }
  });
});

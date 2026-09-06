import { describe, expect, it } from 'vitest';
import { computeFoundationDisplayOrder, FOUNDATION_ROW_SUIT } from './layout.ts';
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

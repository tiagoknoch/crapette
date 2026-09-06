// §12/§14 step 6: turns a Card into a Pixi Sprite using the vendored htdebeer/SVG-cards art
// (public/cards/, LGPL-2.1 — see public/cards/CREDIT.md). This is the only place that knows
// the card-art filename convention.
//
// Each file here is a standalone, self-contained SVG (extracted from the upstream project's
// single combined svg-cards.svg sheet — every card is a <use> onto a small closure of shared
// <defs>, not a separate drawing — see public/cards/CREDIT.md for how these were produced).
// Genuine vector art, not a pre-rasterized PNG: Pixi's SVG loader rasterizes each one to a
// texture at SVG_RASTER_RESOLUTION× its natural size (169×245), comfortably above any size a
// card is actually drawn at, so it stays crisp regardless of how big CARD_WIDTH/CARD_HEIGHT
// (layout.ts) end up being — unlike a fixed-resolution PNG, which blurs past its native size.
import { Assets, Sprite } from 'pixi.js';
import type { Card, PlayerId, Rank, Suit } from '../../engine/types.ts';
import { CARD_HEIGHT, CARD_WIDTH } from '../layout.ts';

const SVG_RASTER_RESOLUTION = 3;

// §12: "16 pre-made card-back colors, which conveniently covers the optional cosmetic
// distinction between the two players' reserve/hand piles" — purely cosmetic, no gameplay
// meaning, but it makes it obvious at a glance whose face-down pile is whose.
export const PLAYER_BACK_COLOR: Record<PlayerId, string> = {
  human: 'blue',
  cpu: 'red',
};

const SUIT_TOKEN: Record<Suit, string> = {
  S: 'spade',
  H: 'heart',
  D: 'diamond',
  C: 'club',
};

const RANK_TOKEN: Record<Rank, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'jack',
  12: 'queen',
  13: 'king',
};

function faceKey(suit: Suit, rank: Rank): string {
  return `${SUIT_TOKEN[suit]}_${RANK_TOKEN[rank]}`;
}

function backKey(player: PlayerId): string {
  return `back-${PLAYER_BACK_COLOR[player]}`;
}

function allFaceKeys(): string[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const ranks: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  return suits.flatMap((suit) => ranks.map((rank) => faceKey(suit, rank)));
}

// Loads every face + both player back colors into Pixi's texture cache, keyed by
// faceKey()/backKey(), so createCardSprite below can synchronously look them up.
export async function preloadCardTextures(): Promise<void> {
  const keys = [...allFaceKeys(), backKey('human'), backKey('cpu')];
  Assets.add(keys.map((key) => ({ alias: key, src: `/cards/${key}.svg`, data: { resolution: SVG_RASTER_RESOLUTION } })));
  await Assets.load(keys);
}

// `owner` picks the back color for a face-down card; irrelevant for a face-up one, so
// callers that only ever draw face-up cards (foundations, houses) can omit it.
export function createCardSprite(card: Card, owner: PlayerId = 'human'): Sprite {
  const key = card.faceUp ? faceKey(card.suit, card.rank) : backKey(owner);
  const sprite = new Sprite(Assets.get(key));
  sprite.width = CARD_WIDTH;
  sprite.height = CARD_HEIGHT;
  sprite.anchor.set(0.5);
  return sprite;
}

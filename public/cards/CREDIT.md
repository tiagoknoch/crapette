Card face/back art in this directory is vendored from
[htdebeer/SVG-cards](https://github.com/htdebeer/SVG-cards), licensed LGPL-2.1 — see
`LICENSE` and `AUTHORS` in this directory.

Originally vendored as the project's pre-rendered `png/2x/` PNGs, since a fixed raster
resolution blurs/aliases once a card is drawn at any other size (found via manual
play-testing once cards were resized). Switched to genuine vector art instead: the
upstream project ships all 52 faces + the card back as a *single* combined
`svg-cards.svg` sheet (every card is a `<use>` onto a shared pool of `<defs>` — suit
pips, court-card art, lace patterns, etc. — not a separate self-contained drawing), so
each file here (`club_1.svg`, `back-blue.svg`, ...) was produced by resolving that one
card's `<use>` reference closure recursively and inlining exactly those `<defs>` into a
small standalone SVG document. `back-blue.svg`/`back-red.svg` are the same `back`
definition with a `fill` set on the outer `<use>` — the upstream README documents this
as the intended way to recolor the back (its paths use `fill:inherit`) — rather than two
of the upstream's 16 pre-baked back-color PNGs. `src/render/pixi/cardSprites.ts`
rasterizes each SVG to a texture at several times its natural size
(`SVG_RASTER_RESOLUTION`), so it stays crisp at any card size the layout ever asks for.

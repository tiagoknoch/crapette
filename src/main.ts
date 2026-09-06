import './style.css';
import { deal } from './engine/deck.ts';
import type { GameState } from './engine/types.ts';
import { i18next, initI18n } from './i18n/index.ts';
import { createTableScene, renderGameState } from './render/pixi/scene.ts';
import {
  attemptDragMove,
  canPickUp,
  cpuStep,
  getFlash,
  getSelected,
  getState,
  handleSlotClick,
  initGameStore,
  loadSavedGame,
  subscribe,
} from './state/gameStore.ts';

// §14 step 8: how often the CPU seat takes its next single action (one move, one draw, or
// resolving its drawn card) while it's the CPU's turn — cpuStep() is a no-op otherwise, so
// this can just tick unconditionally for the life of the page. Paced slowly enough for a
// human to actually follow what the CPU did, not so slow it feels unresponsive.
const CPU_TICK_MS = 700;

// §14 step 6/7: a fixed seed keeps each dev session reproducible.
function makeSeededRng(seed: number): () => number {
  let state = seed % 0x7fffffff || 1;
  return () => {
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// §14 step 11/§10: "if a save exists and the game is in_progress, offer Resume vs New Game."
// Plain DOM overlay (like #rotate-overlay) rather than a Pixi screen, since it needs to
// resolve *before* the table scene (and its fixed-seed-or-saved starting GameState) exists.
function promptResumeOrNew(saved: GameState): Promise<GameState> {
  return new Promise((resolve) => {
    const overlay = document.querySelector<HTMLDivElement>('#resume-prompt');
    const message = document.querySelector<HTMLParagraphElement>('#resume-prompt-message');
    const resumeButton = document.querySelector<HTMLButtonElement>('#resume-prompt-resume');
    const newGameButton = document.querySelector<HTMLButtonElement>('#resume-prompt-new');
    if (!overlay || !message || !resumeButton || !newGameButton) {
      resolve(saved); // can't prompt — resume silently rather than losing the saved game
      return;
    }
    message.textContent = i18next.t('resume.message');
    resumeButton.textContent = i18next.t('resume.resumeButton');
    newGameButton.textContent = i18next.t('resume.newGameButton');
    const finish = (chosen: GameState): void => {
      overlay.classList.remove('visible');
      resolve(chosen);
    };
    resumeButton.onclick = () => finish(saved);
    newGameButton.onclick = () => finish(deal());
    overlay.classList.add('visible');
  });
}

async function main(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) throw new Error('#app container missing from index.html');

  await initI18n();

  const rotateOverlay = document.querySelector<HTMLDivElement>('#rotate-overlay');
  if (rotateOverlay) rotateOverlay.textContent = i18next.t('rotate.message');

  const saved = loadSavedGame();
  // No save at all (truly first-ever visit): fixed seed, for a reproducible dev session. A
  // save exists but its game already ended: start fresh automatically, genuinely random —
  // matches "Play Again"'s behavior, no prompt needed ("otherwise start fresh", §10). A save
  // exists and is still in_progress: ask.
  const initialState =
    saved === null ? deal(makeSeededRng(1)) : saved.status !== 'in_progress' ? deal() : await promptResumeOrNew(saved);
  initGameStore(initialState);

  let render = (): void => {};
  // §14 step 9: "Play Again" re-deals a fresh, genuinely random game (deal()'s default RNG
  // is Math.random — only the very first load uses the fixed seed above, for reproducible
  // dev sessions).
  const newGame = (): void => {
    initGameStore(deal());
    // Card ids are stable (suit+rank+copy, not randomized, see deck.ts) — without clearing
    // this, the fresh deal's opening render would see "same id, different point" for every
    // card versus the previous game and animate the whole table sliding in from where it
    // last was, instead of just appearing.
    scene.cardRenderState.clear();
    render();
  };

  const scene = await createTableScene(container, {
    onSlotClick: (ref) => handleSlotClick(ref),
    onPlayAgain: () => newGame(),
    canPickUp: (ref) => canPickUp(ref),
    onDrop: (from, to) => attemptDragMove(from, to),
  });
  render = (): void => renderGameState(scene, getState(), getSelected(), getFlash());
  subscribe(render);
  render();

  setInterval(cpuStep, CPU_TICK_MS);
}

main();

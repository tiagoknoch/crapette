import './style.css';
import { deal } from './engine/deck.ts';
import { createTableScene, renderGameState } from './render/pixi/scene.ts';
import { cpuStep, getFlash, getSelected, getState, handleSlotClick, initGameStore, subscribe } from './state/gameStore.ts';

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

async function main(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) throw new Error('#app container missing from index.html');

  initGameStore(deal(makeSeededRng(1)));

  let render = (): void => {};
  // §14 step 9: "Play Again" re-deals a fresh, genuinely random game (deal()'s default RNG
  // is Math.random — only the very first load uses the fixed seed above, for reproducible
  // dev sessions).
  const newGame = (): void => {
    initGameStore(deal());
    render();
  };

  const scene = await createTableScene(
    container,
    (ref) => handleSlotClick(ref),
    () => newGame(),
  );
  render = (): void => renderGameState(scene, getState(), getSelected(), getFlash());
  subscribe(render);
  render();

  setInterval(cpuStep, CPU_TICK_MS);
}

main();

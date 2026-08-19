import './style.css';
import { buildTwoDeckPool, deal } from './engine/deck.ts';
import { createTableScene, renderGameState } from './render/pixi/scene.ts';
import { getFlash, getSelected, getState, handleSlotClick, initGameStore, subscribe } from './state/gameStore.ts';

// §14 step 6/7: a fixed seed keeps each dev session reproducible. Both seats are
// click-driven for now — CPU auto-play (cpuPlayer.ts on a timer) is step 8.
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

  initGameStore(deal(buildTwoDeckPool(), makeSeededRng(1)));

  const scene = await createTableScene(container, (ref) => handleSlotClick(ref));
  const render = (): void => renderGameState(scene, getState(), getSelected(), getFlash());
  subscribe(render);
  render();
}

main();

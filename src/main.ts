import './style.css';
import { buildTwoDeckPool, deal } from './engine/deck.ts';
import { createTableScene, renderGameState } from './render/pixi/scene.ts';

// §14 step 6: static render only — a fixed seed keeps the snapshot reproducible for visual
// QA. Step 7 replaces this with the real turn loop (human input + cpuPlayer.ts) driving
// re-renders after every move.
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

  const scene = await createTableScene(container);
  const state = deal(buildTwoDeckPool(), makeSeededRng(1));
  renderGameState(scene, state);
}

main();

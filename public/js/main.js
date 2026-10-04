import { createViewer } from './viewer.js';

const viewer = await createViewer(document.getElementById('scene'), {
  url: 'models/modelo.glb',
  onProgress: (p) => { document.getElementById('progress').textContent = `${Math.round(p * 100)}%`; },
});
document.getElementById('loading').classList.add('hidden');

// Accesible desde la consola para depurar: window.viewer.bones, etc.
window.viewer = viewer;

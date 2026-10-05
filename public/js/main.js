import { createViewer } from './viewer.js?v=5';
import { createPoseDetector, startCamera, runDetection } from './pose.js?v=5';
import { createRetargeter } from './mapping.js?v=5';

const $ = (id) => document.getElementById(id);
const btnCamera = $('btn-camera');
const chkMirror = $('chk-mirror');
const status = $('status');
const camBox = $('cam-box');

function setStatus(kind, text) {
  status.className = `status ${kind}`;
  status.textContent = text;
}

// Carga del modelo y de MediaPipe en paralelo
const detectorPromise = createPoseDetector();
const viewer = await createViewer($('scene'), {
  url: 'models/modelo.glb',
  onProgress: (p) => { $('progress').textContent = `${Math.round(p * 100)}%`; },
});
$('loading').classList.add('hidden');
window.viewer = viewer;
btnCamera.disabled = false;

const state = { mirror: chkMirror.checked, pose: null };
const applyMirror = () => { state.mirror = chkMirror.checked; camBox.classList.toggle('mirror', state.mirror); };
chkMirror.addEventListener('change', applyMirror);
applyMirror();

btnCamera.addEventListener('click', async () => {
  btnCamera.disabled = true;
  btnCamera.textContent = 'Iniciando…';
  try {
    const [landmarker] = await Promise.all([detectorPromise, startCamera($('video'))]);
    camBox.classList.remove('hidden');
    btnCamera.textContent = 'Cámara activa';
    setStatus('no', 'Sin persona');

    let frames = 0, t0 = performance.now(), detected = null;
    runDetection($('video'), $('overlay'), landmarker, (pose) => {
      state.pose = pose;
      if (!!pose !== detected) {
        detected = !!pose;
        setStatus(detected ? 'yes' : 'no', detected ? 'Persona detectada' : 'Sin persona');
      }
      if (++frames === 30) {
        $('fps').textContent = `${Math.round(30000 / (performance.now() - t0))} fps`;
        frames = 0; t0 = performance.now();
      }
    });
  } catch (err) {
    console.error(err);
    const msg = err.name === 'NotAllowedError' ? 'Permiso de cámara denegado'
      : err.name === 'NotFoundError' ? 'No se encontró cámara' : 'Error al iniciar';
    setStatus('off', msg);
    btnCamera.textContent = 'Reintentar';
    btnCamera.disabled = false;
  }
});

// Mueve los huesos en cada fotograma de render
const retargeter = createRetargeter(viewer);
viewer.onFrame(() => retargeter.update(state.pose, state.mirror));
window.retargeter = retargeter;   // p. ej. retargeter.enabled.legs = false
window.appState = state;

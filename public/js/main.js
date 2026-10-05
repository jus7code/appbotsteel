import { createViewer } from './viewer.js?v=dev';
import { createPoseDetector, startCamera, runDetection } from './pose.js?v=dev';
import { createRetargeter } from './mapping.js?v=dev';

const $ = (id) => document.getElementById(id);
const btnCamera = $('btn-camera');
const chkMirror = $('chk-mirror');
const status = $('status');
const camBox = $('cam-box');

function setStatus(kind, text) {
  status.className = `status ${kind}`;
  status.textContent = text;
}

function fatal(msg) {
  $('loading').classList.add('hidden');
  $('error').innerHTML = msg;
  $('error').classList.remove('hidden');
  btnCamera.disabled = true;
}

// Comprobaciones de compatibilidad antes de cargar nada pesado
if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  fatal('Este navegador no permite usar la cámara aquí.<br>Abre la página por <b>https://</b> en Chrome o Edge de escritorio.');
  throw new Error('Sin getUserMedia');
}
if (!document.createElement('canvas').getContext('webgl2')) {
  fatal('Tu navegador no tiene WebGL2 activo.<br>Activa la aceleración por hardware en la configuración del navegador.');
  throw new Error('Sin WebGL2');
}

// Carga del modelo y de MediaPipe en paralelo
const detectorPromise = createPoseDetector();
detectorPromise.catch(() => {});
let viewer;
try {
  viewer = await createViewer($('scene'), {
    url: 'models/modelo.glb',
    onProgress: (p) => { $('progress').textContent = `${Math.round(p * 100)}%`; },
  });
} catch (err) {
  console.error(err);
  fatal('No se pudo cargar el modelo 3D. Revisa tu conexión y recarga la página.');
  throw err;
}
$('loading').classList.add('hidden');
btnCamera.disabled = false;

const state = { mirror: chkMirror.checked, pose: null, stop: null };
const applyMirror = () => { state.mirror = chkMirror.checked; camBox.classList.toggle('mirror', state.mirror); };
chkMirror.addEventListener('change', applyMirror);
applyMirror();

// Mueve los huesos en cada fotograma de render
const retargeter = createRetargeter(viewer);
viewer.onFrame(() => retargeter.update(state.pose, state.mirror));

// Panel de ajustes
$('btn-settings').addEventListener('click', () => $('settings').classList.toggle('hidden'));
document.querySelectorAll('[data-group]').forEach((el) =>
  el.addEventListener('change', () => { retargeter.enabled[el.dataset.group] = el.checked; }));
$('rng-smooth').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  retargeter.settings.landmarkSmoothing = v;
  retargeter.settings.boneSmoothing = v * 0.7;
  $('out-smooth').textContent = v.toFixed(2);
});
$('chk-skeleton').addEventListener('change', (e) => { $('overlay').style.visibility = e.target.checked ? 'visible' : 'hidden'; });

function stopCamera() {
  state.stop?.();
  state.stop = null;
  state.pose = null;
  camBox.classList.add('hidden');
  btnCamera.textContent = 'Iniciar cámara';
  btnCamera.classList.remove('stop');
  setStatus('off', 'Cámara apagada');
}

async function startAll() {
  btnCamera.disabled = true;
  btnCamera.textContent = 'Iniciando…';
  try {
    let landmarker;
    try { landmarker = await detectorPromise; } catch (err) {
      throw Object.assign(new Error('MediaPipe'), { name: 'DetectorError', cause: err });
    }
    const stopStream = await startCamera($('video'));
    camBox.classList.remove('hidden');
    setStatus('no', 'Sin persona');

    let frames = 0, t0 = performance.now(), detected = null;
    const stopLoop = runDetection($('video'), $('overlay'), landmarker, (pose) => {
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
    state.stop = () => { stopLoop(); stopStream(); };
    btnCamera.textContent = 'Detener cámara';
    btnCamera.classList.add('stop');
  } catch (err) {
    console.error(err);
    const msg = {
      NotAllowedError: 'Permiso de cámara denegado',
      NotFoundError: 'No se encontró cámara',
      NotReadableError: 'La cámara está en uso por otra app',
      DetectorError: 'No se pudo cargar MediaPipe',
    }[err.name] ?? 'Error al iniciar';
    setStatus('off', msg);
    btnCamera.textContent = 'Reintentar';
  } finally {
    btnCamera.disabled = false;
  }
}

btnCamera.addEventListener('click', () => (state.stop ? stopCamera() : startAll()));

// Para depurar desde la consola
Object.assign(window, { viewer, retargeter, appState: state });

import { FilesetResolver, PoseLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

export async function createPoseDetector() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    return await PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' } });
  } catch (err) {
    console.warn('GPU no disponible para MediaPipe, usando CPU', err);
    return await PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' } });
  }
}

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}

/**
 * Bucle de detección. Llama a onResult({ landmarks, worldLandmarks }) en cada fotograma de vídeo,
 * con null cuando no hay persona.
 */
export function runDetection(video, overlay, landmarker, onResult) {
  const ctx = overlay.getContext('2d');
  const draw = new DrawingUtils(ctx);
  let lastVideoTime = -1;
  let running = true;

  function loop() {
    if (!running) { ctx.clearRect(0, 0, overlay.width, overlay.height); return; }
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;

      const res = landmarker.detectForVideo(video, performance.now());
      const lm = res.landmarks?.[0];
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (lm) {
        draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#00e5ff', lineWidth: 3 });
        draw.drawLandmarks(lm, { color: '#ff3d71', fillColor: '#ff3d71', radius: 3 });
      }
      onResult(lm ? { landmarks: lm, worldLandmarks: res.worldLandmarks[0] } : null);
    }
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  }
  loop();
  return () => { running = false; };
}

import * as THREE from 'three';
import { PoseLandmarker } from '@mediapipe/tasks-vision';

console.log('Three.js', THREE.REVISION, '| MediaPipe cargado:', typeof PoseLandmarker === 'function');

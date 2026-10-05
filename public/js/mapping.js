import * as THREE from 'three';

// Índices de landmarks de MediaPipe Pose
export const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18, L_INDEX: 19, R_INDEX: 20,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
};

// Cada entrada orienta un hueso para que apunte de `from` a `to`, usando como dirección de reposo
// la que va del hueso a `child`. El orden importa: padres antes que hijos.
const CHAINS = [
  { bone: 'LeftArm',      child: 'LeftForeArm',  from: LM.L_SHOULDER, to: LM.L_ELBOW },
  { bone: 'LeftForeArm',  child: 'LeftHand',     from: LM.L_ELBOW,    to: LM.L_WRIST },
  { bone: 'RightArm',     child: 'RightForeArm', from: LM.R_SHOULDER, to: LM.R_ELBOW },
  { bone: 'RightForeArm', child: 'RightHand',    from: LM.R_ELBOW,    to: LM.R_WRIST },
];

// Pares izquierda/derecha para el modo no espejo
const SWAP = [[11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10]];

const MIN_VISIBILITY = 0.5;

export function createRetargeter(viewer, { landmarkSmoothing = 0.5, boneSmoothing = 0.35 } = {}) {
  const { bones, restPose } = viewer;
  const chains = CHAINS.filter((c) => bones[c.bone] && bones[c.child]);
  console.info(`Retargeting: ${chains.length}/${CHAINS.length} cadenas activas`, chains.map((c) => c.bone));
  const smoothed = [];       // landmarks suavizados (THREE.Vector3 en espacio del mundo)
  const visible = [];

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _cur = new THREE.Vector3(), _dst = new THREE.Vector3();
  const _qParent = new THREE.Quaternion(), _qDelta = new THREE.Quaternion(), _qTarget = new THREE.Quaternion();

  /**
   * Convierte worldLandmarks de MediaPipe (metros, y hacia abajo, z hacia la cámara negativo)
   * al sistema de Three.js con el modelo mirando a +Z (hacia el espectador).
   * En modo espejo, el lado izquierdo del usuario mueve el lado izquierdo del modelo: el modelo
   * actúa como el reflejo del usuario. Sin espejo, se intercambian lados y se invierte X.
   */
  function ingest(world, image, mirror) {
    for (let i = 0; i < world.length; i++) {
      let src = i;
      if (!mirror) for (const [l, r] of SWAP) { if (i === l) src = r; else if (i === r) src = l; }
      const p = world[src];
      _a.set(mirror ? p.x : -p.x, -p.y, -p.z);
      if (!smoothed[i]) smoothed[i] = _a.clone();
      else smoothed[i].lerp(_a, 1 - landmarkSmoothing);
      // La visibilidad fiable viene en los landmarks de imagen; en worldLandmarks suele llegar a 0
      visible[i] = (image[src].visibility ?? 1) >= MIN_VISIBILITY;
    }
  }

  function update(pose, mirror) {
    if (pose) ingest(pose.worldLandmarks, pose.landmarks, mirror);

    for (const c of chains) {
      const bone = bones[c.bone];
      const prev = bone.quaternion.clone();
      const ok = pose && visible[c.from] && visible[c.to];

      // Parte de la pose de reposo (pose A) del hueso
      bone.quaternion.copy(restPose.get(bone));
      if (ok) {
        bone.updateWorldMatrix(true, true);
        bones[c.child].getWorldPosition(_b);
        bone.getWorldPosition(_a);
        _cur.subVectors(_b, _a).normalize();
        _dst.subVectors(smoothed[c.to], smoothed[c.from]).normalize();

        // Rotación en mundo que lleva la dirección actual a la deseada, pasada a espacio local:
        // q_local' = q_parent^-1 * q_delta * q_parent * q_local
        _qDelta.setFromUnitVectors(_cur, _dst);
        bone.parent.getWorldQuaternion(_qParent);
        _qTarget.copy(_qParent).invert().multiply(_qDelta).multiply(_qParent).multiply(bone.quaternion);
      } else {
        _qTarget.copy(restPose.get(bone));   // sin datos: vuelve suavemente a la pose A
      }
      bone.quaternion.copy(prev).slerp(_qTarget, 1 - boneSmoothing);
      bone.updateWorldMatrix(false, true);
    }
  }

  return { update };
}

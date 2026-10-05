import * as THREE from 'three';

// Índices de landmarks de MediaPipe Pose
export const LM = {
  NOSE: 0, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18, L_INDEX: 19, R_INDEX: 20,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28, L_FOOT: 31, R_FOOT: 32,
};

// Pares izquierda/derecha para el modo no espejo
const SWAP = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

const MIN_VISIBILITY = 0.5;

// Vectores objetivo a partir de los landmarks suavizados (P = posiciones, V = visibles)
const mid = (P, a, b) => P[a].clone().add(P[b]).multiplyScalar(0.5);
const dir = (a, b) => ({ need: [a, b], get: (P) => P[b].clone().sub(P[a]) });
const TORSO_UP = { need: [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER],
  get: (P) => mid(P, LM.L_SHOULDER, LM.R_SHOULDER).sub(mid(P, LM.L_HIP, LM.R_HIP)) };
const HIP_SIDE = dir(LM.R_HIP, LM.L_HIP);
const SHOULDER_SIDE = dir(LM.R_SHOULDER, LM.L_SHOULDER);
const HEAD_SIDE = dir(LM.R_EAR, LM.L_EAR);
// Mano: de la muñeca al centro de los nudillos, y de índice a meñique para el giro de la palma
const handDir = (w, i, p) => ({ need: [w, i, p], get: (P) => mid(P, i, p).sub(P[w]) });
const HAND_L = [handDir(LM.L_WRIST, LM.L_INDEX, LM.L_PINKY), dir(LM.L_INDEX, LM.L_PINKY)];
const HAND_R = [handDir(LM.R_WRIST, LM.R_INDEX, LM.R_PINKY), dir(LM.R_INDEX, LM.R_PINKY)];
const HEAD_FWD = { need: [LM.NOSE, LM.L_EAR, LM.R_EAR], get: (P) => P[LM.NOSE].clone().sub(mid(P, LM.L_EAR, LM.R_EAR)) };

// Referencias en la pose de reposo, en espacio del mundo. El modelo mira a +Z, así que su izquierda es +X.
const toChild = (child) => ({ child });
const between = (from, to) => ({ from, to });   // de un hueso a otro (no necesariamente hijo)
const WORLD_X = { world: new THREE.Vector3(1, 0, 0) };
const WORLD_Z = { world: new THREE.Vector3(0, 0, 1) };

/*
 * Cada regla orienta un hueso. `primary` se alinea exactamente; `secondary` (opcional) fija el giro
 * alrededor de primary. El orden importa: padres antes que hijos.
 */
const RULES = [
  // Torso
  { group: 'torso', bone: 'Hips',  primary: [toChild('Spine2'), TORSO_UP], secondary: [WORLD_X, HIP_SIDE] },
  { group: 'torso', bone: 'Spine', primary: [toChild('Neck'), TORSO_UP],   secondary: [WORLD_X, SHOULDER_SIDE], weight: 0.6 },
  // Cabeza: primero el giro lateral (orejas), después hacia dónde mira (nariz)
  { group: 'head', bone: 'Head', primary: [WORLD_X, HEAD_SIDE], secondary: [WORLD_Z, HEAD_FWD], weight: 0.8 },
  // Brazos
  { group: 'arms', bone: 'LeftArm',      primary: [toChild('LeftForeArm'),  dir(LM.L_SHOULDER, LM.L_ELBOW)] },
  { group: 'arms', bone: 'LeftForeArm',  primary: [toChild('LeftHand'),     dir(LM.L_ELBOW, LM.L_WRIST)] },
  { group: 'hands', bone: 'LeftHand', primary: [toChild('LeftHandMiddle1'), HAND_L[0]],
    secondary: [between('LeftHandIndex1', 'LeftHandPinky1'), HAND_L[1]] },
  { group: 'arms', bone: 'RightArm',     primary: [toChild('RightForeArm'), dir(LM.R_SHOULDER, LM.R_ELBOW)] },
  { group: 'arms', bone: 'RightForeArm', primary: [toChild('RightHand'),    dir(LM.R_ELBOW, LM.R_WRIST)] },
  { group: 'hands', bone: 'RightHand', primary: [toChild('RightHandMiddle1'), HAND_R[0]],
    secondary: [between('RightHandIndex1', 'RightHandPinky1'), HAND_R[1]] },
  // Piernas
  { group: 'legs', bone: 'LeftUpLeg',  primary: [toChild('LeftLeg'),      dir(LM.L_HIP, LM.L_KNEE)] },
  { group: 'legs', bone: 'LeftLeg',    primary: [toChild('LeftFoot'),     dir(LM.L_KNEE, LM.L_ANKLE)] },
  { group: 'legs', bone: 'LeftFoot',   primary: [toChild('LeftToeBase'), dir(LM.L_ANKLE, LM.L_FOOT)] },
  { group: 'legs', bone: 'RightUpLeg', primary: [toChild('RightLeg'),     dir(LM.R_HIP, LM.R_KNEE)] },
  { group: 'legs', bone: 'RightLeg',   primary: [toChild('RightFoot'),    dir(LM.R_KNEE, LM.R_ANKLE)] },
  { group: 'legs', bone: 'RightFoot',  primary: [toChild('RightToeBase'), dir(LM.R_ANKLE, LM.R_FOOT)] },
];

export function createRetargeter(viewer, { landmarkSmoothing = 0.9, boneSmoothing = 0.63 } = {}) {
  const { bones, restPose } = viewer;
  const settings = { landmarkSmoothing, boneSmoothing };
  const enabled = { torso: true, head: true, arms: true, hands: false, legs: true };

  // Pasa cada referencia de reposo a espacio local del hueso, para reconstruirla en cada fotograma
  // aunque los padres se hayan movido.
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _c = new THREE.Vector3();
  const toLocal = (bone, ref) => {
    let w;
    if (ref.child || ref.from) {
      bones[ref.child ?? ref.to].getWorldPosition(_c);
      (ref.child ? bone : bones[ref.from]).getWorldPosition(_p);
      w = _c.sub(_p);
    } else w = ref.world.clone();
    return w.normalize().applyQuaternion(bone.getWorldQuaternion(_q).invert());
  };
  viewer.model.updateMatrixWorld(true);
  const rules = RULES.filter((r) => bones[r.bone] && [r.primary, r.secondary].every((s) => !s || [s[0].child, s[0].from, s[0].to].every((n) => !n || bones[n])))
    .map((r) => ({ ...r, b: bones[r.bone], ref1: toLocal(bones[r.bone], r.primary[0]), ref2: r.secondary && toLocal(bones[r.bone], r.secondary[0]) }));
  console.info(`Retargeting: ${rules.length}/${RULES.length} reglas activas`, rules.map((r) => r.bone));

  const P = [], V = [];
  const _v = new THREE.Vector3();
  /*
   * El modelo mira al espectador, así que su derecha queda a la izquierda de la pantalla.
   * Modo espejo (como un reflejo): el brazo izquierdo del usuario mueve el derecho del modelo,
   * por eso se intercambian lados y se invierte X. Sin espejo: cada lado mueve el mismo lado.
   */
  function ingest(world, image, mirror) {
    for (let i = 0; i < world.length; i++) {
      let src = i;
      if (mirror) for (const [l, r] of SWAP) { if (i === l) src = r; else if (i === r) src = l; }
      const p = world[src];
      // MediaPipe: y hacia abajo, z negativo hacia la cámara -> Three.js: y arriba, +Z hacia el espectador
      _v.set(mirror ? -p.x : p.x, -p.y, -p.z);
      if (!P[i]) P[i] = _v.clone(); else P[i].lerp(_v, 1 - settings.landmarkSmoothing);
      // La visibilidad fiable viene en los landmarks de imagen; en worldLandmarks suele llegar a 0
      V[i] = (image[src].visibility ?? 1) >= MIN_VISIBILITY;
    }
  }

  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  const _qW = new THREE.Quaternion(), _qD = new THREE.Quaternion(), _qT = new THREE.Quaternion(), _qPrev = new THREE.Quaternion();
  const _qId = new THREE.Quaternion();

  // Base ortonormal (x = a, z = b sin componente en a, y = z × x)
  const basis = (m, a, b) => {
    const x = a.clone().normalize();
    const z = b ? b.clone().addScaledVector(x, -b.dot(x)).normalize() : null;
    if (!z || z.lengthSq() < 1e-6) return false;
    m.makeBasis(x, new THREE.Vector3().crossVectors(z, x), z);
    return true;
  };

  function solve(r) {
    const b = r.b;
    b.getWorldQuaternion(_qW);
    const cur1 = r.ref1.clone().applyQuaternion(_qW);
    const dst1 = r.primary[1].get(P);
    if (r.secondary && r.secondary[1].need.every((i) => V[i])) {
      const cur2 = r.ref2.clone().applyQuaternion(_qW);
      const dst2 = r.secondary[1].get(P);
      if (basis(_m1, cur1, cur2) && basis(_m2, dst1, dst2)) {
        _qD.setFromRotationMatrix(_m2.multiply(_m1.transpose()));
        return true;
      }
    }
    _qD.setFromUnitVectors(cur1.normalize(), dst1.normalize());
    return true;
  }

  function update(pose, mirror) {
    if (pose) ingest(pose.worldLandmarks, pose.landmarks, mirror);

    for (const r of rules) {
      const b = r.b;
      _qPrev.copy(b.quaternion);
      b.quaternion.copy(restPose.get(b));     // parte siempre de la pose A
      b.updateWorldMatrix(true, false);

      const ok = pose && enabled[r.group] && r.primary[1].need.every((i) => V[i]) && solve(r);
      if (ok) {
        if (r.weight !== undefined) _qD.slerpQuaternions(_qId, _qD, r.weight);
        // q_local' = q_parent^-1 * q_delta * q_parent * q_local
        b.parent.getWorldQuaternion(_q);
        _qT.copy(_q).invert().multiply(_qD).multiply(_q).multiply(b.quaternion);
      } else {
        _qT.copy(restPose.get(b));            // sin datos: vuelve suavemente a la pose A
      }
      b.quaternion.copy(_qPrev).slerp(_qT, 1 - settings.boneSmoothing);
      b.updateWorldMatrix(false, true);
    }
  }

  return { update, enabled, settings };
}

/*
 * Modelos disponibles. `bones` traduce los nombres canónicos que usa mapping.js (estilo Mixamo, sin
 * prefijo ni sufijo numérico) a los nombres del rig de cada modelo. Sin `bones`, se usan tal cual.
 * Los huesos que no existan en un modelo hacen que su regla se omita.
 */
export const MODELS = [
  { id: 'spartan', name: 'Spartan', url: 'models/spartan.glb?v=dev' },
  {
    id: 'robot',
    name: 'Robot M.A.N.U.L.',
    url: 'models/robot.glb?v=dev',
    bones: {
      // Sin columna separada: Torso1 es la raíz del cuerpo (arrastra cuello, brazos y pelvis)
      Hips: 'Torso1', Spine2: 'Neck', Neck: 'Neck', Head: 'Head',
      LeftArm: 'arm2_l', LeftForeArm: 'arm3_l', LeftHand: 'Hand1_l',
      RightArm: 'arm2_r', RightForeArm: 'arm3_r', RightHand: 'Hand1_r',
      // El pie del robot apunta hacia abajo, así que no se anima (no hay ToeBase)
      LeftUpLeg: 'leg2_l', LeftLeg: 'leg3_l', LeftFoot: 'Foot_l',
      RightUpLeg: 'leg2_r', RightLeg: 'leg3_r', RightFoot: 'Foot_r',
    },
  },
  {
    id: 'drone',
    name: 'Mech Drone',
    url: 'models/drone.glb?v=dev',
    // Solo brazos. Los nombres del autor no coinciden con el lado real: ArmR está en +X, que es la
    // izquierda del modelo (mira a +Z), así que se asignan por posición.
    bones: {
      LeftArm: 'ArmR1', LeftForeArm: 'ArmR2', LeftHand: 'PinceL',
      RightArm: 'ArmL1', RightForeArm: 'ArmL2', RightHand: 'PinceR',
    },
  },
];

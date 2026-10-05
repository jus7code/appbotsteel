import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15171c);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Luces: ambiente suave + luz principal con sombra + contraluz
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
  rim.position.set(-3, 2, -3);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  camera.position.set(0, 1.1, 4);
  controls.target.set(0, 0.95, 0);
  controls.update();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const callbacks = [];
  renderer.setAnimationLoop(() => {
    for (const cb of callbacks) cb();
    controls.update();
    renderer.render(scene, camera);
  });

  const loader = new GLTFLoader();
  const viewer = { scene, camera, renderer, model: null, bones: {}, restPose: new Map(), onFrame: (cb) => callbacks.push(cb) };

  /** Carga un GLB y sustituye al modelo actual. `aliases` traduce nombres canónicos a los del rig. */
  viewer.loadModel = async function (url, { aliases, onProgress } = {}) {
    const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    const model = gltf.scene;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    // Normaliza: altura 1.8 m, pies en el suelo, centrado en el origen
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(1.8 / size.y);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    // Huesos por nombre limpio: "mixamorig:LeftArm_09" -> "LeftArm", "arm2_l_016" -> "arm2_l"
    const raw = {};
    model.traverse((o) => {
      if (o.isBone) raw[o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')] = o;
    });
    console.groupCollapsed(`Huesos de ${url} (${Object.keys(raw).length})`);
    console.table(Object.entries(raw).map(([short, b]) => ({ nombre: short, original: b.name, padre: b.parent?.name })));
    console.groupEnd();
    const bones = aliases
      ? Object.fromEntries(Object.entries(aliases).filter(([, v]) => raw[v]).map(([k, v]) => [k, raw[v]]))
      : raw;

    // Retira y libera el modelo anterior
    if (viewer.model) {
      scene.remove(viewer.model);
      viewer.model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
    }
    scene.add(model);

    // Pose de reposo de cada hueso (pose A en Mixamo) para volver a ella y calcular rotaciones relativas
    Object.assign(viewer, { model, bones, restPose: new Map(Object.values(bones).map((b) => [b, b.quaternion.clone()])) });
    return viewer;
  };

  return viewer;
}

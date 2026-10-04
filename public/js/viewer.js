import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function createViewer(canvas, { url, onProgress }) {
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

  const gltf = await new GLTFLoader().loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
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
  scene.add(model);

  // Huesos por nombre limpio: "mixamorig:LeftArm_09" -> "LeftArm"
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')] = o;
  });
  console.groupCollapsed(`Huesos del modelo (${Object.keys(bones).length})`);
  console.table(Object.entries(bones).map(([short, b]) => ({ nombre: short, original: b.name, padre: b.parent?.name })));
  console.groupEnd();

  // Guarda la pose de reposo (pose A) para poder volver a ella y calcular rotaciones relativas
  const restPose = new Map(Object.values(bones).map((b) => [b, b.quaternion.clone()]));

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

  return { scene, camera, renderer, model, bones, restPose, onFrame: (cb) => callbacks.push(cb) };
}

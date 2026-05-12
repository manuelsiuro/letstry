import * as THREE from "three";

export function startThreeScene(mount: HTMLElement): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(
    60,
    mount.clientWidth / mount.clientHeight,
    0.1,
    100,
  );
  camera.position.set(2, 2, 4);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  mount.appendChild(renderer.domElement);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.4 }),
  );
  scene.add(cube);

  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 5, 2);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x404060, 1));

  const onResize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    cube.rotation.x += dt * 0.6;
    cube.rotation.y += dt * 0.9;
    renderer.render(scene, camera);
  });
}

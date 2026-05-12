import * as THREE from "three";
import { subscribe, type GameState, type Phase } from "../game/state";
import { advance } from "../game/loop";

export interface ThreeScene {
  canvas: HTMLCanvasElement;
}

export function startThreeScene(mount: HTMLElement): ThreeScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 12, 40);
  scene.background = new THREE.Color(0x0a0e1a);

  const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  mount.appendChild(renderer.domElement);

  // ---- Lights ----
  const key = new THREE.DirectionalLight(0xffe7b8, 1.6);
  key.position.set(4, 6, 3);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x404060, 0.9));
  const neonGlow = new THREE.PointLight(0xff3b88, 1.2, 8);
  neonGlow.position.set(0, 2.2, 0.4);
  scene.add(neonGlow);

  // ---- Shop layer ----
  const shopLayer = new THREE.Group();
  scene.add(shopLayer);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  shopLayer.add(ground);

  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xe04848, roughness: 0.4 }),
  );
  counter.position.set(0, 0, 0);
  shopLayer.add(counter);

  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 0.08, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.6 }),
  );
  counterTop.position.set(0, 0.55, 0);
  shopLayer.add(counterTop);

  const ovens: THREE.Mesh[] = [];
  function makeOven(x: number): THREE.Mesh {
    const oven = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.7, emissive: 0xff5500, emissiveIntensity: 0.4 }),
    );
    oven.position.set(x, 0, -1.2);
    return oven;
  }
  const oven1 = makeOven(-1);
  shopLayer.add(oven1);
  ovens.push(oven1);

  // Neon sign (canvas texture)
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 128;
  const sctx = signCanvas.getContext("2d")!;
  sctx.fillStyle = "#0a0e1a";
  sctx.fillRect(0, 0, 512, 128);
  sctx.font = "bold 96px sans-serif";
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.shadowColor = "#ff3b88";
  sctx.shadowBlur = 40;
  sctx.fillStyle = "#ffaad4";
  sctx.fillText("PIZZA", 256, 64);
  sctx.shadowBlur = 0;
  sctx.strokeStyle = "#ff3b88";
  sctx.lineWidth = 3;
  sctx.strokeText("PIZZA", 256, 64);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.8),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
  );
  sign.position.set(0, 2.2, 0.62);
  shopLayer.add(sign);

  // Pizza disc on counter
  const pizza = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
    new THREE.MeshStandardMaterial({ color: 0xf2c46d, roughness: 0.5, emissive: 0x331100, emissiveIntensity: 0.15 }),
  );
  pizza.position.set(0, 0.62, 0);
  shopLayer.add(pizza);

  // ---- Kitchen decor ----
  // Shared materials (reuse where colors repeat)
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xe8b89a, roughness: 0.7 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.6 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.8 });
  const matRed = new THREE.MeshStandardMaterial({ color: 0xe04848, roughness: 0.5 });
  const matCream = new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.6 });
  const matBasil = new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 0.8 });
  const matCheese = new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.5, emissive: 0x664400, emissiveIntensity: 0.1 });
  const matOlive = new THREE.MeshStandardMaterial({ color: 0x6b8e3d, roughness: 0.5 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xd4a04a, roughness: 0.4 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });

  // Pizza toppings group (parented to pizza so it spins with it)
  const toppings = new THREE.Group();
  pizza.add(toppings);
  const pepGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10);
  const pepperoniPositions = [
    [0.18, 0, 0.0], [-0.2, 0, 0.05], [0.05, 0, 0.22],
    [-0.08, 0, -0.2], [0.22, 0, -0.18], [-0.22, 0, -0.05],
  ];
  for (const [x, , z] of pepperoniPositions) {
    const p = new THREE.Mesh(pepGeo, matRed);
    p.position.set(x, 0.04, z);
    toppings.add(p);
  }
  const basilGeo = new THREE.BoxGeometry(0.07, 0.005, 0.05);
  const basilPositions = [
    [0.0, 0, 0.08], [-0.12, 0, 0.18], [0.15, 0, -0.08], [-0.05, 0, -0.15],
  ];
  for (const [x, , z] of basilPositions) {
    const b = new THREE.Mesh(basilGeo, matBasil);
    b.position.set(x, 0.045, z);
    b.rotation.y = Math.random() * Math.PI;
    toppings.add(b);
  }
  const cheeseGeo = new THREE.BoxGeometry(0.04, 0.015, 0.04);
  const cheesePositions = [
    [0.1, 0, 0.12], [-0.15, 0, -0.1], [0.08, 0, -0.05],
    [-0.02, 0, 0.0], [0.25, 0, 0.08],
  ];
  for (const [x, , z] of cheesePositions) {
    const c = new THREE.Mesh(cheeseGeo, matCheese);
    c.position.set(x, 0.04, z);
    toppings.add(c);
  }

  // Chef factory — low-poly humanoid
  // Shared geometries (built once, pivot-translated for shoulder rotation)
  const chefTorsoGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.7, 12);
  const chefHeadGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const chefToqueBaseGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10);
  const chefToqueCapGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.18, 10);
  const chefArmGeo = new THREE.BoxGeometry(0.1, 0.35, 0.1);
  chefArmGeo.translate(0, -0.175, 0); // pivot at shoulder (top of arm)

  type Chef = { group: THREE.Group; armL: THREE.Mesh; armR: THREE.Mesh; phase: number };
  const chefs: Chef[] = [];
  function makeChef(x: number, phase: number): Chef {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(chefTorsoGeo, matWhite);
    torso.position.y = 0.35;
    g.add(torso);
    const head = new THREE.Mesh(chefHeadGeo, matSkin);
    head.position.y = 0.85;
    g.add(head);
    const toqueBase = new THREE.Mesh(chefToqueBaseGeo, matWhite);
    toqueBase.position.y = 1.0;
    g.add(toqueBase);
    const toqueCap = new THREE.Mesh(chefToqueCapGeo, matWhite);
    toqueCap.position.y = 1.13;
    g.add(toqueCap);
    const armL = new THREE.Mesh(chefArmGeo, matWhite);
    armL.position.set(-0.26, 0.6, 0.05);
    g.add(armL);
    const armR = new THREE.Mesh(chefArmGeo, matWhite);
    armR.position.set(0.26, 0.6, 0.05);
    g.add(armR);
    g.position.set(x, 0.05, -0.85);
    shopLayer.add(g);
    return { group: g, armL, armR, phase };
  }
  chefs.push(makeChef(0, 0));

  // Back wall + shelves
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.8, 0.1), matCream);
  backWall.position.set(0, 0.9, -2.1);
  shopLayer.add(backWall);

  const shelfGeo = new THREE.BoxGeometry(3.4, 0.05, 0.25);
  const shelfTop = new THREE.Mesh(shelfGeo, matWood);
  shelfTop.position.set(0, 1.55, -1.95);
  shopLayer.add(shelfTop);
  const shelfMid = new THREE.Mesh(shelfGeo, matWood);
  shelfMid.position.set(0, 1.05, -1.95);
  shopLayer.add(shelfMid);

  // Jars on top shelf
  const jarGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10);
  const capGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.04, 10);
  const jarSpecs: Array<[number, THREE.MeshStandardMaterial]> = [
    [-1.2, matRed], [-0.8, matOlive], [-0.4, matGold], [0.0, matRed],
  ];
  for (const [x, capMat] of jarSpecs) {
    const jar = new THREE.Mesh(jarGeo, matCream);
    jar.position.set(x, 1.67, -1.95);
    shopLayer.add(jar);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, 1.78, -1.95);
    shopLayer.add(cap);
  }

  // Stack of pizza boxes on mid shelf
  const boxGeo = new THREE.BoxGeometry(0.5, 0.08, 0.5);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(boxGeo, i % 2 === 0 ? matRed : matCream);
    b.position.set(0.9, 1.12 + i * 0.085, -1.95);
    shopLayer.add(b);
  }

  // Hanging string of garlic/salami
  const garlicGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const salamiMat = matRed;
  for (let i = 0; i < 4; i++) {
    const bulb = new THREE.Mesh(garlicGeo, i % 2 === 0 ? matCream : salamiMat);
    bulb.position.set(1.55, 1.45 - i * 0.14, -1.95);
    bulb.scale.y = 1.1;
    shopLayer.add(bulb);
  }

  // Chimney/exhaust hood above ovens (raised so it doesn't clip the chef)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.5), matDark);
  hood.position.set(0, 1.65, -1.55);
  shopLayer.add(hood);
  const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), matDark);
  flue.position.set(0, 2.0, -1.7);
  shopLayer.add(flue);

  // ---- Upgrade-driven props ----
  // Shared geometries (one per prop type, reused across instances)
  const doughGeo = new THREE.SphereGeometry(0.12, 12, 8);
  const cheeseWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16);
  const flameGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const smokeGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const armGeo = new THREE.BoxGeometry(0.18, 0.08, 0.18);
  const starSphereGeo = new THREE.SphereGeometry(0.07, 8, 6);

  // dough ball — hovers in front of chef, visible when `dough` owned
  const doughBall = new THREE.Mesh(doughGeo, matCream);
  doughBall.position.set(0, 1.2, 0.35);
  doughBall.visible = false;
  shopLayer.add(doughBall);

  // cheese wheel — sits on top shelf, visible when `cheese` owned
  const cheeseWheel = new THREE.Mesh(cheeseWheelGeo, matCheese);
  cheeseWheel.position.set(-1.3, 1.55 + 0.05 + 0.025, -2.0); // shelf top + half-height
  cheeseWheel.visible = false;
  shopLayer.add(cheeseWheel);

  // second pizza disc — visible when `kitchen` owned; sits next to existing one
  const pizza2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
    new THREE.MeshStandardMaterial({ color: 0xf2c46d, roughness: 0.5, emissive: 0x331100, emissiveIntensity: 0.15 }),
  );
  pizza2.position.set(0.95, 0.62, 0);
  pizza2.visible = false;
  shopLayer.add(pizza2);

  // marketing star fountain — 8 orbiting stars above the sign
  const marketingGroup = new THREE.Group();
  marketingGroup.position.set(0, 3.0, 0.3);
  marketingGroup.rotation.x = -0.35; // tilted ring
  marketingGroup.visible = false;
  shopLayer.add(marketingGroup);
  const starMat = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffaa22, emissiveIntensity: 0.9, roughness: 0.4 });
  const marketingStars: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(starSphereGeo, starMat);
    s.userData.phase = (i / 8) * Math.PI * 2;
    marketingGroup.add(s);
    marketingStars.push(s);
  }

  // Per-oven dynamic props (flame, smoke, bot-arm) — maintained alongside `ovens[]`
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7722, emissive: 0xff4400, emissiveIntensity: 1.2, roughness: 0.3 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true, opacity: 0.5, roughness: 1 });
  const botArmMat = new THREE.MeshStandardMaterial({ color: 0x444a55, emissive: 0x4cc9f0, emissiveIntensity: 0.4, roughness: 0.5 });

  type SmokePuff = { mesh: THREE.Mesh; offset: number };
  type OvenProps = { flame: THREE.Mesh; smoke: SmokePuff[]; arm: THREE.Mesh };
  const ovenProps: OvenProps[] = [];
  function makeOvenProps(oven: THREE.Mesh): OvenProps {
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(oven.position.x, oven.position.y + 0.05, oven.position.z + 0.35);
    flame.visible = false;
    shopLayer.add(flame);
    const smoke: SmokePuff[] = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
      s.position.set(oven.position.x, 1.0, oven.position.z);
      s.visible = false;
      shopLayer.add(s);
      smoke.push({ mesh: s, offset: i / 3 });
    }
    const arm = new THREE.Mesh(armGeo, botArmMat);
    arm.position.set(oven.position.x, 1.75, oven.position.z + 0.2);
    arm.visible = false;
    shopLayer.add(arm);
    return { flame, smoke, arm };
  }
  function disposeOvenProps(p: OvenProps): void {
    shopLayer.remove(p.flame);
    for (const puff of p.smoke) {
      shopLayer.remove(puff.mesh);
      (puff.mesh.material as THREE.Material).dispose();
    }
    shopLayer.remove(p.arm);
  }

  // ---- Local layer (bikes orbiting) ----
  const localLayer = new THREE.Group();
  scene.add(localLayer);
  const bikes: THREE.Mesh[] = [];
  function spawnBike(): void {
    const bike = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.25, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x224488, emissiveIntensity: 0.3 }),
    );
    localLayer.add(bike);
    bikes.push(bike);
  }

  // ---- Cosmic layer (Earth + planets + drones) ----
  const cosmicLayer = new THREE.Group();
  cosmicLayer.visible = false;
  scene.add(cosmicLayer);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.7, emissive: 0x113355, emissiveIntensity: 0.25 }),
  );
  earth.position.set(0, 0.4, 0);
  cosmicLayer.add(earth);

  const planets: THREE.Mesh[] = [];
  function makePlanet(color: number, radius: number, distance: number, speed: number): THREE.Mesh {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.15 }),
    );
    p.userData.distance = distance;
    p.userData.speed = speed;
    p.userData.angle = Math.random() * Math.PI * 2;
    cosmicLayer.add(p);
    planets.push(p);
    return p;
  }
  makePlanet(0xd95a3a, 0.5, 4.2, 0.25); // Mars
  makePlanet(0xe5c16f, 0.7, 6.0, 0.18); // Venus-ish
  makePlanet(0xa37bdc, 0.9, 8.5, 0.12); // Jupiter

  // starfield
  const starGeo = new THREE.BufferGeometry();
  const starCount = 700;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.9 }),
  );
  cosmicLayer.add(stars);

  const drones: THREE.Mesh[] = [];
  function spawnDrone(): void {
    const d = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xffe7b8, emissive: 0xffaa44, emissiveIntensity: 0.7 }),
    );
    d.userData.angle = Math.random() * Math.PI * 2;
    d.userData.radius = 1.8 + Math.random() * 1.2;
    d.userData.speed = 0.6 + Math.random() * 0.5;
    d.userData.tilt = Math.random() * 0.6 - 0.3;
    cosmicLayer.add(d);
    drones.push(d);
  }

  // ---- Final layer (pizza-sun) ----
  const finalLayer = new THREE.Group();
  finalLayer.visible = false;
  scene.add(finalLayer);
  const pizzaSun = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.4, 48),
    new THREE.MeshStandardMaterial({ color: 0xffaa44, emissive: 0xff5522, emissiveIntensity: 1.4, roughness: 0.6 }),
  );
  pizzaSun.rotation.x = Math.PI / 2;
  finalLayer.add(pizzaSun);
  const sunGlow = new THREE.PointLight(0xff8844, 3, 30);
  finalLayer.add(sunGlow);
  const finalStars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.9 }),
  );
  finalLayer.add(finalStars);

  // ---- Camera positions per phase ----
  const camTargets: Record<Phase, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
    shop:    { pos: new THREE.Vector3(0, 1.6, 4.2), look: new THREE.Vector3(0, 0.8, 0) },
    local:   { pos: new THREE.Vector3(2.4, 2.4, 5.2), look: new THREE.Vector3(0, 0.8, 0) },
    cosmic:  { pos: new THREE.Vector3(0, 3, 11),    look: new THREE.Vector3(0, 0, 0) },
    final:   { pos: new THREE.Vector3(0, 0, 7),     look: new THREE.Vector3(0, 0, 0) },
    credits: { pos: new THREE.Vector3(0, 0, 5),     look: new THREE.Vector3(0, 0, 0) },
  };

  let currentPhase: Phase = "shop";
  const camPos = camTargets.shop.pos.clone();
  const camLook = camTargets.shop.look.clone();
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  let prevPhase: Phase = "shop";
  let prevBikeCount = 0;
  let prevDroneCount = 0;

  function applyState(s: GameState): void {
    currentPhase = s.phase;

    // bikes scale with sellPerSec
    const desiredBikes = s.upgradesOwned.bike ? Math.min(6, Math.max(1, Math.round(s.sellPerSec / 2))) : 0;
    while (bikes.length < desiredBikes) spawnBike();
    while (bikes.length > desiredBikes) {
      const b = bikes.pop()!;
      localLayer.remove(b);
      b.geometry.dispose();
    }

    // second chef if kitchen upgrade
    const desiredChefs = 1 + (s.upgradesOwned.kitchen ? 1 : 0);
    while (chefs.length < desiredChefs) {
      chefs.push(makeChef(1.1, Math.PI));
    }
    while (chefs.length > desiredChefs) {
      const c = chefs.pop()!;
      shopLayer.remove(c.group);
    }

    // toppings lift slightly with cheese/dough upgrades (cosmetic)
    const lift = (s.upgradesOwned.cheese ? 0.015 : 0) + (s.upgradesOwned.dough ? 0.01 : 0);
    toppings.position.y = lift;

    // extra ovens
    const desiredOvens = 1 + (s.upgradesOwned.kitchen ? 1 : 0) + (s.upgradesOwned.bots ? 2 : 0);
    while (ovens.length < desiredOvens) {
      const x = (ovens.length - 1.5) * 1.1;
      const o = makeOven(x);
      shopLayer.add(o);
      ovens.push(o);
      ovenProps.push(makeOvenProps(o));
    }
    while (ovens.length > desiredOvens) {
      const o = ovens.pop()!;
      shopLayer.remove(o);
      o.geometry.dispose();
      const p = ovenProps.pop()!;
      disposeOvenProps(p);
    }

    // Per-oven prop visibility based on upgrades
    const showFlames = !!s.upgradesOwned.oven;
    const showArms = !!s.upgradesOwned.bots;
    for (const p of ovenProps) {
      p.flame.visible = showFlames;
      for (const puff of p.smoke) puff.mesh.visible = showFlames;
      p.arm.visible = showArms;
    }

    // Simple upgrade-bound prop visibility
    doughBall.visible = !!s.upgradesOwned.dough;
    cheeseWheel.visible = !!s.upgradesOwned.cheese;
    pizza2.visible = !!s.upgradesOwned.kitchen;
    marketingGroup.visible = !!s.upgradesOwned.marketing;

    // drones once cosmic
    const desiredDrones = s.upgradesOwned.drones ? 8 : s.upgradesOwned.cosmic ? 3 : 0;
    while (drones.length < desiredDrones) spawnDrone();
    while (drones.length > desiredDrones) {
      const d = drones.pop()!;
      cosmicLayer.remove(d);
      d.geometry.dispose();
    }

    // phase visibility
    shopLayer.visible = s.phase === "shop" || s.phase === "local";
    localLayer.visible = s.phase === "shop" || s.phase === "local";
    cosmicLayer.visible = s.phase === "cosmic";
    finalLayer.visible = s.phase === "final" || s.phase === "credits";

    if (s.phase !== prevPhase) {
      prevPhase = s.phase;
    }

    if (bikes.length !== prevBikeCount) prevBikeCount = bikes.length;
    if (drones.length !== prevDroneCount) prevDroneCount = drones.length;
  }

  // ---- Purchase pulse ----
  // For each buy event, look up the relevant Object3D(s) and animate a scale pop.
  const PULSE_DURATION = 0.6;
  type Pulse = { targets: THREE.Object3D[]; startedAt: number };
  const pulses: Pulse[] = [];

  function pulseTargetsFor(upgradeId: string): THREE.Object3D[] {
    switch (upgradeId) {
      case "dough":     return [doughBall];
      case "cheese":    return [cheeseWheel];
      case "oven":      return ovenProps.map((p) => p.flame);
      case "bike":      return bikes.length > 0 ? [bikes[bikes.length - 1]] : [];
      case "kitchen":   return [pizza2, ...(chefs.length > 1 ? [chefs[chefs.length - 1].group] : [])];
      case "marketing": return [marketingGroup];
      case "bots":      return ovenProps.map((p) => p.arm);
      case "drones":    return drones.length > 0 ? [drones[drones.length - 1]] : [];
      default:          return [];
    }
  }

  subscribe((s, ev) => {
    applyState(s);
    if (ev && ev.type === "buy" && ev.upgradeId) {
      const targets = pulseTargetsFor(ev.upgradeId);
      if (targets.length > 0) {
        pulses.push({ targets, startedAt: elapsed });
      }
    }
  });

  // ---- Resize ----
  const onResize = (): void => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  // ---- Animation loop ----
  const clock = new THREE.Clock();
  let elapsed = 0;
  const tmpLook = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    elapsed += dt;
    advance(dt);

    // camera ease to current phase
    const target = camTargets[currentPhase];
    camPos.lerp(target.pos, Math.min(1, dt * 1.2));
    camLook.lerp(target.look, Math.min(1, dt * 1.2));
    // gentle drift
    const drift = currentPhase === "credits" ? 0.0 : 0.05;
    camera.position.copy(camPos);
    camera.position.x += Math.sin(elapsed * 0.4) * drift;
    camera.position.y += Math.cos(elapsed * 0.3) * drift * 0.5;
    tmpLook.copy(camLook);
    camera.lookAt(tmpLook);

    // Pizza spin
    pizza.rotation.y = elapsed * 0.4;
    pizza2.rotation.y = -elapsed * 0.4;
    // Oven flicker
    for (const o of ovens) {
      const mat = o.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.35 + Math.sin(elapsed * 6 + o.position.x) * 0.1;
    }

    // ---- Upgrade-driven prop animations ----
    // Dough ball: spin + bob
    if (doughBall.visible) {
      doughBall.rotation.y = elapsed * 1.5;
      doughBall.position.y = 1.2 + Math.sin(elapsed * 2) * 0.06;
    }
    // Cheese wheel: slow spin
    if (cheeseWheel.visible) {
      cheeseWheel.rotation.y = elapsed * 0.5;
    }
    // Oven flame + smoke (visibility already set by applyState)
    for (const p of ovenProps) {
      if (p.flame.visible) {
        const flMat = p.flame.material as THREE.MeshStandardMaterial;
        flMat.emissiveIntensity = 1.2 + Math.sin(elapsed * 8 + p.flame.position.x) * 0.4;
        p.flame.scale.y = 1 + Math.sin(elapsed * 12 + p.flame.position.x) * 0.15;
      }
      for (const puff of p.smoke) {
        if (!puff.mesh.visible) continue;
        const t = ((elapsed * 0.5 + puff.offset) % 1);
        puff.mesh.position.y = 1.0 + t * 1.0;
        const m = puff.mesh.material as THREE.MeshStandardMaterial;
        m.opacity = (1 - t) * 0.5;
      }
      if (p.arm.visible) {
        p.arm.position.y = 1.75 + Math.sin(elapsed * 4 + p.arm.position.x * 3) * 0.12;
        p.arm.rotation.y = Math.sin(elapsed * 3 + p.arm.position.x) * 0.5;
      }
    }
    // Marketing star fountain
    if (marketingGroup.visible) {
      for (const s of marketingStars) {
        const a = elapsed * 0.8 + (s.userData.phase as number);
        s.position.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6);
        const pop = 1 + Math.sin(elapsed * 3 + (s.userData.phase as number)) * 0.1;
        s.scale.setScalar(pop);
      }
      marketingGroup.position.z = 0.3 + Math.sin(elapsed * 0.6) * 0.1;
    }

    // ---- Purchase pulse tick ----
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pl = pulses[i];
      const t = (elapsed - pl.startedAt) / PULSE_DURATION;
      if (t >= 1) {
        for (const target of pl.targets) target.scale.setScalar(1);
        pulses.splice(i, 1);
        continue;
      }
      // ease 1 -> 1.4 -> 1 (triangular peak at t=0.5)
      const k = t < 0.5 ? t * 2 : (1 - t) * 2;
      const scale = 1 + 0.4 * k;
      for (const target of pl.targets) target.scale.setScalar(scale);
    }
    // Neon pulse
    neonGlow.intensity = 1.0 + Math.sin(elapsed * 3) * 0.4;

    // Kitchen decor animations — chef bob + kneading arms
    for (let i = 0; i < chefs.length; i++) {
      const c = chefs[i];
      const t = elapsed * 2 + c.phase;
      c.group.position.y = 0.05 + Math.sin(t) * 0.03;
      c.armL.rotation.x = Math.sin(t * 1.5) * 0.6 - 0.4;
      c.armR.rotation.x = Math.sin(t * 1.5 + Math.PI) * 0.6 - 0.4;
    }

    // Bikes orbit the counter
    for (let i = 0; i < bikes.length; i++) {
      const b = bikes[i];
      const angle = elapsed * 0.9 + (i * (Math.PI * 2)) / bikes.length;
      const r = 2.2 + (i % 2) * 0.4;
      b.position.set(Math.cos(angle) * r, 0.2, Math.sin(angle) * r + 0.3);
      b.rotation.y = -angle + Math.PI / 2;
    }

    // Cosmic
    if (cosmicLayer.visible) {
      earth.rotation.y = elapsed * 0.15;
      stars.rotation.y = elapsed * 0.005;
      for (const p of planets) {
        p.userData.angle += dt * p.userData.speed;
        const a = p.userData.angle;
        const dist = p.userData.distance;
        p.position.set(Math.cos(a) * dist, Math.sin(a * 0.4) * 0.4, Math.sin(a) * dist);
        p.rotation.y += dt * 0.4;
      }
      for (const d of drones) {
        d.userData.angle += dt * d.userData.speed;
        const a = d.userData.angle;
        const r = d.userData.radius;
        const tilt = d.userData.tilt;
        d.position.set(Math.cos(a) * r, tilt + Math.sin(a * 2) * 0.2, Math.sin(a) * r);
        d.rotation.y = -a + Math.PI / 2;
      }
    }

    // Final pizza-sun
    if (finalLayer.visible) {
      pizzaSun.rotation.z = elapsed * 0.2;
      sunGlow.intensity = 3 + Math.sin(elapsed * 2) * 0.6;
    }

    renderer.render(scene, camera);
  });

  return { canvas: renderer.domElement };
}

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { subscribe, type GameState, type Phase } from "../game/state";
import { advance } from "../game/loop";

export interface ThreeScene {
  canvas: HTMLCanvasElement;
}

const FX_ON = new URLSearchParams(window.location.search).get("fx") !== "off";

export function startThreeScene(mount: HTMLElement): ThreeScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 12, 40);
  scene.background = new THREE.Color(0x0a0e1a);

  const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  mount.appendChild(renderer.domElement);

  // ---- Post-processing (gated by ?fx) ----
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (FX_ON) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(mount.clientWidth, mount.clientHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      0.55, // strength
      0.75, // radius
      0.7,  // threshold
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  // ---- Optional asset preload (HDRI + GLBs). HEAD-probe first so missing
  // files don't make the dev server return index.html and crash the loaders.
  async function fileExists(url: string): Promise<boolean> {
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (!r.ok) return false;
      const ct = r.headers.get("content-type") ?? "";
      // Vite's SPA fallback serves text/html for missing assets — reject that.
      return !ct.includes("text/html");
    } catch {
      return false;
    }
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const models: Record<string, THREE.Group> = {};

  (async () => {
    const hdrUrl = "/assets/env/studio.hdr";
    if (await fileExists(hdrUrl)) {
      new RGBELoader().load(
        hdrUrl,
        (tex) => {
          try {
            const env = pmrem.fromEquirectangular(tex).texture;
            scene.environment = env;
            tex.dispose();
          } catch {
            // ignore — environment is optional
          }
        },
        undefined,
        () => { /* ignore */ },
      );
    }

    const modelSlots: Array<[string, string]> = [
      ["pizza", "/assets/models/pizza.glb"],
      ["oven", "/assets/models/oven.glb"],
      ["bike", "/assets/models/bike.glb"],
      ["drone", "/assets/models/drone.glb"],
      ["planet", "/assets/models/planet.glb"],
      ["wormhole", "/assets/models/wormhole.glb"],
    ];
    const present = await Promise.all(modelSlots.map(([, u]) => fileExists(u)));
    if (present.some(Boolean)) {
      const draco = new DRACOLoader();
      draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
      const gltf = new GLTFLoader();
      gltf.setDRACOLoader(draco);
      for (let i = 0; i < modelSlots.length; i++) {
        if (!present[i]) continue;
        const [name, url] = modelSlots[i];
        gltf.load(
          url,
          (g) => {
            models[name] = g.scene;
            const pending = swapQueue[name];
            if (pending) {
              for (const cb of pending) cb(g.scene.clone(true));
              delete swapQueue[name];
            }
          },
          undefined,
          () => { /* ignore */ },
        );
      }
    }
  })();

  // GLB swap mechanism: register a callback that fires with a fresh clone once
  // the named model has loaded (or immediately if it's already in memory).
  const swapQueue: Record<string, ((clone: THREE.Group) => void)[]> = {};
  function onModelReady(name: string, cb: (clone: THREE.Group) => void): void {
    if (models[name]) cb(models[name].clone(true));
    else (swapQueue[name] ??= []).push(cb);
  }

  // ---- Lights ----
  // Warm key from camera-right, cool fill from camera-left, soft ambient so
  // the kitchen reads volumetrically instead of flat-shaded.
  const key = new THREE.DirectionalLight(0xffe7b8, 1.7);
  key.position.set(4, 6, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8ca8d8, 0.6);
  fill.position.set(-5, 3, 2);
  scene.add(fill);
  // Rim from behind the counter — picks out chef silhouette + oven edges.
  const rim = new THREE.DirectionalLight(0xff7a4a, 0.9);
  rim.position.set(0, 3, -4);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x404060, 0.55));
  // Neon sign glow — pulses with the sign canvas.
  const neonGlow = new THREE.PointLight(0xff3b88, 1.4, 8);
  neonGlow.position.set(0, 2.2, 0.4);
  scene.add(neonGlow);
  // Warm point inside the kitchen — sells the "lit oven" feeling.
  const kitchenGlow = new THREE.PointLight(0xff7733, 1.6, 6, 1.5);
  kitchenGlow.position.set(0, 0.4, -1.0);
  scene.add(kitchenGlow);

  // ---- Shop layer ----
  // Ground level — every shop prop is anchored to this so a future tweak
  // moves everything together.
  const GROUND_Y = -0.5;

  const shopLayer = new THREE.Group();
  scene.add(shopLayer);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  shopLayer.add(ground);

  // Counter: shorter than before so the chef behind it remains visible from
  // the front camera. Spans y = GROUND_Y .. GROUND_Y + 0.85 (top at -0.05),
  // with the counter top slab at y = -0.05 + 0.04 = -0.01 (rounded to 0).
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.85, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xe04848, roughness: 0.4 }),
  );
  counter.position.set(0, GROUND_Y + 0.425, 0);
  shopLayer.add(counter);

  const counterTopY = GROUND_Y + 0.85 + 0.04; // 0.39
  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.08, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.6 }),
  );
  counterTop.position.set(0, counterTopY, 0);
  shopLayer.add(counterTop);

  const ovens: THREE.Group[] = [];
  // oven.glb is 1.95m tall with its pivot at the BASE (Y=0). At scale 0.65
  // an oven is 1.27m tall, so its top reaches y = GROUND_Y + 1.27 ≈ 0.77 —
  // safely above the counter top (y=0.55) so it's actually visible.
  const OVEN_SCALE = 0.65;
  function makeOven(x: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, GROUND_Y, -1.35);
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.7, emissive: 0xff5500, emissiveIntensity: 0.4 }),
    );
    placeholder.position.y = 0.6;
    g.add(placeholder);
    onModelReady("oven", (clone) => {
      g.remove(placeholder);
      placeholder.geometry.dispose();
      (placeholder.material as THREE.Material).dispose();
      clone.scale.setScalar(OVEN_SCALE);
      g.add(clone);
    });
    return g;
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

  // Pizza disc on counter — placeholder until pizza.glb loads
  const pizza = new THREE.Group();
  pizza.position.set(0, counterTopY + 0.03, 0);
  shopLayer.add(pizza);
  const pizzaPlaceholder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
    new THREE.MeshStandardMaterial({ color: 0xf2c46d, roughness: 0.5, emissive: 0x331100, emissiveIntensity: 0.15 }),
  );
  pizza.add(pizzaPlaceholder);
  onModelReady("pizza", (clone) => {
    pizza.remove(pizzaPlaceholder);
    pizzaPlaceholder.geometry.dispose();
    clone.scale.setScalar(0.45);
    pizza.add(clone);
  });

  // ---- Kitchen decor ----
  // Shared materials (reuse where colors repeat)
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xe8b89a, roughness: 0.7 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.6 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.8 });
  const matRed = new THREE.MeshStandardMaterial({ color: 0xe04848, roughness: 0.5 });
  const matCream = new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.6 });
  const matCheese = new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.5, emissive: 0x664400, emissiveIntensity: 0.1 });
  const matOlive = new THREE.MeshStandardMaterial({ color: 0x6b8e3d, roughness: 0.5 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xd4a04a, roughness: 0.4 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });

  // (Toppings are baked into pizza.glb — no inline mesh needed.)

  // Chef factory — low-poly humanoid. Local origin = feet on floor (y=0 in
  // group-space). Group is placed at y=GROUND_Y so the chef stands on the
  // floor instead of floating inside the counter.
  const chefLegGeo = new THREE.BoxGeometry(0.13, 0.5, 0.13);
  chefLegGeo.translate(0, 0.25, 0); // pivot at hip top → leg hangs below it
  const chefTorsoGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.7, 12);
  const chefHeadGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const chefToqueBaseGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10);
  const chefToqueCapGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.18, 10);
  const chefArmGeo = new THREE.BoxGeometry(0.1, 0.35, 0.1);
  chefArmGeo.translate(0, -0.175, 0); // pivot at shoulder (top of arm)

  const matChefPants = new THREE.MeshStandardMaterial({ color: 0x37404a, roughness: 0.8 });

  type Chef = { group: THREE.Group; armL: THREE.Mesh; armR: THREE.Mesh; phase: number };
  const chefs: Chef[] = [];
  function makeChef(x: number, phase: number): Chef {
    const g = new THREE.Group();
    // Legs — geometry already translated up by 0.25 so it spans local [0, 0.5]
    // from origin; mesh position is the bottom of the leg (feet on the floor).
    const legL = new THREE.Mesh(chefLegGeo, matChefPants);
    legL.position.set(-0.1, 0, 0);
    g.add(legL);
    const legR = new THREE.Mesh(chefLegGeo, matChefPants);
    legR.position.set(0.1, 0, 0);
    g.add(legR);
    // Torso (cylinder center y=0.85 → spans 0.5..1.2)
    const torso = new THREE.Mesh(chefTorsoGeo, matWhite);
    torso.position.y = 0.85;
    g.add(torso);
    // Head & toque
    const head = new THREE.Mesh(chefHeadGeo, matSkin);
    head.position.y = 1.35;
    g.add(head);
    const toqueBase = new THREE.Mesh(chefToqueBaseGeo, matWhite);
    toqueBase.position.y = 1.5;
    g.add(toqueBase);
    const toqueCap = new THREE.Mesh(chefToqueCapGeo, matWhite);
    toqueCap.position.y = 1.63;
    g.add(toqueCap);
    // Arms — pivot at shoulder
    const armL = new THREE.Mesh(chefArmGeo, matWhite);
    armL.position.set(-0.26, 1.1, 0.05);
    g.add(armL);
    const armR = new THREE.Mesh(chefArmGeo, matWhite);
    armR.position.set(0.26, 1.1, 0.05);
    g.add(armR);
    g.position.set(x, GROUND_Y, -0.85);
    shopLayer.add(g);
    return { group: g, armL, armR, phase };
  }
  chefs.push(makeChef(0, 0));

  // Back wall + shelves — wall reaches the floor so no gap shows.
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.0, 0.1), matCream);
  backWall.position.set(0, 1.0, -2.1);
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

  // (No separate hood: the oven.glb has its own chimney baked in.)

  // ---- Upgrade-driven props ----
  // Shared geometries (one per prop type, reused across instances)
  const doughGeo = new THREE.SphereGeometry(0.12, 12, 8);
  const cheeseWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16);
  const flameGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const smokeGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const marketingStarGeo = new THREE.OctahedronGeometry(0.1, 0);

  // Robot-arm shared geometries (reused across all oven arms). Sized large
  // enough to read clearly at camera distance — these are visible upgrades,
  // they need to "show off" the automation.
  const armMountGeo = new THREE.BoxGeometry(0.18, 0.06, 0.18);
  const armShoulderGeo = new THREE.SphereGeometry(0.07, 12, 10);
  const armUpperGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.3, 10);
  const armElbowGeo = new THREE.SphereGeometry(0.07, 12, 10);
  const armForearmGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.26, 10);
  const armWristGeo = new THREE.SphereGeometry(0.04, 10, 8);
  const armPincerGeo = new THREE.BoxGeometry(0.035, 0.12, 0.025);
  // Pivot upper segment from its TOP so it hangs down from the shoulder.
  armUpperGeo.translate(0, -0.15, 0);
  // Pivot forearm from its TOP (elbow) so rotation pivots at the elbow.
  armForearmGeo.translate(0, -0.13, 0);
  // Pivot pincer bars at their TOP (wrist) so they hang.
  armPincerGeo.translate(0, -0.06, 0);

  // (Bike + drone geometry/materials live inside their GLBs.)

  // dough ball — hovers in front of chef, visible when `dough` owned
  const doughBall = new THREE.Mesh(doughGeo, matCream);
  const doughBaseY = counterTopY + 0.4; // hovers a bit above counter
  doughBall.position.set(-0.6, doughBaseY, 0.1);
  doughBall.visible = false;
  shopLayer.add(doughBall);

  // cheese wheel — sits on top shelf, visible when `cheese` owned
  const cheeseWheel = new THREE.Mesh(cheeseWheelGeo, matCheese);
  cheeseWheel.position.set(-1.3, 1.55 + 0.05 + 0.025, -2.0); // shelf top + half-height
  cheeseWheel.visible = false;
  shopLayer.add(cheeseWheel);

  // second pizza disc — visible when `kitchen` owned; sits next to existing one
  const pizza2 = new THREE.Group();
  pizza2.position.set(0.95, counterTopY + 0.03, 0);
  pizza2.visible = false;
  shopLayer.add(pizza2);
  onModelReady("pizza", (clone) => {
    clone.scale.setScalar(0.45);
    pizza2.add(clone);
  });

  // marketing star fountain — 8 orbiting stars above the sign
  const marketingGroup = new THREE.Group();
  marketingGroup.position.set(0, 3.0, 0.3);
  marketingGroup.rotation.x = -0.35; // tilted ring
  marketingGroup.visible = false;
  shopLayer.add(marketingGroup);
  const starMat = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffd54a, emissiveIntensity: 1.2, roughness: 0.4 });
  const marketingStars: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(marketingStarGeo, starMat);
    s.userData.phase = (i / 8) * Math.PI * 2;
    marketingGroup.add(s);
    marketingStars.push(s);
  }

  // Per-oven dynamic props (flame, smoke, bot-arm) — maintained alongside `ovens[]`
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7722, emissive: 0xff4400, emissiveIntensity: 1.2, roughness: 0.3 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true, opacity: 0.5, roughness: 1 });
  const botArmMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.3, metalness: 0.7 });
  const botArmJointMat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x4cc9f0, emissiveIntensity: 1.4, roughness: 0.3 });
  const botArmWristLEDMat = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0xff3366, emissiveIntensity: 1.6, roughness: 0.4 });

  type SmokePuff = { mesh: THREE.Mesh; offset: number };
  type OvenProps = { flame: THREE.Mesh; smoke: SmokePuff[]; arm: THREE.Group };
  const ovenProps: OvenProps[] = [];
  function makeOvenProps(oven: THREE.Group): OvenProps {
    // Oven top is at y = GROUND_Y + 1.27 ≈ 0.77 (oven height 1.95 * 0.65).
    // Flame sits in the door at ~25% of oven height.
    const ovenTopY = GROUND_Y + 1.95 * OVEN_SCALE;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(oven.position.x, GROUND_Y + 0.35, oven.position.z + 0.45);
    flame.visible = false;
    shopLayer.add(flame);
    const smoke: SmokePuff[] = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
      s.position.set(oven.position.x, ovenTopY, oven.position.z);
      s.userData.baseY = ovenTopY;
      s.visible = false;
      shopLayer.add(s);
      smoke.push({ mesh: s, offset: i / 3 });
    }
    const arm = makeRobotArm();
    // Mounted above the oven, reaching down to grab pizzas.
    arm.position.set(oven.position.x, ovenTopY + 0.55, oven.position.z + 0.3);
    arm.visible = false;
    shopLayer.add(arm);
    return { flame, smoke, arm };
  }
  function makeRobotArm(): THREE.Group {
    const g = new THREE.Group();
    // Ceiling mount plate at top of group (y=0 is the anchor / "ceiling")
    const mount = new THREE.Mesh(armMountGeo, matDark);
    mount.position.y = -0.03;
    g.add(mount);
    // Glowing shoulder pivot just below the mount
    const shoulder = new THREE.Mesh(armShoulderGeo, botArmJointMat);
    shoulder.position.y = -0.08;
    g.add(shoulder);
    // Upper segment hangs down from the shoulder (geo is pivot-at-top)
    const upper = new THREE.Mesh(armUpperGeo, botArmMat);
    upper.position.y = -0.08;
    g.add(upper);
    // Elbow joint at the bottom of the upper segment
    const elbowY = -0.08 - 0.3;
    const elbow = new THREE.Mesh(armElbowGeo, botArmJointMat);
    elbow.position.y = elbowY;
    g.add(elbow);
    // Forearm + wrist + pincers nested under an "elbow pivot" so the whole
    // lower arm rotates together when we animate the elbow flex.
    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = elbowY;
    g.add(elbowPivot);
    const angle = Math.PI / 5; // 36deg base flex
    elbowPivot.rotation.x = angle;

    // In elbowPivot's local frame the forearm hangs straight down from y=0.
    const forearm = new THREE.Mesh(armForearmGeo, botArmMat);
    elbowPivot.add(forearm);
    const tipY = -0.26;
    const wrist = new THREE.Mesh(armWristGeo, botArmJointMat);
    wrist.position.set(0, tipY, 0);
    elbowPivot.add(wrist);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), botArmWristLEDMat);
    led.position.set(0, tipY, 0.04);
    elbowPivot.add(led);
    // Pincers sprout from the wrist; pincerPivots let them open/close.
    const pincerL = new THREE.Mesh(armPincerGeo, botArmMat);
    pincerL.position.set(-0.04, tipY - 0.02, 0.02);
    pincerL.rotation.z = 0.2;
    elbowPivot.add(pincerL);
    const pincerR = new THREE.Mesh(armPincerGeo, botArmMat);
    pincerR.position.set(0.04, tipY - 0.02, 0.02);
    pincerR.rotation.z = -0.2;
    elbowPivot.add(pincerR);

    g.userData.elbowPivot = elbowPivot;
    g.userData.baseElbowAngle = angle;
    g.userData.pincerL = pincerL;
    g.userData.pincerR = pincerR;
    return g;
  }
  function disposeOvenProps(p: OvenProps): void {
    shopLayer.remove(p.flame);
    for (const puff of p.smoke) {
      shopLayer.remove(puff.mesh);
      (puff.mesh.material as THREE.Material).dispose();
    }
    shopLayer.remove(p.arm);
  }

  // ---- Local layer (bikes doing delivery runs) ----
  const localLayer = new THREE.Group();
  scene.add(localLayer);

  // Bike state machine:
  //   idle  — parked at shop, waiting to leave
  //   depart— driving from shop to a random destination
  //   wait  — at customer, briefly stopped (delivering)
  //   return— driving back to shop
  type BikeState = "idle" | "depart" | "wait" | "return";
  type Bike = {
    group: THREE.Group;
    park: THREE.Vector3;
    dest: THREE.Vector3;
    pos: THREE.Vector3;
    state: BikeState;
    stateTime: number; // seconds in current state
    travelTime: number; // seconds for current depart/return leg
    facing: number; // current Y rotation
  };
  const BIKE_SPEED = 3.2; // m/s
  const BIKE_BASE_Y = GROUND_Y + 0.05;
  const bikes: Bike[] = [];

  function pickDestination(): THREE.Vector3 {
    const angle = Math.random() * Math.PI * 2;
    // Customers are scattered in front of and around the shop
    const radius = 4.5 + Math.random() * 2.5;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      BIKE_BASE_Y,
      Math.sin(angle) * radius + 1.5,
    );
  }

  function parkSpot(index: number): THREE.Vector3 {
    // Park positions in a row next to the counter, on the customer side
    const x = -1.4 + index * 0.65;
    return new THREE.Vector3(x, BIKE_BASE_Y, 1.2);
  }

  function spawnBike(): void {
    const group = new THREE.Group();
    onModelReady("bike", (clone) => {
      clone.scale.setScalar(0.65);
      group.add(clone);
    });
    const park = parkSpot(bikes.length);
    group.position.copy(park);
    localLayer.add(group);
    bikes.push({
      group,
      park,
      dest: pickDestination(),
      pos: park.clone(),
      state: "idle",
      // Stagger initial timers so bikes don't all depart together
      stateTime: -Math.random() * 1.5,
      travelTime: 0,
      facing: 0,
    });
  }

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // ---- Customer NPCs ----
  // Walk up to the shop, wait at the counter, walk away. Gives the local
  // phase a sense of activity beyond just delivery bikes.
  type CustomerState = "arriving" | "waiting" | "leaving";
  type Customer = {
    group: THREE.Group;
    legL: THREE.Mesh;
    legR: THREE.Mesh;
    armL: THREE.Mesh;
    armR: THREE.Mesh;
    state: CustomerState;
    stateTime: number;
    spawnPos: THREE.Vector3;
    queuePos: THREE.Vector3;
    exitPos: THREE.Vector3;
    travelTime: number;
    facing: number;
    walkPhase: number;
  };
  const customers: Customer[] = [];
  const CUSTOMER_SPEED = 1.4; // m/s

  // Shared geos for customers — similar shapes to chef but different
  // proportions so they don't look identical.
  const custBodyGeo = new THREE.BoxGeometry(0.32, 0.5, 0.22);
  custBodyGeo.translate(0, 0.25, 0);
  const custHeadGeo = new THREE.SphereGeometry(0.13, 12, 8);
  const custLegGeo = new THREE.BoxGeometry(0.11, 0.45, 0.11);
  custLegGeo.translate(0, -0.225, 0); // pivot at hip
  const custArmGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  custArmGeo.translate(0, -0.16, 0); // pivot at shoulder
  const custHatGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10);

  const customerPalettes = [
    { shirt: 0x4cc9f0, pants: 0x2a3a55, skin: 0xd8a07a, hat: 0xe04848 },
    { shirt: 0x9b59b6, pants: 0x3a3a3a, skin: 0xc18e6a, hat: 0xf2c466 },
    { shirt: 0xe67e22, pants: 0x202830, skin: 0xe8b89a, hat: 0x2a3a55 },
    { shirt: 0x27ae60, pants: 0x462810, skin: 0xc78f70, hat: 0x9be7ff },
  ];

  function makeCustomer(): Customer {
    const palette = customerPalettes[Math.floor(Math.random() * customerPalettes.length)];
    const g = new THREE.Group();
    const matShirt = new THREE.MeshStandardMaterial({ color: palette.shirt, roughness: 0.7 });
    const matPants = new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.8 });
    const matSkinC = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.7 });
    const matHat = new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.6 });
    // Legs (hip pivot at y=0.5)
    const legL = new THREE.Mesh(custLegGeo, matPants);
    legL.position.set(-0.08, 0.5, 0);
    g.add(legL);
    const legR = new THREE.Mesh(custLegGeo, matPants);
    legR.position.set(0.08, 0.5, 0);
    g.add(legR);
    // Torso: 0.5..1.0
    const body = new THREE.Mesh(custBodyGeo, matShirt);
    body.position.y = 0.5;
    g.add(body);
    // Head + hat
    const head = new THREE.Mesh(custHeadGeo, matSkinC);
    head.position.y = 1.15;
    g.add(head);
    const hat = new THREE.Mesh(custHatGeo, matHat);
    hat.position.y = 1.28;
    g.add(hat);
    // Arms — shoulder pivot
    const armL = new THREE.Mesh(custArmGeo, matShirt);
    armL.position.set(-0.2, 0.95, 0);
    g.add(armL);
    const armR = new THREE.Mesh(custArmGeo, matShirt);
    armR.position.set(0.2, 0.95, 0);
    g.add(armR);
    // Spawn from a random edge of the local play area
    const side = Math.random() < 0.5 ? -1 : 1;
    const spawnX = side * (5 + Math.random() * 2);
    const spawnZ = 2.5 + Math.random() * 1.5;
    const spawnPos = new THREE.Vector3(spawnX, GROUND_Y, spawnZ);
    // Queue at counter front, slight horizontal spread
    const queuePos = new THREE.Vector3((Math.random() - 0.5) * 1.5, GROUND_Y, 1.4);
    const exitPos = new THREE.Vector3(-side * (6 + Math.random() * 2), GROUND_Y, 3.2 + Math.random() * 1);
    g.position.copy(spawnPos);
    localLayer.add(g);
    return {
      group: g,
      legL, legR, armL, armR,
      state: "arriving",
      stateTime: 0,
      spawnPos,
      queuePos,
      exitPos,
      travelTime: spawnPos.distanceTo(queuePos) / CUSTOMER_SPEED,
      facing: 0,
      walkPhase: Math.random() * Math.PI * 2,
    };
  }

  // ---- Cosmic layer (Earth + planets + drones) ----
  const cosmicLayer = new THREE.Group();
  cosmicLayer.visible = false;
  scene.add(cosmicLayer);

  const earth = new THREE.Group();
  earth.position.set(0, 0.4, 0);
  cosmicLayer.add(earth);
  const earthPlaceholder = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.7, emissive: 0x113355, emissiveIntensity: 0.25 }),
  );
  earth.add(earthPlaceholder);
  onModelReady("planet", (clone) => {
    earth.remove(earthPlaceholder);
    earthPlaceholder.geometry.dispose();
    (earthPlaceholder.material as THREE.Material).dispose();
    clone.scale.setScalar(1.4);
    earth.add(clone);
  });

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

  // Wormhole — drifts behind Earth during cosmic+ phases
  const wormhole = new THREE.Group();
  wormhole.position.set(-6, 1.5, -4);
  wormhole.rotation.set(0.2, -0.4, 0.1);
  cosmicLayer.add(wormhole);
  onModelReady("wormhole", (clone) => {
    clone.scale.setScalar(0.9);
    wormhole.add(clone);
  });

  // ---- Multiverse: ghost-Earth duplicates that drift around the main planet
  const multiverseLayer = new THREE.Group();
  multiverseLayer.visible = false;
  cosmicLayer.add(multiverseLayer);
  type Ghost = THREE.Group & { userData: { angle: number; radius: number; speed: number; tint: number } };
  const ghosts: Ghost[] = [];
  const ghostTints = [0xff66cc, 0x66ccff];
  for (let i = 0; i < ghostTints.length; i++) {
    const g = new THREE.Group() as Ghost;
    onModelReady("planet", (clone) => {
      clone.scale.setScalar(0.9);
      clone.traverse((n) => {
        const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (m as { color?: unknown }).color) {
          const cm = m.clone();
          cm.transparent = true;
          cm.opacity = 0.45;
          cm.emissive = new THREE.Color(ghostTints[i]);
          cm.emissiveIntensity = 0.8;
          (n as THREE.Mesh).material = cm;
        }
      });
      g.add(clone);
    });
    g.userData.angle = (i / ghostTints.length) * Math.PI * 2;
    g.userData.radius = 3.0 + i * 1.4;
    g.userData.speed = 0.15 + i * 0.05;
    g.userData.tint = ghostTints[i];
    multiverseLayer.add(g);
    ghosts.push(g);
  }

  // ---- Timeloop: spinning crystal cluster around Earth
  const timeloopLayer = new THREE.Group();
  timeloopLayer.visible = false;
  cosmicLayer.add(timeloopLayer);
  const crystalGeo = new THREE.OctahedronGeometry(0.35, 0);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x9be7ff,
    emissive: 0x4cc9f0,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  type Crystal = THREE.Mesh & { userData: { angle: number; phase: number; radius: number; tilt: number } };
  const crystals: Crystal[] = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(crystalGeo, crystalMat) as unknown as Crystal;
    c.userData.angle = (i / 6) * Math.PI * 2;
    c.userData.phase = i * 0.7;
    c.userData.radius = 2.3;
    c.userData.tilt = (i % 2 === 0 ? 1 : -1) * 0.6;
    timeloopLayer.add(c);
    crystals.push(c);
  }

  // ---- Empire: flagship + extra drone fleet flying in formation
  const empireLayer = new THREE.Group();
  empireLayer.visible = false;
  cosmicLayer.add(empireLayer);
  // Flagship: angular triangular hull from primitive geos.
  const flagship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x55606e, roughness: 0.4, metalness: 0.6 });
  const hullEmissiveMat = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0xff3366, emissiveIntensity: 1.2 });
  const hullBody = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.5, 4), hullMat);
  hullBody.rotation.z = Math.PI / 2;
  hullBody.rotation.y = Math.PI / 4;
  flagship.add(hullBody);
  const hullWingL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.6), hullMat);
  hullWingL.position.set(-0.4, 0, 0.55);
  flagship.add(hullWingL);
  const hullWingR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.6), hullMat);
  hullWingR.position.set(-0.4, 0, -0.55);
  flagship.add(hullWingR);
  // Bridge / glowing eye on the nose
  const hullEye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), hullEmissiveMat);
  hullEye.position.set(1.3, 0.1, 0);
  flagship.add(hullEye);
  flagship.scale.setScalar(1.8);
  flagship.position.set(-5, 2.5, -1);
  empireLayer.add(flagship);
  // Fleet: extra drone squad in a V formation behind the flagship.
  const fleet: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Group();
    onModelReady("drone", (clone) => {
      clone.scale.setScalar(0.7);
      f.add(clone);
    });
    // V formation: offset along x and z based on index.
    const row = Math.floor(i / 2) + 1;
    const side = i % 2 === 0 ? 1 : -1;
    f.position.set(-7 - row * 0.9, 2.5 + (Math.random() - 0.5) * 0.4, -1 + side * row * 1.1);
    empireLayer.add(f);
    fleet.push(f);
  }

  type Drone = THREE.Group & { userData: { angle: number; radius: number; speed: number; tilt: number } };
  const drones: Drone[] = [];
  function spawnDrone(): void {
    const d = new THREE.Group() as Drone;
    onModelReady("drone", (clone) => {
      clone.scale.setScalar(0.65);
      d.add(clone);
    });
    d.userData.angle = Math.random() * Math.PI * 2;
    // Spread across two orbit shells so the swarm reads as a swarm,
    // not a single ring overlapping Earth.
    d.userData.radius = 2.2 + Math.random() * 2.0;
    d.userData.speed = 0.5 + Math.random() * 0.6;
    d.userData.tilt = (Math.random() - 0.5) * 1.4;
    cosmicLayer.add(d);
    drones.push(d);
  }

  // ---- Final layer (pizza-sun) ----
  // The final phase is "BECOME THE PIZZA" so the celestial body needs to
  // read as a giant pizza, not a plain orange disc: crust, cheese, sauce
  // pools, pepperoni discs, all glowing like a sun.
  const finalLayer = new THREE.Group();
  finalLayer.visible = false;
  scene.add(finalLayer);

  // Build the pizza in the XY plane (Z = thickness) so it faces the camera
  // without any group-level rotation. Toppings sit at z > 0 (toward camera).
  const pizzaSun = new THREE.Group();
  finalLayer.add(pizzaSun);

  // Crust — torus in XY plane (its default orientation has axis along Z, ✓)
  const crust = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.32, 14, 64),
    new THREE.MeshStandardMaterial({
      color: 0xc97a3a,
      emissive: 0xff5522,
      emissiveIntensity: 0.9,
      roughness: 0.55,
    }),
  );
  pizzaSun.add(crust);

  // Cheese / surface — flat disc. CylinderGeometry's axis is Y by default,
  // so rotate it to align with Z (camera axis).
  const cheeseDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 2.15, 0.18, 48),
    new THREE.MeshStandardMaterial({
      color: 0xffd87a,
      emissive: 0xffb04a,
      emissiveIntensity: 1.4,
      roughness: 0.55,
    }),
  );
  cheeseDisc.rotation.x = Math.PI / 2;
  pizzaSun.add(cheeseDisc);

  // Sauce pools — slightly darker circles randomly placed on the cheese
  const sauceGeo = new THREE.CircleGeometry(0.35, 24);
  const sauceMat = new THREE.MeshStandardMaterial({
    color: 0xc8341e,
    emissive: 0xff2a18,
    emissiveIntensity: 0.9,
    roughness: 0.5,
  });
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(sauceGeo, sauceMat);
    const r = Math.random() * 1.6;
    const a = Math.random() * Math.PI * 2;
    s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.1);
    s.scale.setScalar(0.5 + Math.random() * 0.8);
    pizzaSun.add(s);
  }

  // Pepperoni — small red discs scattered on top, axis along Z so the face
  // shows toward the camera.
  const pepGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 18);
  const pepMat = new THREE.MeshStandardMaterial({
    color: 0xb22222,
    emissive: 0xff3322,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  });
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(pepGeo, pepMat);
    const r = 0.6 + Math.random() * 1.3;
    const a = Math.random() * Math.PI * 2;
    p.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.17);
    p.rotation.x = Math.PI / 2;
    p.scale.setScalar(0.7 + Math.random() * 0.6);
    pizzaSun.add(p);
  }

  // Olive bits — tiny dark green torus rings, default torus orientation
  // already lies in XY, which is what we want.
  const oliveGeo = new THREE.TorusGeometry(0.06, 0.025, 6, 10);
  const oliveMat = new THREE.MeshStandardMaterial({ color: 0x2a4a18, roughness: 0.6 });
  for (let i = 0; i < 20; i++) {
    const o = new THREE.Mesh(oliveGeo, oliveMat);
    const r = 0.4 + Math.random() * 1.5;
    const a = Math.random() * Math.PI * 2;
    o.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.19);
    pizzaSun.add(o);
  }

  const sunGlow = new THREE.PointLight(0xff8844, 3, 30);
  finalLayer.add(sunGlow);
  const finalStars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.9 }),
  );
  finalLayer.add(finalStars);

  // ---- Camera positions per phase ----
  const camTargets: Record<Phase, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
    shop:       { pos: new THREE.Vector3(0, 2.8, 4.2),  look: new THREE.Vector3(0, 0.1, -1.0) },
    local:      { pos: new THREE.Vector3(3.2, 2.8, 4.6), look: new THREE.Vector3(0, 0.3, -0.6) },
    cosmic:     { pos: new THREE.Vector3(0, 3, 11),     look: new THREE.Vector3(0, 0, 0) },
    final:      { pos: new THREE.Vector3(0, 0, 7),      look: new THREE.Vector3(0, 0, 0) },
    credits:    { pos: new THREE.Vector3(0, 0, 5),      look: new THREE.Vector3(0, 0, 0) },
    multiverse: { pos: new THREE.Vector3(2, 1, 9),      look: new THREE.Vector3(0, 0, 0) },
    timeloop:   { pos: new THREE.Vector3(-2, 1.5, 8),   look: new THREE.Vector3(0, 0, 0) },
    empire:     { pos: new THREE.Vector3(2, 3, 12),     look: new THREE.Vector3(-2, 1, -1) },
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
      localLayer.remove(b.group);
    }

    // Customers walk in once reputation is decent — they're the implied
    // demand driver behind the bike-deliveries.
    const desiredCustomers = s.reputation > 5 ? 3 : s.reputation > 1 ? 2 : 0;
    while (customers.length < desiredCustomers) {
      customers.push(makeCustomer());
    }
    while (customers.length > desiredCustomers) {
      const c = customers.pop()!;
      localLayer.remove(c.group);
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
      o.traverse((n) => {
        if ((n as THREE.Mesh).isMesh) (n as THREE.Mesh).geometry.dispose();
      });
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
    }

    // phase visibility
    shopLayer.visible = s.phase === "shop" || s.phase === "local";
    localLayer.visible = s.phase === "shop" || s.phase === "local";
    cosmicLayer.visible = s.phase === "cosmic" || s.phase === "multiverse" || s.phase === "timeloop" || s.phase === "empire";
    multiverseLayer.visible = s.phase === "multiverse";
    timeloopLayer.visible = s.phase === "timeloop";
    empireLayer.visible = s.phase === "empire";
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
      case "bike":      return bikes.length > 0 ? [bikes[bikes.length - 1].group] : [];
      case "kitchen":   return [pizza2, ...(chefs.length > 1 ? [chefs[chefs.length - 1].group] : [])];
      case "marketing": return [marketingGroup];
      case "bots":      return ovenProps.map((p) => p.arm);
      case "drones":    return drones.length > 0 ? [drones[drones.length - 1]] : [];
      default:          return [];
    }
  }

  // ---- Particle puff pool ----
  // THREE.Sprite is camera-aligned by design — no manual billboarding, no
  // depth-test gymnastics. Cleaner than the previous PlaneGeometry+manual-
  // quaternion hack and renders predictably on every backend.
  type Particle = {
    sprite: THREE.Sprite;
    flavor: "make" | "sell";
    life: number;
    maxLife: number;
    vel: THREE.Vector3;
  };
  const PARTICLE_POOL_SIZE = 48;
  const particles: Particle[] = [];

  function makePuffTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const ctx = cv.getContext("2d")!;
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,250,235,0.85)");
    grd.addColorStop(0.8, "rgba(255,240,200,0.25)");
    grd.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function makeCoinTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const ctx = cv.getContext("2d")!;
    // Yellow disc with darker rim — reads as a coin even at small sizes.
    const grd = ctx.createRadialGradient(64, 60, 6, 64, 64, 58);
    grd.addColorStop(0, "rgba(255,255,210,1)");
    grd.addColorStop(0.5, "rgba(255,200,40,1)");
    grd.addColorStop(0.95, "rgba(180,120,10,1)");
    grd.addColorStop(1, "rgba(180,120,10,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    // "$" mark in the centre
    ctx.fillStyle = "rgba(120,70,0,0.9)";
    ctx.font = "bold 70px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 64, 66);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const puffTex = makePuffTexture();
  const coinTex = makeCoinTexture();

  function spawnParticle(flavor: "make" | "sell"): void {
    if (particles.length >= PARTICLE_POOL_SIZE) return;
    const isMake = flavor === "make";
    const mat = new THREE.SpriteMaterial({
      map: isMake ? puffTex : coinTex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(isMake ? 0.6 : 0.5);
    const spread = isMake ? 0.45 : 0.6;
    sprite.position.set(
      (Math.random() - 0.5) * spread,
      counterTopY + 0.3,
      (Math.random() - 0.5) * spread * 0.6,
    );
    const vy = isMake ? 0.5 + Math.random() * 0.3 : 1.1 + Math.random() * 0.3;
    const vx = (Math.random() - 0.5) * 0.3;
    const vz = (Math.random() - 0.5) * 0.2;
    sprite.renderOrder = 999;
    shopLayer.add(sprite);
    particles.push({
      sprite,
      flavor,
      life: 0,
      maxLife: isMake ? 1.0 : 1.3,
      vel: new THREE.Vector3(vx, vy, vz),
    });
  }
  // Throttle auto-emitted (oven-baked) puffs so production storms don't
  // bury the screen — at most a few per second.
  let makeAccum = 0;
  let sellAccum = 0;
  let lastMakeEmit = -Infinity;
  let lastSellEmit = -Infinity;

  subscribe((s, ev) => {
    applyState(s);
    if (!ev) return;
    if (ev.type === "buy" && ev.upgradeId) {
      const targets = pulseTargetsFor(ev.upgradeId);
      if (targets.length > 0) {
        pulses.push({ targets, startedAt: elapsed });
      }
    } else if (ev.type === "make") {
      makeAccum += ev.amount ?? 1;
      if (elapsed - lastMakeEmit > 0.12) {
        for (let i = 0; i < Math.min(3, Math.ceil(makeAccum)); i++) spawnParticle("make");
        makeAccum = 0;
        lastMakeEmit = elapsed;
      }
    } else if (ev.type === "sell") {
      sellAccum += ev.amount ?? 1;
      if (elapsed - lastSellEmit > 0.15) {
        for (let i = 0; i < Math.min(2, Math.max(1, Math.round(sellAccum))); i++) spawnParticle("sell");
        sellAccum = 0;
        lastSellEmit = elapsed;
      }
    }
  });

  // ---- Resize ----
  const onResize = (): void => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    renderer.setSize(w, h);
    composer?.setSize(w, h);
    bloomPass?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  // ---- Animation loop ----
  const clock = new THREE.Clock();
  let elapsed = 0;
  const tmpLook = new THREE.Vector3();

  // ---- Cinematic intro pan ----
  // Sweep from a wide hero shot down to the shop view over ~3 seconds. The
  // intro starts when main.ts dispatches "game-start" (after the menu closes)
  // so the player actually sees it, not while the PLAY button still hides
  // the canvas. Skipped for returning players (totalEarned > 0).
  const INTRO_DURATION = 3.2;
  let introTime = INTRO_DURATION; // start "done" — woken by game-start event
  let introPending = false;
  const introStartPos = new THREE.Vector3(-6, 5.5, 8.5);
  const introStartLook = new THREE.Vector3(0, 1.2, -0.5);
  const isReturningPlayer = (() => {
    try {
      const s = (window as { __game?: { getState?: () => { totalEarned?: number } } }).__game?.getState?.();
      return !!(s && (s.totalEarned ?? 0) > 0);
    } catch { return false; }
  })();
  if (!isReturningPlayer) {
    introPending = true;
    camPos.copy(introStartPos);
    camLook.copy(introStartLook);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }
  window.addEventListener("game-start", () => {
    if (introPending) {
      introTime = 0;
      introPending = false;
    }
  }, { once: true });

  function cubicInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    elapsed += dt;
    advance(dt);

    const target = camTargets[currentPhase];

    if (introPending) {
      // Hold at hero frame until game-start fires.
      camPos.copy(introStartPos);
      camLook.copy(introStartLook);
    } else if (introTime < INTRO_DURATION) {
      introTime += dt;
      const k = Math.min(1, introTime / INTRO_DURATION);
      const e = cubicInOut(k);
      camPos.lerpVectors(introStartPos, target.pos, e);
      camLook.lerpVectors(introStartLook, target.look, e);
    } else {
      // camera ease to current phase
      camPos.lerp(target.pos, Math.min(1, dt * 1.2));
      camLook.lerp(target.look, Math.min(1, dt * 1.2));
    }
    // gentle drift — disabled during the intro so the sweep stays clean
    const intro = introPending || introTime < INTRO_DURATION;
    const drift = currentPhase === "credits" || intro ? 0.0 : 0.05;
    camera.position.copy(camPos);
    camera.position.x += Math.sin(elapsed * 0.4) * drift;
    camera.position.y += Math.cos(elapsed * 0.3) * drift * 0.5;
    tmpLook.copy(camLook);
    camera.lookAt(tmpLook);

    // Pizza spin
    pizza.rotation.y = elapsed * 0.4;
    pizza2.rotation.y = -elapsed * 0.4;

    // ---- Upgrade-driven prop animations ----
    // Dough ball: spin + bob
    if (doughBall.visible) {
      doughBall.rotation.y = elapsed * 1.5;
      doughBall.position.y = doughBaseY + Math.sin(elapsed * 2) * 0.06;
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
        const baseY = (puff.mesh.userData.baseY as number) ?? 0.8;
        puff.mesh.position.y = baseY + t * 1.0;
        const m = puff.mesh.material as THREE.MeshStandardMaterial;
        m.opacity = (1 - t) * 0.5;
      }
      if (p.arm.visible) {
        // Sway side-to-side + bob slightly + grab/release cycle.
        const baseY = (p.arm.userData.baseY ??= p.arm.position.y);
        const phase = p.arm.position.x * 3;
        p.arm.position.y = baseY + Math.sin(elapsed * 4 + phase) * 0.06;
        p.arm.rotation.y = Math.sin(elapsed * 2.5 + phase) * 0.45;
        // Elbow flex: bend further forward then back to base angle.
        const elbowPivot = p.arm.userData.elbowPivot as THREE.Group | undefined;
        const baseAngle = p.arm.userData.baseElbowAngle as number;
        if (elbowPivot) {
          const flex = (Math.sin(elapsed * 3 + phase) + 1) * 0.35; // 0..0.7 rad
          elbowPivot.rotation.x = baseAngle + flex;
        }
        // Pincer open/close — closes when elbow flexes deepest (grabbing).
        const grip = (Math.cos(elapsed * 3 + phase) + 1) * 0.5; // 0=open, 1=closed
        const open = 0.5 - grip * 0.4; // 0.5 open → 0.1 closed
        const pL = p.arm.userData.pincerL as THREE.Mesh | undefined;
        const pR = p.arm.userData.pincerR as THREE.Mesh | undefined;
        if (pL) pL.rotation.z = open;
        if (pR) pR.rotation.z = -open;
      }
    }
    // Marketing star fountain
    if (marketingGroup.visible) {
      for (const s of marketingStars) {
        const a = elapsed * 0.8 + (s.userData.phase as number);
        s.position.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6);
        const pop = 1 + Math.sin(elapsed * 3 + (s.userData.phase as number)) * 0.1;
        s.scale.setScalar(pop);
        s.rotation.y += dt * 2;
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
    // ---- Particle puff tick ----
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        shopLayer.remove(p.sprite);
        p.sprite.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.vel.x * dt;
      p.sprite.position.y += p.vel.y * dt;
      p.sprite.position.z += p.vel.z * dt;
      if (p.flavor === "sell") {
        p.vel.y += 0.2 * dt;
      }
      p.sprite.material.opacity = (1 - t);
      // Puff expands; coin stays roughly the same size.
      const base = p.flavor === "make" ? 0.6 : 0.5;
      const growth = p.flavor === "make" ? 1 + t * 1.8 : 1 + t * 0.4;
      p.sprite.scale.setScalar(base * growth);
    }

    // Neon pulse
    neonGlow.intensity = 1.2 + Math.sin(elapsed * 3) * 0.4;
    // Kitchen glow tied to flame intensity — dims out when ovens are off.
    const ovenLit = ovenProps.some((p) => p.flame.visible);
    kitchenGlow.intensity = ovenLit ? 1.6 + Math.sin(elapsed * 6) * 0.3 : 0.0;

    // Kitchen decor animations — chef bob + kneading arms
    for (let i = 0; i < chefs.length; i++) {
      const c = chefs[i];
      const t = elapsed * 2 + c.phase;
      c.group.position.y = GROUND_Y + Math.sin(t) * 0.03;
      c.armL.rotation.x = Math.sin(t * 1.5) * 0.6 - 0.4;
      c.armR.rotation.x = Math.sin(t * 1.5 + Math.PI) * 0.6 - 0.4;
    }

    // Bikes: deliver-then-return state machine
    for (let i = 0; i < bikes.length; i++) {
      const b = bikes[i];
      // Re-anchor park spot (in case bike count changed since last frame)
      b.park.copy(parkSpot(i));
      b.stateTime += dt;
      const prev = b.pos.clone();

      switch (b.state) {
        case "idle": {
          b.pos.copy(b.park);
          if (b.stateTime >= 0.8) {
            b.state = "depart";
            b.stateTime = 0;
            b.dest = pickDestination();
            b.travelTime = Math.max(0.6, b.park.distanceTo(b.dest) / BIKE_SPEED);
          }
          break;
        }
        case "depart": {
          const k = Math.min(1, b.stateTime / b.travelTime);
          const e = easeInOut(k);
          b.pos.lerpVectors(b.park, b.dest, e);
          // Slight arc — lift body mid-journey for visual interest
          b.pos.y = BIKE_BASE_Y + Math.sin(k * Math.PI) * 0.08;
          if (k >= 1) {
            b.state = "wait";
            b.stateTime = 0;
          }
          break;
        }
        case "wait": {
          b.pos.copy(b.dest);
          if (b.stateTime >= 0.9) {
            b.state = "return";
            b.stateTime = 0;
            b.travelTime = Math.max(0.6, b.park.distanceTo(b.dest) / BIKE_SPEED);
          }
          break;
        }
        case "return": {
          const k = Math.min(1, b.stateTime / b.travelTime);
          const e = easeInOut(k);
          b.pos.lerpVectors(b.dest, b.park, e);
          b.pos.y = BIKE_BASE_Y + Math.sin(k * Math.PI) * 0.08;
          if (k >= 1) {
            b.state = "idle";
            b.stateTime = 0;
          }
          break;
        }
      }

      // Face direction of travel; smoothly turn when stationary
      const vx = b.pos.x - prev.x;
      const vz = b.pos.z - prev.z;
      const moving = vx * vx + vz * vz > 1e-6;
      if (moving) {
        const target = Math.atan2(vx, vz);
        // shortest-arc lerp
        let diff = target - b.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        b.facing += diff * Math.min(1, dt * 8);
      } else {
        // Parked bikes face outward (toward customers) so they look ready to go
        const idleTarget = b.state === "wait" ? Math.atan2(-b.dest.x, -b.dest.z) : 0;
        let diff = idleTarget - b.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        b.facing += diff * Math.min(1, dt * 3);
      }
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.facing;
      // Lean on turns: small roll proportional to angular velocity
      const lean = THREE.MathUtils.clamp((moving ? (b.facing - (b.group.userData.prevFacing ?? b.facing)) / Math.max(dt, 1e-3) : 0) * 0.15, -0.35, 0.35);
      b.group.rotation.z = -lean;
      b.group.userData.prevFacing = b.facing;
    }

    // Customers: arriving → waiting → leaving cycle
    for (const c of customers) {
      c.stateTime += dt;
      const prev = c.group.position.clone();

      switch (c.state) {
        case "arriving": {
          const k = Math.min(1, c.stateTime / c.travelTime);
          const e = easeInOut(k);
          c.group.position.lerpVectors(c.spawnPos, c.queuePos, e);
          if (k >= 1) {
            c.state = "waiting";
            c.stateTime = 0;
          }
          break;
        }
        case "waiting": {
          if (c.stateTime > 1.5) {
            // Pick a new exit + restart
            const side = Math.sign(c.group.position.x - 0) || (Math.random() < 0.5 ? -1 : 1);
            c.exitPos.set(side * (6 + Math.random() * 2), GROUND_Y, 3.2 + Math.random() * 1);
            c.state = "leaving";
            c.stateTime = 0;
            c.travelTime = Math.max(0.5, c.queuePos.distanceTo(c.exitPos) / CUSTOMER_SPEED);
          }
          break;
        }
        case "leaving": {
          const k = Math.min(1, c.stateTime / c.travelTime);
          const e = easeInOut(k);
          c.group.position.lerpVectors(c.queuePos, c.exitPos, e);
          if (k >= 1) {
            // Respawn from a fresh edge position
            const side = Math.random() < 0.5 ? -1 : 1;
            c.spawnPos.set(side * (5 + Math.random() * 2), GROUND_Y, 2.5 + Math.random() * 1.5);
            c.queuePos.set((Math.random() - 0.5) * 1.5, GROUND_Y, 1.4);
            c.group.position.copy(c.spawnPos);
            c.state = "arriving";
            c.stateTime = 0;
            c.travelTime = Math.max(0.5, c.spawnPos.distanceTo(c.queuePos) / CUSTOMER_SPEED);
          }
          break;
        }
      }

      // Face direction of travel
      const vx = c.group.position.x - prev.x;
      const vz = c.group.position.z - prev.z;
      const moving = vx * vx + vz * vz > 1e-6;
      if (moving) {
        const target = Math.atan2(vx, vz);
        let diff = target - c.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        c.facing += diff * Math.min(1, dt * 8);
      } else {
        // Face the counter while waiting
        const tFace = Math.atan2(-c.group.position.x, -1.4 - c.group.position.z);
        let diff = tFace - c.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        c.facing += diff * Math.min(1, dt * 4);
      }
      c.group.rotation.y = c.facing;
      // Walking cycle — legs swing opposite, arms swing opposite to legs
      if (moving) {
        c.walkPhase += dt * 7;
        const swing = Math.sin(c.walkPhase);
        c.legL.rotation.x = swing * 0.7;
        c.legR.rotation.x = -swing * 0.7;
        c.armL.rotation.x = -swing * 0.5;
        c.armR.rotation.x = swing * 0.5;
        // Slight bob
        c.group.position.y = GROUND_Y + Math.abs(swing) * 0.04;
      } else {
        // Idle — legs straight, arms slightly forward (peering at counter)
        c.legL.rotation.x *= 0.85;
        c.legR.rotation.x *= 0.85;
        c.armL.rotation.x = -0.2;
        c.armR.rotation.x = -0.2;
      }
    }

    // Cosmic
    if (cosmicLayer.visible) {
      earth.rotation.y = elapsed * 0.15;
      stars.rotation.y = elapsed * 0.005;
      wormhole.rotation.z = elapsed * 0.6;
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

      // ---- Multiverse ghosts ----
      if (multiverseLayer.visible) {
        for (const g of ghosts) {
          g.userData.angle += dt * g.userData.speed;
          const a = g.userData.angle;
          const r = g.userData.radius;
          g.position.set(Math.cos(a) * r, Math.sin(a * 0.6) * 0.6, Math.sin(a) * r);
          g.rotation.y += dt * 0.2;
        }
      }

      // ---- Time crystals ----
      if (timeloopLayer.visible) {
        for (const c of crystals) {
          c.userData.angle += dt * 0.4;
          const a = c.userData.angle;
          const r = c.userData.radius;
          c.position.set(
            Math.cos(a) * r,
            Math.sin(a * 1.4 + c.userData.phase) * 0.7 + c.userData.tilt,
            Math.sin(a) * r,
          );
          c.rotation.x += dt * 1.2;
          c.rotation.y += dt * 1.5;
        }
      }

      // ---- Empire flagship + fleet ----
      if (empireLayer.visible) {
        flagship.position.x = -5 + Math.sin(elapsed * 0.3) * 0.4;
        flagship.rotation.y = Math.sin(elapsed * 0.25) * 0.15;
        for (let i = 0; i < fleet.length; i++) {
          const f = fleet[i];
          const baseY = (f.userData.baseY ??= f.position.y);
          f.position.y = baseY + Math.sin(elapsed * 1.5 + i) * 0.15;
          f.rotation.y = Math.sin(elapsed * 0.5 + i * 0.4) * 0.2;
        }
      }
    }

    // Final pizza-sun
    if (finalLayer.visible) {
      // Pizza disc faces the camera (XY plane); spin it around its forward
      // axis so toppings parade past as it rotates.
      pizzaSun.rotation.z = elapsed * 0.2;
      sunGlow.intensity = 3 + Math.sin(elapsed * 2) * 0.6;
    }

    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  });

  return { canvas: renderer.domElement };
}

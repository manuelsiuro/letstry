import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { subscribe, getState, type GameState, type Phase } from "../game/state";
import { advance } from "../game/loop";

export interface ThreeScene {
  canvas: HTMLCanvasElement;
}

const FX_ON = new URLSearchParams(window.location.search).get("fx") !== "off";

export function startThreeScene(mount: HTMLElement): ThreeScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 18, 60);
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
  let chromAberrPass: ShaderPass | null = null;
  let scanlinePass: ShaderPass | null = null;
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
    // Vignette — subtle radial darkening pulls the eye toward the action.
    const vignetteShader = {
      uniforms: {
        tDiffuse: { value: null },
        strength: { value: 0.5 },
        inner: { value: 0.35 },
        outer: { value: 0.9 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float strength;
        uniform float inner;
        uniform float outer;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float d = length(vUv - 0.5) * 1.414; // 0..1 across diag
          float darken = strength * smoothstep(inner, outer, d);
          color.rgb *= (1.0 - darken);
          gl_FragColor = color;
        }
      `,
    };
    composer.addPass(new ShaderPass(vignetteShader));
    // Chromatic aberration — only enabled in cosmic phase group. Offsets
    // R/B channels radially to suggest interstellar lens distortion.
    chromAberrPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0.0035 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          vec2 dir = vUv - 0.5;
          float r = texture2D(tDiffuse, vUv + dir * amount).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - dir * amount).b;
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `,
    });
    chromAberrPass.enabled = false;
    composer.addPass(chromAberrPass);
    // Scanlines — final / credits phase only. Darkens every other row.
    scanlinePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(mount.clientWidth, mount.clientHeight) },
        intensity: { value: 0.22 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float line = sin(vUv.y * resolution.y * 1.8) * 0.5 + 0.5;
          color.rgb *= (1.0 - intensity * line);
          gl_FragColor = color;
        }
      `,
    });
    scanlinePass.enabled = false;
    composer.addPass(scanlinePass);
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

  // Wet-asphalt ground: low roughness + slight metalness so the neon sign,
  // building windows, and rooftop signs reflect on the floor — sells the
  // "rain-slick city street" look.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({
      color: 0x12182a, roughness: 0.45, metalness: 0.5,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  shopLayer.add(ground);

  // A few darker, even shinier "puddle" patches in front of the shop.
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x0a1226, roughness: 0.15, metalness: 0.75,
  });
  for (let i = 0; i < 5; i++) {
    const radius = 0.6 + Math.random() * 1.2;
    const puddle = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 24),
      puddleMat,
    );
    puddle.rotation.x = -Math.PI / 2;
    // Sit just above the ground to avoid z-fighting
    puddle.position.set(
      (Math.random() - 0.5) * 6,
      GROUND_Y + 0.001,
      1.5 + Math.random() * 2.5,
    );
    // Squash to ellipse for variety
    puddle.scale.x = 1 + Math.random() * 0.5;
    puddle.scale.z = 0.6 + Math.random() * 0.5;
    shopLayer.add(puddle);
  }

  // ---- Streetlights ----
  // Two poles flanking the shop entrance, plus a third further out.
  // Each gets a glowing head and a translucent additive cone underneath
  // suggesting light spill — cheaper than an actual SpotLight + shadow.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.7, metalness: 0.4 });
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xfff4c8, emissive: 0xffd075, emissiveIntensity: 1.8, roughness: 0.4, fog: false,
  });
  const lampConeMat = new THREE.MeshBasicMaterial({
    color: 0xfff0a8, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const streetlightSpots: Array<[number, number]> = [
    [-3.6, 1.6],
    [3.6, 1.6],
    [-5.4, 3.4],
  ];
  for (const [sx, sz] of streetlightSpots) {
    const lamp = new THREE.Group();
    const poleH = 3.2;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, poleH, 8),
      poleMat,
    );
    pole.position.y = poleH / 2;
    lamp.add(pole);
    // Short horizontal arm at the top — head hangs from it.
    const armOff = 0.4 * (sx > 0 ? -1 : 1); // arm points toward shop
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(armOff), 0.06, 0.06),
      poleMat,
    );
    arm.position.set(armOff / 2, poleH - 0.05, 0);
    lamp.add(arm);
    // Lamp head — small glowing box
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), lampHeadMat);
    head.position.set(armOff, poleH - 0.18, 0);
    lamp.add(head);
    // Light cone shaft below the head — ConeGeometry default has tip at
    // +Y and wide base at -Y, which is exactly what a streetlight wants.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, poleH - 0.4, 18, 1, true),
      lampConeMat,
    );
    cone.position.set(armOff, (poleH - 0.4) / 2, 0);
    lamp.add(cone);
    lamp.position.set(sx, GROUND_Y, sz);
    shopLayer.add(lamp);
  }

  // ---- Background traffic ----
  // A single car that loops periodically across the street far in front of
  // the shop, driving right-to-left or left-to-right with headlights and
  // taillights. Hidden between trips.
  const carBody = new THREE.Group();
  carBody.visible = false;
  shopLayer.add(carBody);
  const carHullMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.6 });
  const carBaseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.45, 0.7),
    carHullMat,
  );
  carBaseMesh.position.y = 0.25;
  carBody.add(carBaseMesh);
  const carRoofMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.32, 0.65),
    carHullMat,
  );
  carRoofMesh.position.set(-0.05, 0.6, 0);
  carBody.add(carRoofMesh);
  const carWheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const carWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12);
  carWheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[0.55, 0.32], [0.55, -0.32], [-0.55, 0.32], [-0.55, -0.32]] as Array<[number, number]>) {
    const w = new THREE.Mesh(carWheelGeo, carWheelMat);
    w.position.set(wx, 0.18, wz);
    carBody.add(w);
  }
  const carHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff4a0, fog: false });
  const carTailMat = new THREE.MeshBasicMaterial({ color: 0xff3333, fog: false });
  const carHeadGeo = new THREE.SphereGeometry(0.08, 8, 6);
  for (const [hx, hz] of [[0.82, 0.25], [0.82, -0.25]] as Array<[number, number]>) {
    const h = new THREE.Mesh(carHeadGeo, carHeadMat);
    h.position.set(hx, 0.3, hz);
    carBody.add(h);
  }
  for (const [tx, tz] of [[-0.82, 0.25], [-0.82, -0.25]] as Array<[number, number]>) {
    const t = new THREE.Mesh(carHeadGeo, carTailMat);
    t.position.set(tx, 0.3, tz);
    carBody.add(t);
  }
  // Car position state
  const carState = {
    active: false,
    startX: 0,
    endX: 0,
    progress: 0,
    duration: 6,
    z: 4.2,
    facing: 1, // +1 = +X direction, -1 = -X
  };
  let nextCarAt = 6 + Math.random() * 6;

  function spawnCar(): void {
    carState.facing = Math.random() < 0.5 ? 1 : -1;
    carState.startX = carState.facing > 0 ? -10 : 10;
    carState.endX = -carState.startX;
    carState.progress = 0;
    carState.duration = 5 + Math.random() * 3;
    carState.z = 4 + Math.random() * 0.8;
    carState.active = true;
    carBody.visible = true;
    carBody.rotation.y = carState.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  // ---- Nighttime city backdrop ----
  // Procedural row of building silhouettes with random lit windows on a
  // ring behind the shop. Reads as "you're a pizzeria on a city street"
  // rather than a void.
  const cityLayer = new THREE.Group();
  shopLayer.add(cityLayer);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x18243a, roughness: 0.9 });
  // Windows are emissive so they punch through the fog at distance and read
  // as actual lit city windows.
  const windowGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const windowMatLit = new THREE.MeshStandardMaterial({
    color: 0xffe6a0, emissive: 0xffd86a, emissiveIntensity: 1.6, fog: false,
    side: THREE.DoubleSide,
  });
  const windowMatDim = new THREE.MeshStandardMaterial({
    color: 0x4a5a8a, emissive: 0x4a5a8a, emissiveIntensity: 0.4, fog: false,
    side: THREE.DoubleSide,
  });
  // Track a small subset of windows that will flicker on/off so the city
  // doesn't feel like a static painting.
  type BlinkWindow = { mesh: THREE.Mesh; phase: number; period: number; threshold: number };
  const blinkWindows: BlinkWindow[] = [];

  // Track rotating rooftop signs so the tick can spin them.
  type RoofSign = { mesh: THREE.Mesh; speed: number };
  const roofSigns: RoofSign[] = [];

  const signPalette = [0xff3b88, 0x4cc9f0, 0xffd24a, 0xff7733, 0xb47dff];
  function makeRoofSign(width: number): THREE.Mesh {
    const color = signPalette[Math.floor(Math.random() * signPalette.length)];
    const signWidth = Math.min(width * 0.7, 1.6);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.6,
      roughness: 0.4, fog: false,
    });
    const geo = new THREE.BoxGeometry(signWidth, 0.25, 0.08);
    return new THREE.Mesh(geo, mat);
  }
  const buildingCount = 22;
  const ringRadius = 13;
  for (let i = 0; i < buildingCount; i++) {
    const a = (i / buildingCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
    // Skip the slice directly in front of the camera (z>+ direction) so the
    // city forms a backdrop on three sides without blocking the foreground.
    if (Math.sin(a) > 0.6) continue;
    const cx = Math.cos(a) * ringRadius;
    const cz = Math.sin(a) * ringRadius;
    const width = 2.2 + Math.random() * 2.5;
    const height = 4 + Math.random() * 6;
    const depth = 1.5 + Math.random() * 1.5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), buildingMat);
    // Face the center: rotate around Y so the long face looks inward
    b.rotation.y = -a + Math.PI / 2;
    b.position.set(cx, GROUND_Y + height / 2, cz);
    cityLayer.add(b);
    // Sprinkle lit windows on the inward-facing side
    const colStep = 0.5;
    const rowStep = 0.5;
    const cols = Math.max(2, Math.floor(width / colStep));
    const rows = Math.max(3, Math.floor(height / rowStep));
    for (let c = 0; c < cols; c++) {
      for (let r = 1; r < rows - 1; r++) {
        if (Math.random() > 0.55) continue;
        const lit = Math.random() > 0.3;
        // Each blinker gets its own clone of the lit material so we can
        // toggle its emissiveIntensity independently. Static windows reuse
        // the shared material to save memory.
        const blinks = lit && Math.random() < 0.35;
        const mat = blinks ? windowMatLit.clone() : (lit ? windowMatLit : windowMatDim);
        const w = new THREE.Mesh(windowGeo, mat);
        const localX = (c + 0.5) * colStep - width / 2;
        const localY = (r + 0.5) * rowStep - height / 2;
        // Inward-facing side. The building's rotation maps local -Z toward
        // scene center; windows sit there so they face the camera.
        w.position.set(localX, localY, -depth / 2 - 0.02);
        w.rotation.y = Math.PI; // flip so the lit side points outward
        b.add(w);
        if (blinks) {
          blinkWindows.push({
            mesh: w,
            phase: Math.random() * Math.PI * 2,
            period: 4 + Math.random() * 6, // 4-10s on/off cycle
            // threshold close to ±1 → off for most of the cycle (lights "on"
            // is the normal state, blink toggles dark briefly)
            threshold: 0.5 + Math.random() * 0.4,
          });
        }
      }
    }
    // Optional rooftop "antenna" or sign for variety
    if (Math.random() < 0.25) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
        buildingMat,
      );
      antenna.position.set(0, height / 2 + 0.6, 0);
      b.add(antenna);
    } else if (Math.random() < 0.45) {
      // Rotating rooftop billboard sign — added as a CHILD OF cityLayer
      // (not the building) so its rotation animation is in world space and
      // doesn't fight the building's own rotation.
      const sign = makeRoofSign(width);
      // Position above the building's roof in world space
      const worldY = GROUND_Y + height + 0.35;
      sign.position.set(b.position.x, worldY, b.position.z);
      cityLayer.add(sign);
      roofSigns.push({ mesh: sign, speed: 0.4 + Math.random() * 0.7 });
      // A short post under it so it doesn't appear to float
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6),
        buildingMat,
      );
      post.position.set(0, height / 2 + 0.2, 0);
      b.add(post);
    }
  }

  // ---- Atmospheric dust motes ----
  // Slowly drifting particles in front of the shop. Catch warm light from
  // the kitchen + neon sign, so the air looks "lit" rather than empty.
  const DUST_COUNT = 80;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustVelocities: number[] = []; // per-particle [vx, vy, vz]
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPositions[i * 3 + 0] = (Math.random() - 0.5) * 8; // x
    dustPositions[i * 3 + 1] = GROUND_Y + Math.random() * 3.5; // y
    dustPositions[i * 3 + 2] = -1 + Math.random() * 5; // z (in front of shop)
    dustVelocities.push(
      (Math.random() - 0.5) * 0.05,    // vx
      -(0.05 + Math.random() * 0.12),  // vy (always down)
      (Math.random() - 0.5) * 0.03,    // vz
    );
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xffe9b5,
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    fog: true,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  shopLayer.add(dust);

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

  // ---- Hanging "OPEN" sign ----
  // Small green neon plaque hanging from the shop edge by a thin string.
  // Sways slightly with a sin so it feels alive.
  const openTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 128;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = "#4dff88";
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, 236, 108);
    ctx.fillStyle = "#9bffb9";
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#4dff88";
    ctx.shadowBlur = 18;
    ctx.fillText("OPEN", 128, 70);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const openSignPivot = new THREE.Group();
  openSignPivot.position.set(1.8, 1.85, 0.7);
  shopLayer.add(openSignPivot);
  // String connecting the pivot to the sign body
  const openString = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }),
  );
  openString.position.y = -0.15;
  openSignPivot.add(openString);
  const openSignMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshBasicMaterial({ map: openTex, transparent: true, fog: false }),
  );
  openSignMesh.position.y = -0.42;
  openSignPivot.add(openSignMesh);
  // Back side so it reads OPEN from both directions (mirror).
  const openSignBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshBasicMaterial({ map: openTex, transparent: true, fog: false }),
  );
  openSignBack.position.y = -0.42;
  openSignBack.rotation.y = Math.PI;
  openSignPivot.add(openSignBack);

  // Volumetric "god-rays" — two slanted additive translucent planes hanging
  // down from the neon sign, picking out the air-light beam. Pulses softly
  // with the neon glow timer.
  const rayTex = (() => {
    // Build a 1x256 vertical gradient (bright at top, fade to 0 at bottom)
    const cv = document.createElement("canvas");
    cv.width = 4; cv.height = 256;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255,90,150,0.55)");
    g.addColorStop(0.5, "rgba(255,90,150,0.18)");
    g.addColorStop(1, "rgba(255,90,150,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const rayMat = new THREE.MeshBasicMaterial({
    map: rayTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 1,
    fog: false,
  });
  const godRays: THREE.Mesh[] = [];
  // Two crossed planes shaped wider at top → narrower at bottom (using
  // ShapeGeometry trapezoid).
  for (let i = 0; i < 2; i++) {
    const trapezoid = new THREE.Shape();
    const topHalf = 1.5;
    const botHalf = 0.3;
    const height = 2.4;
    trapezoid.moveTo(-topHalf, height / 2);
    trapezoid.lineTo(topHalf, height / 2);
    trapezoid.lineTo(botHalf, -height / 2);
    trapezoid.lineTo(-botHalf, -height / 2);
    trapezoid.closePath();
    const geo = new THREE.ShapeGeometry(trapezoid);
    // UVs default to bbox; ensure top→bottom maps to the gradient.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) {
      const y = geo.attributes.position.getY(v);
      // Normalize y from [-height/2, +height/2] to [1, 0] (top of texture is 0)
      uv.setXY(v, 0.5, 1 - (y + height / 2) / height);
    }
    const m = new THREE.Mesh(geo, rayMat.clone());
    m.position.set(0, 1.05, 0.55);
    m.rotation.y = i === 0 ? Math.PI / 8 : -Math.PI / 8;
    m.renderOrder = 50;
    shopLayer.add(m);
    godRays.push(m);
  }

  // ---- Storefront awning ----
  // Red+white striped canvas awning above the counter, tilted slightly
  // forward toward the customers. A row of small warm bulbs hangs from
  // the front edge.
  const awningTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 96;
    const ctx = cv.getContext("2d")!;
    // Vertical stripes
    const stripeW = 64;
    for (let i = 0; i < 512 / stripeW; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#e04848" : "#f5e6c8";
      ctx.fillRect(i * stripeW, 0, stripeW, 96);
    }
    // Scalloped bottom edge
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.globalCompositeOperation = "destination-out";
    for (let x = 0; x <= 512; x += 32) {
      ctx.beginPath();
      ctx.arc(x, 96, 16, 0, Math.PI, true);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.9),
    new THREE.MeshStandardMaterial({
      map: awningTex,
      transparent: true,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  // Sloped forward (tilted toward customers): rotate around X so the back
  // edge is higher than the front.
  awning.rotation.x = -Math.PI / 2 + 0.35;
  awning.position.set(0, 1.45, 0.7);
  shopLayer.add(awning);
  // Tiny bulb-string below the awning front edge.
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, fog: false });
  const bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);
  for (let i = 0; i < 8; i++) {
    const x = -1.6 + i * 0.46;
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    b.position.set(x, 1.0, 1.05);
    shopLayer.add(b);
  }

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

  type Chef = {
    group: THREE.Group;
    armL: THREE.Mesh;
    armR: THREE.Mesh;
    phase: number;
    speechSprite: THREE.Sprite;
    nextSpeechAt: number;
    speechLife: number;
    speechMaxLife: number;
  };

  // Speech bubble textures — generate one per phrase upfront so we can just
  // swap a sprite's map when a chef "speaks". White rounded rectangle with
  // the phrase, drawn into a canvas.
  function makeSpeechTex(phrase: string): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 128;
    const ctx = cv.getContext("2d")!;
    // Background rounded rect
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    const r = 28;
    ctx.beginPath();
    ctx.moveTo(r, 4);
    ctx.lineTo(256 - r, 4);
    ctx.quadraticCurveTo(252, 4, 252, r);
    ctx.lineTo(252, 80 - r);
    ctx.quadraticCurveTo(252, 80, 256 - r, 80);
    ctx.lineTo(80, 80);
    ctx.lineTo(60, 124); // tail pointing down-left
    ctx.lineTo(50, 80);
    ctx.lineTo(r, 80);
    ctx.quadraticCurveTo(4, 80, 4, 80 - r);
    ctx.lineTo(4, r);
    ctx.quadraticCurveTo(4, 4, r, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 4;
    ctx.stroke();
    // Text
    ctx.fillStyle = "#222";
    ctx.font = "bold 42px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(phrase, 128, 40);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const speechPhrases = ["PIZZA!", "HOT!", "READY!", "MAMMA MIA!", "FRESH!"];
  const speechTextures = speechPhrases.map(makeSpeechTex);
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
    // Speech bubble — sprite above the chef's head, initially invisible.
    const speechSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: speechTextures[0],
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    speechSprite.scale.set(0.9, 0.45, 1);
    speechSprite.position.set(0.4, 2.2, 0);
    g.add(speechSprite);
    shopLayer.add(g);
    return {
      group: g,
      armL, armR,
      phase,
      speechSprite,
      nextSpeechAt: 2 + Math.random() * 5,
      speechLife: 0,
      speechMaxLife: 1.6,
    };
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

  // Glitter trail — pool of small sprites that spawn at marketing star
  // positions and drift downward, fading out. Visible only when marketing
  // upgrade is owned (= marketingGroup.visible).
  type Glitter = { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; maxLife: number; active: boolean };
  const GLITTER_POOL = 24;
  const glitter: Glitter[] = [];
  const glitterTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    g.addColorStop(0, "rgba(255,255,200,1)");
    g.addColorStop(0.5, "rgba(255,220,100,0.7)");
    g.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  for (let i = 0; i < GLITTER_POOL; i++) {
    const mat = new THREE.SpriteMaterial({
      map: glitterTex, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(0.15);
    sp.visible = false;
    shopLayer.add(sp);
    glitter.push({ sprite: sp, vel: new THREE.Vector3(), life: 0, maxLife: 1, active: false });
  }
  let nextGlitterAt = 0;

  // Per-oven dynamic props (flame, smoke, bot-arm) — maintained alongside `ovens[]`
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7722, emissive: 0xff4400, emissiveIntensity: 1.2, roughness: 0.3 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true, opacity: 0.5, roughness: 1 });
  const botArmMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.3, metalness: 0.7 });
  const botArmJointMat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x4cc9f0, emissiveIntensity: 1.4, roughness: 0.3 });
  const botArmWristLEDMat = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0xff3366, emissiveIntensity: 1.6, roughness: 0.4 });

  type SmokePuff = { mesh: THREE.Mesh; offset: number };
  type SteamSprite = { sprite: THREE.Sprite; offset: number };
  type OvenProps = { flame: THREE.Mesh; smoke: SmokePuff[]; steam: SteamSprite[]; arm: THREE.Group };
  const ovenProps: OvenProps[] = [];

  // Shared steam texture — soft puffy radial gradient.
  const steamTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(220,220,220,0.85)");
    g.addColorStop(0.6, "rgba(200,200,200,0.35)");
    g.addColorStop(1, "rgba(180,180,180,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
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
    // Steam plumes — sprite-based, more visible than the 3D smoke spheres
    // at camera distance. Loop position from chimney top to ~1.2m above.
    const steam: SteamSprite[] = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: steamTex, transparent: true, opacity: 0, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(oven.position.x, ovenTopY, oven.position.z);
      sp.scale.setScalar(0.45);
      sp.visible = false;
      shopLayer.add(sp);
      steam.push({ sprite: sp, offset: i / 3 });
    }
    return { flame, smoke, steam, arm };
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
    for (const st of p.steam) {
      shopLayer.remove(st.sprite);
      st.sprite.material.dispose();
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
    head: THREE.Group;
    pizzaBox: THREE.Group;
    state: CustomerState;
    stateTime: number;
    queueSlot: number; // -1 = no slot held
    spawnPos: THREE.Vector3;
    queuePos: THREE.Vector3;
    exitPos: THREE.Vector3;
    travelTime: number;
    facing: number;
    headFacing: number;
    walkPhase: number;
  };

  // Discrete queue slots in front of the counter — keeps customers lined up
  // instead of overlapping at random x positions.
  const QUEUE_SLOT_COUNT = 4;
  const QUEUE_BASE_Z = 1.4;
  const QUEUE_SLOT_STRIDE = 0.7;
  const queueSlotTaken: boolean[] = new Array(QUEUE_SLOT_COUNT).fill(false);
  function queueSlotPos(slot: number): THREE.Vector3 {
    const x = (slot - (QUEUE_SLOT_COUNT - 1) / 2) * QUEUE_SLOT_STRIDE;
    return new THREE.Vector3(x, GROUND_Y, QUEUE_BASE_Z);
  }
  function claimQueueSlot(): number {
    for (let i = 0; i < queueSlotTaken.length; i++) {
      if (!queueSlotTaken[i]) {
        queueSlotTaken[i] = true;
        return i;
      }
    }
    return -1; // shouldn't happen unless desiredCustomers > slots
  }
  function releaseQueueSlot(slot: number): void {
    if (slot >= 0 && slot < queueSlotTaken.length) queueSlotTaken[slot] = false;
  }
  // Compact the queue: when slot N frees, the lowest-indexed waiting customer
  // with slot > N walks up to fill it. Repeats until no more advances possible.
  function advanceQueue(): void {
    for (let target = 0; target < QUEUE_SLOT_COUNT; target++) {
      if (queueSlotTaken[target]) continue;
      // Find a waiting customer in a higher slot to move down
      let bestC: Customer | null = null;
      for (const c of customers) {
        if (c.state !== "waiting") continue;
        if (c.queueSlot <= target) continue;
        if (!bestC || c.queueSlot < bestC.queueSlot) bestC = c;
      }
      if (!bestC) continue;
      // Reassign the slot
      queueSlotTaken[bestC.queueSlot] = false;
      queueSlotTaken[target] = true;
      bestC.queueSlot = target;
      const newPos = queueSlotPos(target);
      // Switch back to "arriving" so they walk from current pos to newPos.
      bestC.spawnPos.copy(bestC.group.position);
      bestC.queuePos.copy(newPos);
      bestC.state = "arriving";
      bestC.stateTime = 0;
      bestC.travelTime = Math.max(0.3, bestC.spawnPos.distanceTo(newPos) / CUSTOMER_SPEED);
    }
  }
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

  // Shared "PIZZA" sticker texture for customer + drone pizza boxes.
  const pizzaStickerTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "rgba(255,255,255,0)";
    ctx.fillRect(0, 0, 128, 128);
    // Glowy pink text on a transparent background
    ctx.fillStyle = "#0a0e1a";
    ctx.beginPath();
    ctx.roundRect(8, 38, 112, 52, 8);
    ctx.fill();
    ctx.fillStyle = "#ffaad4";
    ctx.font = "bold 38px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#ff3b88";
    ctx.shadowBlur = 12;
    ctx.fillText("PIZZA", 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const pizzaStickerGeo = new THREE.PlaneGeometry(0.26, 0.13);
  const pizzaStickerMat = new THREE.MeshBasicMaterial({
    map: pizzaStickerTex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });

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
    // Head + hat — grouped so they rotate together when the customer
    // "looks around" while waiting at the counter.
    const head = new THREE.Group();
    head.position.y = 1.15;
    g.add(head);
    const headMesh = new THREE.Mesh(custHeadGeo, matSkinC);
    head.add(headMesh);
    // Hat variety: 60% flat cap, 25% dome/bowler, 15% bareheaded.
    const hatRoll = Math.random();
    if (hatRoll < 0.6) {
      const hat = new THREE.Mesh(custHatGeo, matHat);
      hat.position.y = 0.13;
      head.add(hat);
    } else if (hatRoll < 0.85) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), matHat);
      dome.position.y = 0.04;
      head.add(dome);
    }
    // 15% — no hat at all, head shows bare.
    // Arms — shoulder pivot
    const armL = new THREE.Mesh(custArmGeo, matShirt);
    armL.position.set(-0.2, 0.95, 0);
    g.add(armL);
    const armR = new THREE.Mesh(custArmGeo, matShirt);
    armR.position.set(0.2, 0.95, 0);
    g.add(armR);
    // Pizza box held in both hands — appears only when leaving the shop.
    const pizzaBox = new THREE.Group();
    const boxBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.07, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xe04848, roughness: 0.5 }),
    );
    pizzaBox.add(boxBody);
    const boxLid = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.02, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.6 }),
    );
    boxLid.position.y = 0.045;
    pizzaBox.add(boxLid);
    // Glowy "PIZZA" sticker on the lid — brand-matches the neon sign.
    const sticker = new THREE.Mesh(pizzaStickerGeo, pizzaStickerMat);
    sticker.rotation.x = -Math.PI / 2;
    sticker.position.y = 0.06;
    pizzaBox.add(sticker);
    pizzaBox.position.set(0, 0.85, 0.22); // held in front of torso
    pizzaBox.visible = false;
    g.add(pizzaBox);
    // Spawn from a random edge of the local play area
    const side = Math.random() < 0.5 ? -1 : 1;
    const spawnX = side * (5 + Math.random() * 2);
    const spawnZ = 2.5 + Math.random() * 1.5;
    const spawnPos = new THREE.Vector3(spawnX, GROUND_Y, spawnZ);
    // Queue: take the next free slot so customers form a tidy line.
    const slot = claimQueueSlot();
    const queuePos = slot >= 0
      ? queueSlotPos(slot)
      : new THREE.Vector3((Math.random() - 0.5) * 1.5, GROUND_Y, QUEUE_BASE_Z);
    const exitPos = new THREE.Vector3(-side * (6 + Math.random() * 2), GROUND_Y, 3.2 + Math.random() * 1);
    g.position.copy(spawnPos);
    // Per-customer body scale variation — same height range as real people.
    const bodyScale = 0.85 + Math.random() * 0.3;
    g.scale.setScalar(bodyScale);
    localLayer.add(g);
    return {
      group: g,
      legL, legR, armL, armR, head,
      pizzaBox,
      state: "arriving",
      stateTime: 0,
      queueSlot: slot,
      spawnPos,
      queuePos,
      exitPos,
      headFacing: 0,
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
  // Atmosphere halo — a slightly larger sphere with back-side rendering and
  // additive blend. From the camera you see only the silhouette rim, which
  // reads as an atmospheric glow around the planet.
  const earthHalo = new THREE.Mesh(
    new THREE.SphereGeometry(1.95, 28, 20),
    new THREE.MeshBasicMaterial({
      color: 0x5cb0ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  earth.add(earthHalo);

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

  // ---- Shooting stars ----
  // Pool of 4 streaks that occasionally fly across the cosmic field. Each
  // is an elongated plane with a gradient texture (bright at one end,
  // tapering to transparent) — reads as a meteor trail.
  const shootingStarTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 8;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.7, "rgba(255,250,220,0.85)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 8);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  type ShootingStar = {
    mesh: THREE.Mesh;
    active: boolean;
    life: number;
    duration: number;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
  };
  const shootingStars: ShootingStar[] = [];
  const shootingStarMat = new THREE.MeshBasicMaterial({
    map: shootingStarTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.PlaneGeometry(3.5, 0.18);
    const m = new THREE.Mesh(geo, shootingStarMat.clone());
    m.visible = false;
    cosmicLayer.add(m);
    shootingStars.push({
      mesh: m,
      active: false,
      life: 0,
      duration: 0.9,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
    });
  }
  let nextShootingStarAt = 0;

  function spawnShootingStar(): void {
    const slot = shootingStars.find((s) => !s.active);
    if (!slot) return;
    // Random off-screen origin → opposite side of cosmic field.
    const side = Math.random() < 0.5 ? -1 : 1;
    const startX = side * (12 + Math.random() * 4);
    const startY = 2 + Math.random() * 6;
    const startZ = -8 - Math.random() * 6;
    const endX = -side * (12 + Math.random() * 4);
    const endY = startY - 2 - Math.random() * 3;
    const endZ = startZ + (Math.random() - 0.5) * 3;
    slot.startPos.set(startX, startY, startZ);
    slot.endPos.set(endX, endY, endZ);
    slot.life = 0;
    slot.duration = 0.7 + Math.random() * 0.6;
    slot.active = true;
    slot.mesh.visible = true;
  }

  // Wormhole — drifts behind Earth during cosmic+ phases
  const wormhole = new THREE.Group();
  wormhole.position.set(-6, 1.5, -4);
  wormhole.rotation.set(0.2, -0.4, 0.1);
  cosmicLayer.add(wormhole);
  onModelReady("wormhole", (clone) => {
    clone.scale.setScalar(0.9);
    wormhole.add(clone);
  });

  // Warp distortion rings — three additive emissive tori spinning at
  // different rates and tilts so the wormhole reads as an active portal.
  type WarpRing = { mesh: THREE.Mesh; spinX: number; spinY: number; spinZ: number };
  const warpRings: WarpRing[] = [];
  const warpColors = [0xff4cc9, 0x4cc9f0, 0xff7733];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0 + i * 0.45, 0.06, 8, 64),
      new THREE.MeshBasicMaterial({
        color: warpColors[i],
        transparent: true,
        opacity: 0.7 - i * 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    // Initial tilt offsets
    ring.rotation.x = i * 0.7;
    ring.rotation.y = i * 0.4;
    wormhole.add(ring);
    warpRings.push({
      mesh: ring,
      spinX: 0.3 + i * 0.15,
      spinY: -0.4 + i * 0.2,
      spinZ: 0.5 - i * 0.1,
    });
  }

  // Pizza slices ejected from the wormhole at random intervals.
  const sliceTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 128);
    // Slice = triangle wedge of pizza
    ctx.save();
    ctx.translate(64, 18); // apex near top
    // Crust (outer arc)
    ctx.fillStyle = "#c97a3a";
    ctx.beginPath();
    ctx.moveTo(-60, 105);
    ctx.lineTo(60, 105);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    // Cheese (inner, smaller triangle)
    ctx.fillStyle = "#ffd87a";
    ctx.beginPath();
    ctx.moveTo(-50, 90);
    ctx.lineTo(50, 90);
    ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fill();
    // 3 pepperoni spots
    ctx.fillStyle = "#b22222";
    for (const [px, py, r] of [[-18, 55, 9], [16, 65, 8], [-5, 80, 7]] as Array<[number,number,number]>) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  type WormholeSlice = { sprite: THREE.Sprite; vel: THREE.Vector3; spin: number; life: number; maxLife: number; active: boolean };
  const wormholeSlices: WormholeSlice[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.SpriteMaterial({ map: sliceTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    sp.scale.setScalar(0.8);
    cosmicLayer.add(sp);
    wormholeSlices.push({ sprite: sp, vel: new THREE.Vector3(), spin: 0, life: 0, maxLife: 1, active: false });
  }
  let nextWormholeSliceAt = 0;

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
  // Engine flares at the rear — two emissive cones pointing -X (backward).
  // Stored so the tick can flicker their intensity.
  const flagshipEngineMat = new THREE.MeshBasicMaterial({
    color: 0x4cc9f0, transparent: true, opacity: 0.85, fog: false,
  });
  const flagshipEngines: THREE.Mesh[] = [];
  for (const z of [-0.45, 0.45]) {
    const e = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.6, 12),
      flagshipEngineMat.clone(),
    );
    // Cone default tip at +Y; rotate so tip points -X (out the back).
    e.rotation.z = Math.PI / 2;
    e.position.set(-1.15, 0, z);
    flagship.add(e);
    flagshipEngines.push(e);
  }
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

  type Drone = THREE.Group & { userData: { angle: number; radius: number; speed: number; tilt: number; led?: THREE.Mesh; ledPhase?: number; payload?: THREE.Group; wobblePhase?: number } };
  const drones: Drone[] = [];

  // Shared geos/materials for the drone payload box — created once, reused.
  const droneBoxBodyGeo = new THREE.BoxGeometry(0.32, 0.07, 0.32);
  const droneBoxLidGeo = new THREE.BoxGeometry(0.34, 0.02, 0.34);
  const droneLEDGeo = new THREE.SphereGeometry(0.025, 10, 8);
  const droneBoxBodyMat = new THREE.MeshStandardMaterial({
    color: 0xe04848, emissive: 0x331111, emissiveIntensity: 0.3, roughness: 0.5,
  });
  const droneBoxLidMat = new THREE.MeshStandardMaterial({
    color: 0xf5e6c8, roughness: 0.6,
  });

  function spawnDrone(): void {
    const d = new THREE.Group() as Drone;
    onModelReady("drone", (clone) => {
      clone.scale.setScalar(0.65);
      d.add(clone);
    });
    // Pizza-box payload, hanging below the drone with a small tether line.
    const payload = new THREE.Group();
    const body = new THREE.Mesh(droneBoxBodyGeo, droneBoxBodyMat);
    payload.add(body);
    const lid = new THREE.Mesh(droneBoxLidGeo, droneBoxLidMat);
    lid.position.y = 0.045;
    payload.add(lid);
    // Branded "PIZZA" sticker on the lid, slightly offset from the LED.
    const droneSticker = new THREE.Mesh(pizzaStickerGeo, pizzaStickerMat);
    droneSticker.rotation.x = -Math.PI / 2;
    droneSticker.position.set(-0.04, 0.06, -0.04);
    payload.add(droneSticker);
    // Tiny "delivery in progress" LED on top of the lid — blinks per-drone.
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 1, fog: false });
    const led = new THREE.Mesh(droneLEDGeo, ledMat);
    led.position.set(0.1, 0.07, 0.1);
    payload.add(led);
    // Tether: thin cylinder going up from the box top to the drone body.
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.25, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
    );
    tether.position.y = 0.18;
    payload.add(tether);
    payload.position.y = -0.4;
    d.add(payload);
    d.userData.led = led;
    d.userData.ledPhase = Math.random() * Math.PI * 2;
    d.userData.payload = payload;
    d.userData.wobblePhase = Math.random() * Math.PI * 2;
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

  // ---- Pizza moons ----
  // 4 small pizza discs orbiting the pizza-sun. Each is a mini version
  // of the sun: crust torus + cheese disc + a few pepperoni dots.
  type PizzaMoon = { group: THREE.Group; angle: number; radius: number; speed: number; tilt: number };
  const pizzaMoons: PizzaMoon[] = [];
  const moonCrustMat = new THREE.MeshStandardMaterial({
    color: 0xc97a3a, emissive: 0xff5522, emissiveIntensity: 0.7, roughness: 0.55,
  });
  const moonCheeseMat = new THREE.MeshStandardMaterial({
    color: 0xffd87a, emissive: 0xffb04a, emissiveIntensity: 1.0, roughness: 0.55,
  });
  const moonPepMat = new THREE.MeshStandardMaterial({
    color: 0xb22222, emissive: 0xff3322, emissiveIntensity: 0.5, roughness: 0.5,
  });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Group();
    const moonScale = 0.18 + i * 0.05;
    const crust = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.18, 10, 36),
      moonCrustMat,
    );
    m.add(crust);
    const cheese = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, 0.1, 24),
      moonCheeseMat,
    );
    cheese.rotation.x = Math.PI / 2;
    m.add(cheese);
    // A few pepperoni dots
    for (let p = 0; p < 4; p++) {
      const pep = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12),
        moonPepMat,
      );
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.55;
      pep.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.08);
      pep.rotation.x = Math.PI / 2;
      m.add(pep);
    }
    m.scale.setScalar(moonScale);
    finalLayer.add(m);
    pizzaMoons.push({
      group: m,
      angle: (i / 4) * Math.PI * 2,
      radius: 3.4 + i * 0.9,
      speed: 0.6 - i * 0.08,
      tilt: (Math.random() - 0.5) * 0.6,
    });
  }

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

  // ---- Phase-transition fade overlay ----
  // A black plane attached to the camera, just past the near plane, that
  // fades in and out when phase groups change. Layer visibility swap is
  // deferred to the peak of the fade so the cut happens behind black.
  function phaseGroup(p: Phase): "shop" | "cosmic" | "final" {
    if (p === "shop" || p === "local") return "shop";
    if (p === "final" || p === "credits") return "final";
    return "cosmic";
  }
  const fadeMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
  });
  // Plane added to scene directly; per-frame we reposition it just in front
  // of the camera. This avoids the "child of camera" rendering quirks with
  // the post-processing composer.
  const fadePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fadeMat);
  fadePlane.renderOrder = 9999;
  fadePlane.frustumCulled = false;
  scene.add(fadePlane);

  type FadeState = "idle" | "out" | "in";
  let fadeState: FadeState = "idle";
  // Tracks whether the player has ever been into the cosmic group during
  // THIS scene session. First time triggers a dramatic close-to-Earth start
  // that pulls back to the standard wide view.
  let firstCosmicSeen = false;
  let firstEmpireSeen = false;
  // Seconds remaining in which the camera holds at a dramatic close pose
  // before the normal ease resumes (used for first-cosmic / first-empire).
  let cosmicRevealHold = 0;
  // Camera shake — decaying jitter applied on top of the eased cam position
  // when the player makes a pizza. Updated by subscribe + ticked in the
  // animate loop.
  let shakeTime = 0;
  const SHAKE_DURATION = 0.18;
  // Seed from save: if the player already has slices, they've transcended
  // before and don't need the show.
  try {
    const initial = getState();
    if ((initial.singularitySlices ?? 0) > 0 || initial.phase === "cosmic" || initial.phase === "multiverse" || initial.phase === "timeloop" || initial.phase === "empire") {
      firstCosmicSeen = true;
    }
    // empire-specific reveal: seen if save already has empire credits OR
    // is already in the empire phase.
    if ((initial.empireCredits ?? 0) > 0 || initial.phase === "empire") {
      firstEmpireSeen = true;
    }
  } catch { /* ignore */ }
  let fadeTime = 0;
  const FADE_DURATION = 0.55; // seconds per half
  let pendingPhase: Phase | null = null;

  function startPhaseFade(toPhase: Phase): void {
    pendingPhase = toPhase;
    fadeState = "out";
    fadeTime = 0;
  }

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
      releaseQueueSlot(c.queueSlot);
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
      for (const st of p.steam) st.sprite.visible = showFlames;
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

    // Phase visibility — but if we're mid-fade, hold off until the fade
    // peak so the cut happens under cover of the black overlay.
    const isCrossGroup =
      s.phase !== prevPhase && phaseGroup(s.phase) !== phaseGroup(prevPhase);
    if (isCrossGroup && fadeState === "idle") {
      // Defer the swap — kick off a fade. The "in" half of the fade applies
      // the new layer visibility.
      startPhaseFade(s.phase);
    } else if (!isCrossGroup || fadeState === "in") {
      shopLayer.visible = s.phase === "shop" || s.phase === "local";
      localLayer.visible = s.phase === "shop" || s.phase === "local";
      cosmicLayer.visible = s.phase === "cosmic" || s.phase === "multiverse" || s.phase === "timeloop" || s.phase === "empire";
      multiverseLayer.visible = s.phase === "multiverse";
      timeloopLayer.visible = s.phase === "timeloop";
      empireLayer.visible = s.phase === "empire";
      finalLayer.visible = s.phase === "final" || s.phase === "credits";
    }

    if (s.phase !== prevPhase && fadeState === "idle") {
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

  function spawnParticle(flavor: "make" | "sell", origin?: THREE.Vector3): void {
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
    const ox = origin ? origin.x : 0;
    const oy = origin ? origin.y : counterTopY + 0.3;
    const oz = origin ? origin.z : 0;
    sprite.position.set(
      ox + (Math.random() - 0.5) * spread,
      oy,
      oz + (Math.random() - 0.5) * spread * 0.6,
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
        // Tactile shake — short decaying jitter on the camera.
        shakeTime = SHAKE_DURATION;
      }
    } else if (ev.type === "sell") {
      sellAccum += ev.amount ?? 1;
      if (elapsed - lastSellEmit > 0.15) {
        for (let i = 0; i < Math.min(2, Math.max(1, Math.round(sellAccum))); i++) spawnParticle("sell");
        sellAccum = 0;
        lastSellEmit = elapsed;
        // Pizza pop on sell — pulse the disc(s) that are currently visible.
        const sellTargets: THREE.Object3D[] = [pizza];
        if (pizza2.visible) sellTargets.push(pizza2);
        pulses.push({ targets: sellTargets, startedAt: elapsed });
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
    if (scanlinePass) (scanlinePass.material.uniforms.resolution.value as THREE.Vector2).set(w, h);
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
    } else if (cosmicRevealHold > 0) {
      // First-cosmic dramatic hold: stay at the close-to-Earth pose so
      // the player sees the planet up close, then the ease pulls back.
      cosmicRevealHold -= dt;
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
    // Decaying make-shake — kicks the camera with high-frequency noise then
    // decays linearly over SHAKE_DURATION.
    if (shakeTime > 0) {
      shakeTime = Math.max(0, shakeTime - dt);
      const amp = 0.06 * (shakeTime / SHAKE_DURATION);
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
    }
    tmpLook.copy(camLook);
    camera.lookAt(tmpLook);

    // Pizza spin
    pizza.rotation.y = elapsed * 0.4;
    pizza2.rotation.y = -elapsed * 0.4;
    // Pizza size scales with the current pizzaValue — players SEE their
    // food upgrades on the counter. Log-based so the disc doesn't blow up
    // at high tiers. Eased toward target so upgrades feel like a smooth
    // grow rather than a snap.
    const pizzaValueNow = getState().pizzaValue;
    const targetPizzaScale = 1 + Math.log10(Math.max(1, pizzaValueNow)) * 0.18;
    const newBase = THREE.MathUtils.lerp(
      (pizza.userData.baseScale as number) ?? 1,
      targetPizzaScale,
      Math.min(1, dt * 1.5),
    );
    pizza.userData.baseScale = newBase;
    pizza2.userData.baseScale = newBase;
    // Apply baseScale every frame; the pulse loop further down will
    // override with baseScale * pulseMul if a pulse is currently active.
    pizza.scale.setScalar(newBase);
    pizza2.scale.setScalar(newBase);

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
      // Steam sprite plumes — same loop, larger scale, fading toward top.
      for (const st of p.steam) {
        if (!st.sprite.visible) continue;
        const t = ((elapsed * 0.35 + st.offset) % 1);
        const baseY = (p.smoke[0]?.mesh.userData.baseY as number) ?? 0.8;
        st.sprite.position.y = baseY + t * 1.4;
        // Subtle horizontal drift
        const xWobble = Math.sin(elapsed * 1.5 + st.offset * 6) * 0.08;
        st.sprite.position.x = p.flame.position.x + xWobble;
        st.sprite.material.opacity = (1 - t) * 0.7;
        st.sprite.scale.setScalar(0.45 + t * 0.6);
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
      // Spawn glitter at a random star ~6 times/sec.
      if (elapsed >= nextGlitterAt) {
        const free = glitter.find((g) => !g.active);
        if (free) {
          const star = marketingStars[Math.floor(Math.random() * marketingStars.length)];
          // World position of the star
          const worldPos = new THREE.Vector3();
          star.getWorldPosition(worldPos);
          free.sprite.position.copy(worldPos);
          free.vel.set(
            (Math.random() - 0.5) * 0.3,
            -0.4 - Math.random() * 0.3,
            (Math.random() - 0.5) * 0.3,
          );
          free.life = 0;
          free.maxLife = 0.9 + Math.random() * 0.5;
          free.active = true;
          free.sprite.visible = true;
          free.sprite.scale.setScalar(0.12 + Math.random() * 0.06);
        }
        nextGlitterAt = elapsed + 0.12 + Math.random() * 0.1;
      }
    }
    // Tick active glitter regardless of marketingGroup.visible — they need
    // to finish their lifetime even if the upgrade got toggled off.
    for (const gl of glitter) {
      if (!gl.active) continue;
      gl.life += dt;
      const t = gl.life / gl.maxLife;
      if (t >= 1) {
        gl.active = false;
        gl.sprite.visible = false;
        continue;
      }
      gl.sprite.position.x += gl.vel.x * dt;
      gl.sprite.position.y += gl.vel.y * dt;
      gl.sprite.position.z += gl.vel.z * dt;
      gl.sprite.material.opacity = (1 - t);
    }

    // ---- Purchase pulse tick ----
    // Pulses multiply the target's baseScale (userData.baseScale, default 1)
    // so a target whose base is already > 1 (e.g. the upgrade-grown pizza)
    // still gets the same relative pop.
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pl = pulses[i];
      const t = (elapsed - pl.startedAt) / PULSE_DURATION;
      if (t >= 1) {
        for (const target of pl.targets) {
          const base = (target.userData.baseScale as number) ?? 1;
          target.scale.setScalar(base);
        }
        pulses.splice(i, 1);
        continue;
      }
      // ease 1 -> 1.4 -> 1 (triangular peak at t=0.5)
      const k = t < 0.5 ? t * 2 : (1 - t) * 2;
      const mul = 1 + 0.4 * k;
      for (const target of pl.targets) {
        const base = (target.userData.baseScale as number) ?? 1;
        target.scale.setScalar(base * mul);
      }
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

    // Background traffic — schedule + animate.
    if (shopLayer.visible) {
      if (!carState.active && elapsed >= nextCarAt) {
        spawnCar();
      }
      if (carState.active) {
        carState.progress += dt / carState.duration;
        if (carState.progress >= 1) {
          carState.active = false;
          carBody.visible = false;
          nextCarAt = elapsed + 10 + Math.random() * 8;
        } else {
          const x = carState.startX + (carState.endX - carState.startX) * carState.progress;
          carBody.position.set(x, GROUND_Y, carState.z);
        }
      }
    }

    // City window flicker + rooftop sign spin — only when shop is visible.
    if (shopLayer.visible) {
      for (const bw of blinkWindows) {
        const v = Math.sin(elapsed * (Math.PI * 2 / bw.period) + bw.phase);
        const on = v > -bw.threshold; // "off" only when sine dips below
        const mat = bw.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = on ? 1.6 : 0.05;
      }
      for (const rs of roofSigns) {
        rs.mesh.rotation.y += dt * rs.speed;
      }
      // Dust drift — integrate per-particle, wrap when below ground or out
      // of bounds so the cloud stays full forever.
      const pos = dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < DUST_COUNT; i++) {
        let x = pos.getX(i) + dustVelocities[i * 3 + 0] * dt;
        let y = pos.getY(i) + dustVelocities[i * 3 + 1] * dt;
        let z = pos.getZ(i) + dustVelocities[i * 3 + 2] * dt;
        if (y < GROUND_Y) {
          // Respawn at the top with a fresh horizontal position.
          x = (Math.random() - 0.5) * 8;
          y = GROUND_Y + 3.5;
          z = -1 + Math.random() * 5;
        }
        if (x < -4.5 || x > 4.5) x = -x * 0.95;
        if (z < -1.5 || z > 4.5) z = z < -1.5 ? -1.5 + 0.1 : 4.5 - 0.1;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    // OPEN sign — gentle pendulum sway while shop is visible.
    if (shopLayer.visible) {
      openSignPivot.rotation.z = Math.sin(elapsed * 1.2) * 0.12;
    }

    // Neon pulse
    const neonAmt = Math.sin(elapsed * 3) * 0.4;
    neonGlow.intensity = 1.2 + neonAmt;
    // God-rays follow the same pulse — keeps the beams synced to the sign.
    if (shopLayer.visible) {
      for (const r of godRays) {
        (r.material as THREE.MeshBasicMaterial).opacity = 0.55 + neonAmt * 0.5;
      }
    }
    // Kitchen glow tied to flame intensity — dims out when ovens are off.
    const ovenLit = ovenProps.some((p) => p.flame.visible);
    kitchenGlow.intensity = ovenLit ? 1.6 + Math.sin(elapsed * 6) * 0.3 : 0.0;

    // Kitchen decor animations — chef bob + arm gesture cycle. Each chef
    // rotates through three gestures every ~6 seconds with their personal
    // phase offset:
    //   knead   — alternating arm swings (the original motion)
    //   throw   — both arms reach up, as if tossing dough
    //   stretch — both arms forward, presenting to the customer
    for (let i = 0; i < chefs.length; i++) {
      const c = chefs[i];
      const t = elapsed * 2 + c.phase;
      c.group.position.y = GROUND_Y + Math.sin(t) * 0.03;
      // Gesture window: 0..6s with the chef's phase offset
      const cycle = (elapsed + c.phase) % 6;
      let armLX = 0;
      let armRX = 0;
      if (cycle < 3.2) {
        // Knead — original swing
        armLX = Math.sin(t * 1.5) * 0.6 - 0.4;
        armRX = Math.sin(t * 1.5 + Math.PI) * 0.6 - 0.4;
      } else if (cycle < 4.6) {
        // Throw — arms reach high, slight bob with the dough
        const k = (cycle - 3.2) / 1.4; // 0..1
        // Bow → throw arc → catch
        const lift = Math.sin(k * Math.PI) * 1.6 - 0.2;
        armLX = -lift;
        armRX = -lift;
      } else {
        // Stretch — arms out forward, slight side-to-side
        const k = (cycle - 4.6) / 1.4;
        const sway = Math.sin(k * Math.PI * 2) * 0.15;
        armLX = -0.9 + sway;
        armRX = -0.9 - sway;
      }
      c.armL.rotation.x = armLX;
      c.armR.rotation.x = armRX;

      // Speech bubble cycle: spawn a fresh bubble every nextSpeechAt seconds,
      // each bubble lives speechMaxLife seconds and fades in/out.
      c.speechLife += dt;
      if (c.speechLife > c.nextSpeechAt && c.speechLife > c.speechMaxLife + 2) {
        // Start a new bubble — pick a random phrase, reset the life counter.
        const idx = Math.floor(Math.random() * speechTextures.length);
        c.speechSprite.material.map = speechTextures[idx];
        c.speechSprite.material.needsUpdate = true;
        c.speechLife = 0;
        c.speechMaxLife = 1.4 + Math.random() * 0.8;
        c.nextSpeechAt = c.speechMaxLife + 4 + Math.random() * 6;
      }
      // Apply fade in/out + slight bob
      const sl = c.speechLife;
      if (sl < c.speechMaxLife) {
        const k = sl / c.speechMaxLife;
        // Fade in (0..0.15) then out (0.7..1.0)
        let op = 1;
        if (k < 0.15) op = k / 0.15;
        else if (k > 0.7) op = (1 - k) / 0.3;
        c.speechSprite.material.opacity = Math.max(0, Math.min(1, op));
        c.speechSprite.position.y = 2.2 + Math.sin(elapsed * 4 + c.phase) * 0.05;
      } else {
        c.speechSprite.material.opacity = 0;
      }
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
            // Coin shower — visual signature of the income from this run.
            const coinOrigin = new THREE.Vector3(b.pos.x, b.pos.y + 0.4, b.pos.z);
            for (let n = 0; n < 3; n++) spawnParticle("sell", coinOrigin);
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
            // Got their pizza — hand them the box.
            c.pizzaBox.visible = true;
            // Free the queue slot so the next customer can take it.
            releaseQueueSlot(c.queueSlot);
            c.queueSlot = -1;
            // Shuffle the queue: anyone behind them moves up one slot.
            advanceQueue();
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
            // Hands empty again on the next visit.
            c.pizzaBox.visible = false;
            // Reclaim a queue slot for this visit.
            c.queueSlot = claimQueueSlot();
            if (c.queueSlot >= 0) c.queuePos.copy(queueSlotPos(c.queueSlot));
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
      // Head turn: while waiting, look toward the chef (slightly off-center
      // so people don't all stare at the same spot). Otherwise look straight
      // ahead. The head rotation is in LOCAL space (relative to body facing).
      let targetHead = 0;
      if (c.state === "waiting") {
        // Compute angle from customer position to chef (z=-0.85, x=0..1) in
        // world space, then subtract the body's facing so the head turn is
        // relative.
        const chefX = 0.5;
        const chefZ = -0.85;
        const worldAngle = Math.atan2(chefX - c.group.position.x, chefZ - c.group.position.z);
        let delta = worldAngle - c.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        // Clamp so the head doesn't snap-spin past the shoulders
        delta = Math.max(-1.0, Math.min(1.0, delta));
        // Small idle sway so they don't look like statues
        targetHead = delta + Math.sin(elapsed * 0.7 + c.walkPhase) * 0.12;
      }
      let hDiff = targetHead - c.headFacing;
      while (hDiff > Math.PI) hDiff -= Math.PI * 2;
      while (hDiff < -Math.PI) hDiff += Math.PI * 2;
      c.headFacing += hDiff * Math.min(1, dt * 5);
      c.head.rotation.y = c.headFacing;
    }

    // Cosmic
    if (cosmicLayer.visible) {
      earth.rotation.y = elapsed * 0.15;
      stars.rotation.y = elapsed * 0.005;
      wormhole.rotation.z = elapsed * 0.6;
      // Warp rings spin on independent axes — the portal feels "active".
      for (const r of warpRings) {
        r.mesh.rotation.x += dt * r.spinX;
        r.mesh.rotation.y += dt * r.spinY;
        r.mesh.rotation.z += dt * r.spinZ;
      }
      // Wormhole occasionally ejects a pizza slice.
      if (elapsed >= nextWormholeSliceAt) {
        const slot = wormholeSlices.find((s) => !s.active);
        if (slot) {
          slot.sprite.position.copy(wormhole.position);
          // Random outward direction (mostly toward camera-right)
          const a = Math.random() * Math.PI * 2;
          const speed = 1.2 + Math.random() * 0.8;
          slot.vel.set(
            Math.cos(a) * speed,
            0.4 + Math.random() * 0.4,
            Math.sin(a) * speed * 0.5,
          );
          slot.spin = (Math.random() - 0.5) * 6;
          slot.life = 0;
          slot.maxLife = 2.4 + Math.random() * 1.0;
          slot.active = true;
          slot.sprite.visible = true;
          slot.sprite.material.rotation = Math.random() * Math.PI * 2;
        }
        nextWormholeSliceAt = elapsed + 2 + Math.random() * 3;
      }
      for (const ws of wormholeSlices) {
        if (!ws.active) continue;
        ws.life += dt;
        const t = ws.life / ws.maxLife;
        if (t >= 1) {
          ws.active = false;
          ws.sprite.visible = false;
          continue;
        }
        ws.sprite.position.x += ws.vel.x * dt;
        ws.sprite.position.y += ws.vel.y * dt;
        ws.sprite.position.z += ws.vel.z * dt;
        ws.sprite.material.rotation += ws.spin * dt;
        // Fade-in then fade-out
        const op = t < 0.15 ? t / 0.15 : (1 - t) / 0.85;
        ws.sprite.material.opacity = Math.max(0, Math.min(1, op));
        // Slow shrink toward the end
        const s = 0.8 * (1 - t * 0.4);
        ws.sprite.scale.setScalar(s);
      }
      // Shooting stars: tick active ones, possibly spawn a new one.
      if (elapsed >= nextShootingStarAt) {
        spawnShootingStar();
        nextShootingStarAt = elapsed + 3 + Math.random() * 5;
      }
      for (const ss of shootingStars) {
        if (!ss.active) continue;
        ss.life += dt;
        const k = ss.life / ss.duration;
        if (k >= 1) {
          ss.active = false;
          ss.mesh.visible = false;
          continue;
        }
        ss.mesh.position.lerpVectors(ss.startPos, ss.endPos, k);
        // Orient along travel direction
        const dir = new THREE.Vector3().subVectors(ss.endPos, ss.startPos);
        ss.mesh.lookAt(ss.mesh.position.clone().add(dir));
        // Plane normal default is +Z; we want the long axis along travel.
        // lookAt orients -Z toward the look target → the plane is now
        // perpendicular to the travel direction, which is wrong.
        // Instead: rotate so the plane's +X (width) points along travel.
        const yaw = Math.atan2(dir.x, dir.z);
        ss.mesh.rotation.set(0, yaw + Math.PI / 2, 0);
        const mat = ss.mesh.material as THREE.MeshBasicMaterial;
        // Fade in then out — peak around t=0.3.
        const fade = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
        mat.opacity = Math.max(0, fade);
      }
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
        // Payload LED — fast square-wave blink, per-drone phase.
        if (d.userData.led) {
          const v = Math.sin(elapsed * 4 + (d.userData.ledPhase ?? 0));
          const mat = d.userData.led.material as THREE.MeshBasicMaterial;
          mat.opacity = v > 0 ? 1 : 0.15;
        }
        // Payload wobble — small tilt + bob to suggest the box swings on
        // its tether as the drone changes direction.
        if (d.userData.payload) {
          const wp = d.userData.wobblePhase ?? 0;
          d.userData.payload.rotation.z = Math.sin(elapsed * 2.4 + wp) * 0.18;
          d.userData.payload.rotation.x = Math.cos(elapsed * 1.7 + wp) * 0.12;
          d.userData.payload.position.y = -0.4 + Math.sin(elapsed * 3.1 + wp) * 0.04;
        }
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
        // Engine flicker — opacity pulses + slight scale pump to read as thrust.
        for (let i = 0; i < flagshipEngines.length; i++) {
          const e = flagshipEngines[i];
          const mat = e.material as THREE.MeshBasicMaterial;
          const f = 0.7 + Math.sin(elapsed * 18 + i * 1.4) * 0.25;
          mat.opacity = 0.55 + f * 0.45;
          // Stretch cone a little along its length on intense pulses.
          e.scale.set(1, 1 + (f - 0.7) * 0.8, 1);
        }
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
      // Pizza moons orbit the sun + spin individually.
      for (const m of pizzaMoons) {
        m.angle += dt * m.speed;
        const a = m.angle;
        m.group.position.set(
          Math.cos(a) * m.radius,
          Math.sin(a) * m.radius * 0.4 + m.tilt,
          Math.sin(a * 0.7) * 0.8,
        );
        m.group.rotation.z = -a * 1.5;
      }
    }

    // ---- Phase fade tick ----
    // Park the fade plane just in front of the camera, billboarded to its
    // facing, sized to cover the frustum at that distance regardless of FOV.
    {
      const d = 0.2;
      // Camera forward direction
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fadePlane.position.copy(camera.position).addScaledVector(fwd, d);
      fadePlane.quaternion.copy(camera.quaternion);
      // Cover the frustum at distance d, with margin.
      const halfH = d * Math.tan((camera.fov * Math.PI) / 360);
      const halfW = halfH * camera.aspect;
      fadePlane.scale.set(halfW * 2.4, halfH * 2.4, 1);
    }
    if (fadeState !== "idle") {
      fadeTime += dt;
      const k = Math.min(1, fadeTime / FADE_DURATION);
      if (fadeState === "out") {
        fadeMat.opacity = k;
        if (k >= 1 && pendingPhase) {
          // At peak — swap layer visibility under cover of black.
          const p = pendingPhase;
          shopLayer.visible = p === "shop" || p === "local";
          localLayer.visible = p === "shop" || p === "local";
          cosmicLayer.visible = p === "cosmic" || p === "multiverse" || p === "timeloop" || p === "empire";
          multiverseLayer.visible = p === "multiverse";
          timeloopLayer.visible = p === "timeloop";
          empireLayer.visible = p === "empire";
          finalLayer.visible = p === "final" || p === "credits";
          prevPhase = p;
          pendingPhase = null;
          fadeState = "in";
          fadeTime = 0;
          // Snap camera to the new target so the reveal starts there.
          const newTarget = camTargets[p];
          camPos.copy(newTarget.pos);
          camLook.copy(newTarget.look);
          // ✨ First-cosmic dramatic reveal: drop the camera close to Earth
          // so the post-fade ease has to pull it BACK to the wide view,
          // selling the "you just made the leap to space" moment.
          const isCosmicGroup =
            p === "cosmic" || p === "multiverse" || p === "timeloop" || p === "empire";
          if (isCosmicGroup && !firstCosmicSeen) {
            firstCosmicSeen = true;
            // Earth is at (0, 0.4, 0) — start right next to it.
            camPos.set(0, 1.0, 3.2);
            camLook.set(0, 0.4, 0);
            // Park the camera here for ~0.8s of black before the reveal,
            // then let the normal ease (~1.2/s) pull it back out.
            cosmicRevealHold = 0.8;
          } else if (p === "empire" && !firstEmpireSeen) {
            // ✨ First-empire dramatic reveal: park camera alongside the
            // flagship looking toward the wider fleet, then pull back.
            firstEmpireSeen = true;
            // Flagship is at (-5, 2.5, -1); position camera off its
            // starboard quarter looking forward into the fleet.
            camPos.set(-3.2, 2.8, 0.8);
            camLook.set(-6, 2.5, -1);
            cosmicRevealHold = 0.9;
          }
        }
      } else {
        // "in" — opacity 1 → 0
        fadeMat.opacity = 1 - k;
        if (k >= 1) {
          fadeMat.opacity = 0;
          fadeState = "idle";
        }
      }
    }

    if (chromAberrPass) chromAberrPass.enabled = cosmicLayer.visible;
    if (scanlinePass) scanlinePass.enabled = finalLayer.visible;
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  });

  return { canvas: renderer.domElement };
}

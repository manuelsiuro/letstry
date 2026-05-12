import { Application, Assets, Sprite, Container } from "pixi.js";

const BUNNY_URL = "https://pixijs.com/assets/bunny.png";

export async function startPixiScene(mount: HTMLElement): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#101820",
    resizeTo: mount,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
  });
  mount.appendChild(app.canvas);

  const texture = await Assets.load(BUNNY_URL);

  const world = new Container();
  app.stage.addChild(world);

  const bunny = new Sprite(texture);
  bunny.anchor.set(0.5);
  bunny.scale.set(4);
  world.addChild(bunny);

  const recenter = () => {
    bunny.position.set(app.screen.width / 2, app.screen.height / 2);
  };
  recenter();
  window.addEventListener("resize", recenter);

  app.ticker.add((ticker) => {
    bunny.rotation += 0.02 * ticker.deltaTime;
  });
}

import { startThreeScene } from "./scenes/threeScene";
import { startPixiScene } from "./scenes/pixiScene";

type Engine = "three" | "pixi";

const params = new URLSearchParams(window.location.search);
const engine = (params.get("engine") as Engine) ?? "three";
const mount = document.getElementById("app") as HTMLElement;

if (engine === "pixi") {
  await startPixiScene(mount);
} else {
  startThreeScene(mount);
}

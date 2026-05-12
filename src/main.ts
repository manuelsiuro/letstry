import { startThreeScene } from "./scenes/threeScene";
import { startPixiOverlay } from "./scenes/pixiOverlay";
import { mountHud } from "./ui/hud";
import { loadSaved, startAutosave } from "./game/save";

const mount = document.getElementById("app") as HTMLElement;

loadSaved();
startThreeScene(mount);
await startPixiOverlay(mount);
mountHud();
startAutosave();

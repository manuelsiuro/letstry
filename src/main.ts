import { startThreeScene } from "./scenes/threeScene";
import { startPixiOverlay } from "./scenes/pixiOverlay";
import { mountHud } from "./ui/hud";
import { showMenu } from "./ui/menu";
import { loadSaved, startAutosave } from "./game/save";

const mount = document.getElementById("app") as HTMLElement;

loadSaved();
startThreeScene(mount);
await startPixiOverlay(mount);
await showMenu();
mountHud();
startAutosave();

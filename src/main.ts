import { startThreeScene } from "./scenes/threeScene";
import { startPixiOverlay } from "./scenes/pixiOverlay";
import { mountHud } from "./ui/hud";
import { showMenu } from "./ui/menu";
import { loadSaved, startAutosave, SAVE_KEYS } from "./game/save";
import { initI18n, LOCALE_STORAGE_KEY } from "./i18n";
import { hydrate, isNative } from "./platform/storage";
import { StatusBar, Style } from "@capacitor/status-bar";

const mount = document.getElementById("app") as HTMLElement;

async function bootstrap(): Promise<void> {
  try {
    if (isNative()) {
      try { await hydrate([...SAVE_KEYS, LOCALE_STORAGE_KEY]); } catch (e) { console.error("hydrate failed", e); }
      StatusBar.setStyle({ style: Style.Dark }).catch(() => { /* not available */ });
      StatusBar.setBackgroundColor({ color: "#0a0e1a" }).catch(() => { /* not available */ });
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => { /* not available */ });
      StatusBar.hide().catch(() => { /* not available */ });
    }
    initI18n();
    loadSaved();
  } catch (e) {
    console.error("pre-scene boot failed", e);
  }

  try { startThreeScene(mount); } catch (e) { console.error("three scene failed", e); }
  try { await startPixiOverlay(mount); } catch (e) { console.error("pixi overlay failed", e); }
  try { await showMenu(); } catch (e) { console.error("menu failed", e); }
  try { mountHud(); } catch (e) { console.error("hud failed", e); }
  startAutosave();
}

bootstrap();

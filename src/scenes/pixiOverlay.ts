import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { subscribe, type GameEvent, type GameState } from "../game/state";
import { fmtMoney, fmt } from "../game/format";

export async function startPixiOverlay(mount: HTMLElement): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#000000",
    backgroundAlpha: 0,
    resizeTo: mount,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    // Force WebGL — WebGPU on Android WebView is inconsistent, and Three.js
    // already holds a WebGL context. Asking for the same backend keeps things
    // predictable across web and Capacitor.
    preference: "webgl",
  });
  const canvas = app.canvas;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "5";
  mount.appendChild(canvas);

  const fxLayer = new Container();
  app.stage.addChild(fxLayer);

  const flashLayer = new Container();
  app.stage.addChild(flashLayer);

  function popupAnchor(): { x: number; y: number } {
    // Bottom-center area, where the big button sits on mobile
    const btn = document.getElementById("btn-make");
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const mountRect = mount.getBoundingClientRect();
      return {
        x: rect.left - mountRect.left + rect.width / 2,
        y: rect.top - mountRect.top + rect.height / 2,
      };
    }
    return { x: app.screen.width / 2, y: app.screen.height * 0.7 };
  }

  function spawnText(content: string, color: number, anchor = popupAnchor()): void {
    const style = new TextStyle({
      fontFamily: "system-ui, sans-serif",
      fontSize: 26,
      fontWeight: "700",
      fill: color,
      stroke: { color: 0x000000, width: 3 },
    });
    const t = new Text({ text: content, style });
    t.anchor.set(0.5);
    const jitter = (Math.random() - 0.5) * 80;
    t.x = anchor.x + jitter;
    t.y = anchor.y - 10;
    fxLayer.addChild(t);

    const startY = t.y;
    let life = 0;
    const dur = 0.9;
    const drift = -90 - Math.random() * 30;
    const ticker = (dt: { deltaMS: number }): void => {
      life += dt.deltaMS / 1000;
      const k = Math.min(1, life / dur);
      t.y = startY + drift * k;
      t.alpha = 1 - k;
      t.scale.set(1 + k * 0.4);
      if (k >= 1) {
        app.ticker.remove(ticker);
        fxLayer.removeChild(t);
        t.destroy();
      }
    };
    app.ticker.add(ticker);
  }

  function spawnSparkles(anchor: { x: number; y: number }, color: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.circle(0, 0, 3 + Math.random() * 2).fill({ color });
      g.x = anchor.x;
      g.y = anchor.y;
      fxLayer.addChild(g);
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      let life = 0;
      const dur = 0.7 + Math.random() * 0.3;
      const ticker = (dt: { deltaMS: number }): void => {
        const ds = dt.deltaMS / 1000;
        life += ds;
        g.x += Math.cos(angle) * speed * ds;
        g.y += Math.sin(angle) * speed * ds + life * 80;
        g.alpha = 1 - life / dur;
        if (life >= dur) {
          app.ticker.remove(ticker);
          fxLayer.removeChild(g);
          g.destroy();
        }
      };
      app.ticker.add(ticker);
    }
  }

  function spawnFlash(text: string, color: number): void {
    const overlay = new Graphics();
    overlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color, alpha: 1 });
    flashLayer.addChild(overlay);
    const t = new Text({
      text,
      style: new TextStyle({
        fontFamily: "system-ui, sans-serif",
        fontSize: Math.min(72, app.screen.width / 10),
        fontWeight: "800",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
        align: "center",
      }),
    });
    t.anchor.set(0.5);
    t.x = app.screen.width / 2;
    t.y = app.screen.height / 2;
    flashLayer.addChild(t);

    let life = 0;
    const dur = 1.8;
    const ticker = (dt: { deltaMS: number }): void => {
      life += dt.deltaMS / 1000;
      const k = Math.min(1, life / dur);
      // flash fades fast, text lingers then fades
      overlay.alpha = Math.max(0, 0.7 - k * 1.4);
      if (k < 0.3) t.scale.set(0.6 + k * 2);
      else t.scale.set(1.2);
      t.alpha = k < 0.8 ? 1 : Math.max(0, 1 - (k - 0.8) * 5);
      if (k >= 1) {
        app.ticker.remove(ticker);
        flashLayer.removeChild(overlay);
        flashLayer.removeChild(t);
        overlay.destroy();
        t.destroy();
      }
    };
    app.ticker.add(ticker);
  }

  const phaseTitle: Record<GameState["phase"], { text: string; color: number } | null> = {
    shop: null,
    local: { text: "LOCAL EMPIRE", color: 0xff3b88 },
    cosmic: { text: "INTO THE COSMOS", color: 0x4cc9f0 },
    final: { text: "THE FINAL RECIPE", color: 0xffaa44 },
    credits: { text: "YOU ARE THE PIZZA", color: 0xffffff },
    multiverse: { text: "MULTIVERSE BAKERY", color: 0xc79bff },
    timeloop: { text: "TIME LOOP KITCHEN", color: 0x4cc9f0 },
    empire: { text: "GALACTIC EMPIRE", color: 0xffd54a },
  };

  subscribe((s: GameState, ev?: GameEvent) => {
    if (!ev) return;
    if (ev.type === "make") {
      spawnText("+1", 0xf2c46d);
    } else if (ev.type === "sell" && ev.amount) {
      spawnText("+" + fmtMoney(ev.amount), 0x9be36b);
    } else if (ev.type === "buy") {
      const anchor = popupAnchor();
      spawnSparkles({ x: anchor.x, y: anchor.y - 40 }, 0xffd54a, 18);
      spawnText("UPGRADE!", 0xffd54a, { x: anchor.x, y: anchor.y - 60 });
    } else if (ev.type === "phase") {
      const meta = phaseTitle[ev.phase ?? s.phase];
      if (meta) spawnFlash(meta.text, meta.color);
    } else if (ev.type === "transcend") {
      spawnFlash("+" + fmt(ev.amount ?? 0) + " SINGULARITY", 0xffffff);
    }
  });
}

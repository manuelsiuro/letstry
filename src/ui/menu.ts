import QRCode from "qrcode";
import { clearSave } from "../game/save";
import { hardReset } from "../game/state";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildPlayUrl(): string {
  const port = window.location.port || "5173";
  const proto = window.location.protocol;
  return `${proto}//${__LAN_IP__}:${port}/`;
}

function hasSave(): boolean {
  try {
    return localStorage.getItem("cosmic-pizza:v1") !== null;
  } catch {
    return false;
  }
}

export function showMenu(): Promise<void> {
  return new Promise((resolve) => {
    const root = el("div");
    root.id = "menu-root";

    const card = el("div", "menu-card");

    const logo = el("img", "menu-logo");
    logo.src = "/assets/generated/cosmic-pizza-logo.png";
    logo.alt = "Cosmic Pizza Delivery";
    const tagline = el(
      "p",
      "menu-tagline",
      "Tap. Bake. Automate. Conquer the cosmos one slice at a time.",
    );

    const playBtn = el("button", "menu-play", hasSave() ? "▶ CONTINUE" : "▶ PLAY");

    const qrSection = el("div", "menu-qr-section");
    const qrLabel = el("div", "menu-qr-label", "Play on mobile");
    const qrCanvas = document.createElement("canvas");
    qrCanvas.className = "menu-qr";
    const url = buildPlayUrl();
    const qrUrl = el("a", "menu-qr-url");
    qrUrl.href = url;
    qrUrl.target = "_blank";
    qrUrl.rel = "noopener";
    qrUrl.textContent = url;
    qrSection.append(qrLabel, qrCanvas, qrUrl);

    // Reset save (only show if there's something to wipe)
    const footer = el("div", "menu-footer");
    if (hasSave()) {
      const resetLink = el("button", "menu-reset", "Reset save");
      resetLink.addEventListener("click", () => {
        if (!confirm("Wipe your save and start fresh?")) return;
        clearSave();
        hardReset();
        playBtn.textContent = "▶ PLAY";
        resetLink.remove();
      });
      footer.append(resetLink);
    }
    const credit = el("div", "menu-credit", "Three.js + PixiJS + a little dough");
    footer.append(credit);

    card.append(logo, tagline, playBtn, qrSection, footer);
    root.append(card);
    document.body.append(root);

    QRCode.toCanvas(qrCanvas, url, {
      width: 200,
      margin: 1,
      color: { dark: "#0a0e1a", light: "#ffffffff" },
    }).catch(() => {
      qrCanvas.style.display = "none";
      qrLabel.textContent = "QR unavailable";
    });

    playBtn.addEventListener("click", () => {
      root.classList.add("hiding");
      setTimeout(() => {
        root.remove();
        resolve();
      }, 400);
    });
  });
}

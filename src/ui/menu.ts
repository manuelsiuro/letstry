import QRCode from "qrcode";
import { clearSave } from "../game/save";
import { hardReset } from "../game/state";
import { t, getLocale, setLocale, type Locale } from "../i18n";

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
    return localStorage.getItem("cosmic-pizza:v1") !== null
      || localStorage.getItem("cosmic-pizza:v2") !== null;
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
    const tagline = el("p", "menu-tagline", t("menu.tagline"));

    const playBtn = el("button", "menu-play", hasSave() ? t("menu.continue") : t("menu.play"));

    // Language toggle (EN / FR)
    const langRow = el("div", "menu-lang");
    const makeLangBtn = (code: Locale, label: string): HTMLButtonElement => {
      const b = el("button", "menu-lang-pill", label);
      if (getLocale() === code) b.classList.add("active");
      b.addEventListener("click", () => {
        setLocale(code);
        for (const c of langRow.children) c.classList.remove("active");
        b.classList.add("active");
        tagline.textContent = t("menu.tagline");
        playBtn.textContent = hasSave() ? t("menu.continue") : t("menu.play");
        qrLabel.textContent = t("menu.mobile");
        if (resetLink) resetLink.textContent = t("menu.reset");
      });
      return b;
    };
    langRow.append(makeLangBtn("en", "EN"), makeLangBtn("fr", "FR"));

    const qrSection = el("div", "menu-qr-section");
    const qrLabel = el("div", "menu-qr-label", t("menu.mobile"));
    const qrCanvas = document.createElement("canvas");
    qrCanvas.className = "menu-qr";
    const url = buildPlayUrl();
    const qrUrl = el("a", "menu-qr-url");
    qrUrl.href = url;
    qrUrl.target = "_blank";
    qrUrl.rel = "noopener";
    qrUrl.textContent = url;
    qrSection.append(qrLabel, qrCanvas, qrUrl);

    const footer = el("div", "menu-footer");
    let resetLink: HTMLButtonElement | null = null;
    if (hasSave()) {
      resetLink = el("button", "menu-reset", t("menu.reset"));
      resetLink.addEventListener("click", () => {
        if (!confirm(t("menu.resetConfirm"))) return;
        clearSave();
        hardReset();
        playBtn.textContent = t("menu.play");
        resetLink?.remove();
        resetLink = null;
      });
      footer.append(resetLink);
    }
    const credit = el("div", "menu-credit", t("menu.credit"));
    footer.append(credit);

    card.append(logo, tagline, langRow, playBtn, qrSection, footer);
    root.append(card);
    document.body.append(root);

    QRCode.toCanvas(qrCanvas, url, {
      width: 200,
      margin: 1,
      color: { dark: "#0a0e1a", light: "#ffffffff" },
    }).catch(() => {
      qrCanvas.style.display = "none";
      qrLabel.textContent = t("menu.qrUnavailable");
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

import { subscribe, getState, clickMake, clickSell, buyUpgrade, transcend, hardReset, type GameState } from "../game/state";
import { UPGRADES, canAfford, isUnlocked, nextCost, nextDescKey, maxLevel, type UpgradeDef, type UpgradeCost } from "../game/upgrades";
import { fmt, fmtMoney, fmtInt } from "../game/format";
import { sfxClick, sfxSell, sfxBuy, sfxPhase, sfxTranscend, toggleMute, isMuted } from "../audio/sfx";
import { clearSave } from "../game/save";
import { iconImg, iconHtml, type IconName } from "./icons";
import { t, getLocale, setLocale, onLocaleChange, type Locale } from "../i18n";
import { isNative } from "../platform/storage";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

function tapHaptic(): void {
  if (!isNative()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => { /* not available */ });
}
function buyHaptic(): void {
  if (!isNative()) return;
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { /* not available */ });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
function romanize(n: number): string {
  return ROMAN[n] ?? String(n);
}

interface StatRow {
  root: HTMLElement;
  value: HTMLElement;
  labelText: Text;
}

function makeStat(labelKey: string, id: string, icon?: IconName): StatRow {
  const root = el("div", "stat");
  root.id = "stat-" + id;
  const value = el("div", "stat-value", "0");
  const label = el("div", "stat-label");
  if (icon) label.appendChild(iconImg(icon, "ui-icon ui-icon-sm"));
  const labelText = document.createTextNode(icon ? " " + t(labelKey) : t(labelKey));
  label.appendChild(labelText);
  root.appendChild(value);
  root.appendChild(label);
  return { root, value, labelText };
}

export function mountHud(): void {
  const root = el("div");
  root.id = "hud-root";

  // Top stats bar
  const topBar = el("div");
  topBar.id = "hud-top";

  const stMoney = makeStat("hud.money", "money", "dollar");
  const stStock = makeStat("hud.stock", "stock", "pizza");
  const stRep = makeStat("hud.rep", "rep", "star");
  const stCosmic = makeStat("hud.cosmic", "cosmic", "cosmic");
  const stSlices = makeStat("hud.slices", "slices", "swirl");
  const stShards = makeStat("hud.shards", "shards", "swirl");
  const stCrystals = makeStat("hud.crystals", "crystals", "cosmic");
  const stCredits = makeStat("hud.credits", "credits", "star");

  topBar.append(
    stMoney.root,
    stStock.root,
    stRep.root,
    stCosmic.root,
    stSlices.root,
    stShards.root,
    stCrystals.root,
    stCredits.root,
  );
  root.appendChild(topBar);

  // Phase title (small)
  const phaseLabel = el("div", "phase-label", t("phase.shop"));
  root.appendChild(phaseLabel);

  // Toast container
  const toastBox = el("div");
  toastBox.id = "toast-box";
  root.appendChild(toastBox);

  // Bottom controls
  const bottomBar = el("div");
  bottomBar.id = "hud-bottom";

  // Upgrade column
  const upgradeList = el("div");
  upgradeList.id = "upgrade-list";
  bottomBar.appendChild(upgradeList);

  // Buttons column
  const buttonCol = el("div");
  buttonCol.id = "button-col";
  const btnMake = el("button", "btn btn-make");
  btnMake.id = "btn-make";
  const btnMakeLabel = document.createTextNode(" " + t("hud.make"));
  btnMake.append(iconImg("pizza", "ui-icon ui-icon-btn"), btnMakeLabel);

  const btnSell = el("button", "btn btn-sell");
  btnSell.id = "btn-sell";
  const btnSellLabel = document.createTextNode(" " + t("hud.sell"));
  btnSell.append(iconImg("money", "ui-icon ui-icon-btn"), btnSellLabel);

  const btnTranscend = el("button", "btn btn-transcend");
  btnTranscend.id = "btn-transcend";
  const btnTranscendLabel = document.createTextNode(" " + t("hud.transcend") + " ");
  btnTranscend.append(
    iconImg("cosmic", "ui-icon ui-icon-btn"),
    btnTranscendLabel,
    iconImg("cosmic", "ui-icon ui-icon-btn"),
  );
  btnTranscend.style.display = "none";
  buttonCol.append(btnMake, btnSell, btnTranscend);
  bottomBar.appendChild(buttonCol);

  root.appendChild(bottomBar);

  // Corner menu (mute + settings)
  const cornerMenu = el("div");
  cornerMenu.id = "corner-menu";
  const btnMute = el("button", "icon-btn icon-btn-img");
  btnMute.title = t("hud.mute");
  btnMute.appendChild(iconImg("audio-on", "ui-icon ui-icon-corner"));
  const btnSettings = el("button", "icon-btn", "⚙");
  btnSettings.title = t("settings.title");
  cornerMenu.append(btnMute, btnSettings);
  root.appendChild(cornerMenu);

  document.body.appendChild(root);

  // Fade HUD in after the cinematic intro pan finishes. Returning players
  // (totalEarned > 0) skip the intro so the HUD shows immediately.
  const st = getState();
  if ((st.totalEarned ?? 0) > 0) {
    root.style.opacity = "1";
  } else {
    root.style.opacity = "0";
    root.style.transition = "opacity 0.6s ease-in";
    // Game-start fires when the player dismisses the menu. The threeScene
    // intro lasts ~3.2s; wait 2.5s so the HUD pops in just as the camera
    // is settling into the standard framing.
    window.addEventListener("game-start", () => {
      setTimeout(() => { root.style.opacity = "1"; }, 2500);
    }, { once: true });
  }

  // ---- Wiring ----
  btnMake.addEventListener("click", () => {
    clickMake();
    sfxClick();
    tapHaptic();
  });
  btnSell.addEventListener("click", () => {
    if (clickSell()) {
      sfxSell();
      tapHaptic();
    }
  });
  btnTranscend.addEventListener("click", () => {
    sfxTranscend();
    transcend();
  });
  btnMute.addEventListener("click", () => {
    const m = toggleMute();
    btnMute.replaceChildren(iconImg(m ? "audio-off" : "audio-on", "ui-icon ui-icon-corner"));
  });
  btnSettings.addEventListener("click", () => {
    openSettings();
  });

  // Keyboard shortcut for desktop
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      clickMake();
      sfxClick();
    } else if (e.code === "Enter") {
      if (clickSell()) sfxSell();
    }
  });

  // ---- Upgrade cards ----
  interface CardEntry {
    root: HTMLButtonElement;
    name: HTMLElement;
    desc: HTMLElement;
    cost: HTMLElement;
    cta: HTMLElement;
    def: UpgradeDef;
  }
  const upgradeCards = new Map<string, CardEntry>();

  function buildCard(def: UpgradeDef): CardEntry {
    const card = el("button", "upgrade-card tier-" + def.tier);
    card.dataset.id = def.id;
    card.type = "button";

    const header = el("div", "upg-header");
    const icon = iconImg(def.icon as IconName, "ui-icon upg-icon");
    const name = el("div", "upg-name", t(def.nameKey));
    header.append(icon, name);

    const desc = el("div", "upg-desc", t(def.descKey));

    const footer = el("div", "upg-footer");
    const cost = el("div", "upg-cost", "");
    const cta = el("div", "upg-cta", t("card.buy"));
    footer.append(cost, cta);

    card.append(header, desc, footer);
    card.addEventListener("click", () => {
      if (buyUpgrade(def.id)) {
        sfxBuy();
        buyHaptic();
      }
    });
    return { root: card, name, desc, cost, cta, def };
  }

  function fmtCost(cost: UpgradeCost): string {
    const parts: string[] = [];
    if (cost.money) parts.push('<span class="chip chip-money">' + fmtMoney(cost.money) + '</span>');
    if (cost.reputation) parts.push('<span class="chip chip-rep">' + cost.reputation + " " + iconHtml("star", "ui-icon ui-icon-sm") + "</span>");
    if (cost.cosmicDough) parts.push('<span class="chip chip-cosmic">' + fmt(cost.cosmicDough) + " " + iconHtml("cosmic", "ui-icon ui-icon-sm") + "</span>");
    if (cost.multiverseShards) parts.push('<span class="chip chip-cosmic">' + fmt(cost.multiverseShards) + " " + iconHtml("swirl", "ui-icon ui-icon-sm") + "</span>");
    if (cost.timeCrystals) parts.push('<span class="chip chip-cosmic">' + fmt(cost.timeCrystals) + " " + iconHtml("cosmic", "ui-icon ui-icon-sm") + "</span>");
    if (cost.empireCredits) parts.push('<span class="chip chip-rep">' + fmt(cost.empireCredits) + " " + iconHtml("star", "ui-icon ui-icon-sm") + "</span>");
    return parts.join(" ");
  }

  // ---- Toasts ----
  function toast(message: string): void {
    const tEl = el("div", "toast", message);
    toastBox.appendChild(tEl);
    setTimeout(() => tEl.classList.add("show"), 10);
    setTimeout(() => {
      tEl.classList.remove("show");
      setTimeout(() => tEl.remove(), 400);
    }, 2400);
  }

  // ---- Settings panel ----
  function openSettings(): void {
    const overlay = el("div");
    overlay.id = "settings-overlay";
    const panel = el("div", "settings-panel");

    const title = el("h2", "settings-title", t("settings.title"));
    panel.appendChild(title);

    // Language row
    const langRow = el("div", "settings-row");
    langRow.appendChild(el("div", "settings-label", t("settings.language")));
    const langOptions = el("div", "settings-options");
    const makeLangBtn = (code: Locale, label: string): HTMLButtonElement => {
      const b = el("button", "settings-pill", label);
      if (getLocale() === code) b.classList.add("active");
      b.addEventListener("click", () => {
        setLocale(code);
        for (const c of langOptions.children) c.classList.remove("active");
        b.classList.add("active");
      });
      return b;
    };
    langOptions.append(makeLangBtn("en", "English"), makeLangBtn("fr", "Français"));
    langRow.appendChild(langOptions);
    panel.appendChild(langRow);

    // Audio row
    const audioRow = el("div", "settings-row");
    audioRow.appendChild(el("div", "settings-label", t("settings.audio")));
    const audioBtn = el("button", "settings-pill", isMuted() ? t("settings.audioOff") : t("settings.audioOn"));
    audioBtn.classList.toggle("active", !isMuted());
    audioBtn.addEventListener("click", () => {
      const m = toggleMute();
      audioBtn.textContent = m ? t("settings.audioOff") : t("settings.audioOn");
      audioBtn.classList.toggle("active", !m);
      btnMute.replaceChildren(iconImg(m ? "audio-off" : "audio-on", "ui-icon ui-icon-corner"));
    });
    audioRow.appendChild(audioBtn);
    panel.appendChild(audioRow);

    // About row
    const aboutRow = el("div", "settings-row settings-about");
    aboutRow.appendChild(el("div", "settings-label", t("settings.about")));
    aboutRow.appendChild(el("div", "settings-about-text", t("settings.aboutText")));
    panel.appendChild(aboutRow);

    // Reset
    const resetBtn = el("button", "settings-danger", t("settings.reset"));
    resetBtn.addEventListener("click", () => {
      if (!confirm(t("hud.resetConfirm"))) return;
      clearSave();
      hardReset();
      overlay.remove();
    });
    panel.appendChild(resetBtn);

    // Close
    const closeBtn = el("button", "settings-close", t("settings.close"));
    closeBtn.addEventListener("click", () => overlay.remove());
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  // ---- Locale-driven label refresh ----
  function phaseName(phase: GameState["phase"]): string {
    return t("phase." + phase);
  }

  function refreshStaticLabels(): void {
    stMoney.labelText.nodeValue = " " + t("hud.money");
    stStock.labelText.nodeValue = " " + t("hud.stock");
    stRep.labelText.nodeValue = " " + t("hud.rep");
    stCosmic.labelText.nodeValue = " " + t("hud.cosmic");
    stSlices.labelText.nodeValue = " " + t("hud.slices");
    btnMakeLabel.nodeValue = " " + t("hud.make");
    btnSellLabel.nodeValue = " " + t("hud.sell");
    btnTranscendLabel.nodeValue = " " + t("hud.transcend") + " ";
    btnMute.title = t("hud.mute");
    btnSettings.title = t("settings.title");
    phaseLabel.textContent = phaseName(getState().phase);
    for (const [id, entry] of upgradeCards) {
      void id;
      entry.name.textContent = t(entry.def.nameKey);
      entry.desc.textContent = t(entry.def.descKey);
      entry.cta.textContent = t("card.buy");
    }
  }
  onLocaleChange(refreshStaticLabels);

  // ---- Update from state ----
  let lastPhase: GameState["phase"] | null = null;
  const knownUnlocks = new Set<string>();

  subscribe((s, ev) => {
    stMoney.value.textContent = fmtMoney(s.money);
    stStock.value.textContent = fmtInt(s.stock);
    stRep.value.textContent = s.reputation.toFixed(0) + "/" + s.reputationCap;
    stCosmic.value.textContent = fmt(s.cosmicDough);
    stSlices.value.textContent = fmtInt(s.singularitySlices);
    stShards.value.textContent = fmtInt(s.multiverseShards);
    stCrystals.value.textContent = fmtInt(s.timeCrystals);
    stCredits.value.textContent = fmtInt(s.empireCredits);

    if (s.phase !== lastPhase) {
      phaseLabel.textContent = phaseName(s.phase);
      if (lastPhase !== null && ev?.type === "phase") {
        sfxPhase();
        toast(t("toast.phase", { name: phaseName(s.phase) }));
      }
      lastPhase = s.phase;
    }

    btnSell.style.display = s.upgradesOwned.bike ? "none" : "";
    btnTranscend.style.display = s.phase === "final" ? "" : "none";
    btnMake.style.display = s.phase === "credits" ? "none" : "";

    stCosmic.root.style.display = s.upgradesOwned.cosmic ? "" : "none";
    stSlices.root.style.display = s.singularitySlices > 0 || s.phase === "credits" ? "" : "none";
    stShards.root.style.display = s.multiverseShards > 0 || s.upgradesOwned.rift ? "" : "none";
    stCrystals.root.style.display = s.timeCrystals > 0 || s.upgradesOwned.chrono ? "" : "none";
    stCredits.root.style.display = s.empireCredits > 0 || s.upgradesOwned.crown ? "" : "none";

    for (const def of UPGRADES) {
      const lvl = s.upgradeLevel[def.id] ?? 0;
      const max = maxLevel(def);
      const maxed = lvl >= max;
      const visible = !maxed && isUnlocked(s, def);
      let entry = upgradeCards.get(def.id);
      if (!entry && visible) {
        entry = buildCard(def);
        upgradeCards.set(def.id, entry);
        upgradeList.appendChild(entry.root);
        if (!knownUnlocks.has(def.id)) {
          knownUnlocks.add(def.id);
          toast(t("toast.newUpgrade", { name: t(def.nameKey) }));
        }
      }
      if (entry) {
        if (maxed) {
          entry.root.remove();
          upgradeCards.delete(def.id);
        } else if (!visible) {
          entry.root.style.display = "none";
        } else {
          entry.root.style.display = "";
          const cost = nextCost(def, lvl);
          if (!cost) {
            entry.root.style.display = "none";
            continue;
          }
          entry.cost.innerHTML = fmtCost(cost);
          entry.desc.textContent = t(nextDescKey(def, lvl));
          // Tier badge in the name when leveling past base
          if (max > 1) {
            const nextLevel = lvl + 1;
            entry.name.textContent = t(def.nameKey) + " · " + romanize(nextLevel);
          } else {
            entry.name.textContent = t(def.nameKey);
          }
          const affordable = canAfford(s, cost);
          entry.root.disabled = !affordable;
          entry.root.classList.toggle("affordable", affordable);
        }
      }
    }
  });

  btnMute.replaceChildren(iconImg(isMuted() ? "audio-off" : "audio-on", "ui-icon ui-icon-corner"));

  void getState;
}

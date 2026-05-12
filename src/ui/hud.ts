import { subscribe, getState, clickMake, clickSell, buyUpgrade, transcend, hardReset, type GameState } from "../game/state";
import { UPGRADES, canAfford, isUnlocked, type UpgradeDef } from "../game/upgrades";
import { fmt, fmtMoney, fmtInt } from "../game/format";
import { sfxClick, sfxSell, sfxBuy, sfxPhase, sfxTranscend, toggleMute, isMuted } from "../audio/sfx";
import { clearSave } from "../game/save";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface StatRow {
  root: HTMLElement;
  value: HTMLElement;
  label: HTMLElement;
}

function makeStat(labelText: string, id: string): StatRow {
  const root = el("div", "stat");
  root.id = "stat-" + id;
  const value = el("div", "stat-value", "0");
  const label = el("div", "stat-label", labelText);
  root.appendChild(value);
  root.appendChild(label);
  return { root, value, label };
}

export function mountHud(): void {
  const root = el("div");
  root.id = "hud-root";

  // Top stats bar
  const topBar = el("div");
  topBar.id = "hud-top";

  const stMoney = makeStat("$", "money");
  const stStock = makeStat("🍕 stock", "stock");
  const stRep = makeStat("⭐ rep", "rep");
  const stCosmic = makeStat("✨ cosmic", "cosmic");
  const stSlices = makeStat("🌀 slices", "slices");

  topBar.append(stMoney.root, stStock.root, stRep.root, stCosmic.root, stSlices.root);
  root.appendChild(topBar);

  // Phase title (small)
  const phaseLabel = el("div", "phase-label", "Corner Pizzeria");
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
  const btnMake = el("button", "btn btn-make", "🍕 Make Pizza");
  btnMake.id = "btn-make";
  const btnSell = el("button", "btn btn-sell", "💵 Sell 1");
  btnSell.id = "btn-sell";
  const btnTranscend = el("button", "btn btn-transcend", "✨ BECOME THE PIZZA ✨");
  btnTranscend.id = "btn-transcend";
  btnTranscend.style.display = "none";
  buttonCol.append(btnMake, btnSell, btnTranscend);
  bottomBar.appendChild(buttonCol);

  root.appendChild(bottomBar);

  // Corner menu
  const cornerMenu = el("div");
  cornerMenu.id = "corner-menu";
  const btnMute = el("button", "icon-btn", "🔊");
  btnMute.title = "mute";
  const btnReset = el("button", "icon-btn", "↻");
  btnReset.title = "reset save";
  cornerMenu.append(btnMute, btnReset);
  root.appendChild(cornerMenu);

  document.body.appendChild(root);

  // ---- Wiring ----
  btnMake.addEventListener("click", () => {
    clickMake();
    sfxClick();
  });
  btnSell.addEventListener("click", () => {
    if (clickSell()) sfxSell();
  });
  btnTranscend.addEventListener("click", () => {
    sfxTranscend();
    transcend();
  });
  btnMute.addEventListener("click", () => {
    const m = toggleMute();
    btnMute.textContent = m ? "🔇" : "🔊";
  });
  btnReset.addEventListener("click", () => {
    if (!confirm("Wipe your save and start over? (Singularity Slices will be lost.)")) return;
    clearSave();
    hardReset();
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
    cost: HTMLElement;
  }
  const upgradeCards = new Map<string, CardEntry>();

  function buildCard(def: UpgradeDef): CardEntry {
    const card = el("button", "upgrade-card tier-" + def.tier);
    card.dataset.id = def.id;
    card.type = "button";

    const header = el("div", "upg-header");
    const icon = el("div", "upg-icon", def.icon);
    const name = el("div", "upg-name", def.name);
    header.append(icon, name);

    const desc = el("div", "upg-desc", def.desc);

    const footer = el("div", "upg-footer");
    const cost = el("div", "upg-cost", "");
    const cta = el("div", "upg-cta", "BUY ›");
    footer.append(cost, cta);

    card.append(header, desc, footer);
    card.addEventListener("click", () => {
      if (buyUpgrade(def.id)) sfxBuy();
    });
    return { root: card, cost };
  }

  function fmtCost(def: UpgradeDef): string {
    const parts: string[] = [];
    if (def.cost.money) parts.push('<span class="chip chip-money">' + fmtMoney(def.cost.money) + '</span>');
    if (def.cost.reputation) parts.push('<span class="chip chip-rep">' + def.cost.reputation + " ⭐</span>");
    if (def.cost.cosmicDough) parts.push('<span class="chip chip-cosmic">' + fmt(def.cost.cosmicDough) + " ✨</span>");
    return parts.join(" ");
  }

  // ---- Toasts ----
  function toast(message: string): void {
    const t = el("div", "toast", message);
    toastBox.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 400);
    }, 2400);
  }

  // ---- Update from state ----
  let lastPhase: GameState["phase"] | null = null;
  const knownUnlocks = new Set<string>();

  const phaseNames: Record<GameState["phase"], string> = {
    shop: "Corner Pizzeria",
    local: "Local Empire",
    cosmic: "Cosmic Expansion",
    final: "The Final Recipe",
    credits: "Transcendence…",
  };

  subscribe((s, ev) => {
    stMoney.value.textContent = fmtMoney(s.money);
    stStock.value.textContent = fmtInt(s.stock);
    stRep.value.textContent = s.reputation.toFixed(0) + "/" + s.reputationCap;
    stCosmic.value.textContent = fmt(s.cosmicDough);
    stSlices.value.textContent = fmtInt(s.singularitySlices);

    if (s.phase !== lastPhase) {
      phaseLabel.textContent = phaseNames[s.phase];
      if (lastPhase !== null && ev?.type === "phase") {
        sfxPhase();
        toast("Phase: " + phaseNames[s.phase]);
      }
      lastPhase = s.phase;
    }

    // Show/hide sell button: hide once bike (auto-sell)
    btnSell.style.display = s.upgradesOwned.bike ? "none" : "";

    // Transcend button
    btnTranscend.style.display = s.phase === "final" ? "" : "none";
    btnMake.style.display = s.phase === "credits" ? "none" : "";

    // Cosmic stat visibility
    stCosmic.root.style.display = s.upgradesOwned.cosmic ? "" : "none";
    stSlices.root.style.display = s.singularitySlices > 0 || s.phase === "credits" ? "" : "none";

    // Upgrade list — build/show cards
    for (const def of UPGRADES) {
      const owned = s.upgradesOwned[def.id];
      const visible = !owned && isUnlocked(s, def);
      let entry = upgradeCards.get(def.id);
      if (!entry && visible) {
        entry = buildCard(def);
        upgradeCards.set(def.id, entry);
        upgradeList.appendChild(entry.root);
        if (!knownUnlocks.has(def.id)) {
          knownUnlocks.add(def.id);
          toast("New upgrade: " + def.name);
        }
      }
      if (entry) {
        if (owned) {
          entry.root.remove();
          upgradeCards.delete(def.id);
        } else if (!visible) {
          entry.root.style.display = "none";
        } else {
          entry.root.style.display = "";
          entry.cost.innerHTML = fmtCost(def);
          const affordable = canAfford(s, def.cost);
          entry.root.disabled = !affordable;
          entry.root.classList.toggle("affordable", affordable);
        }
      }
    }
  });

  // Initial mute label
  btnMute.textContent = isMuted() ? "🔇" : "🔊";

  // Suppress noUnusedLocals on getState (used by other modules anyway)
  void getState;
}

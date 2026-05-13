import { UPGRADES, canAfford, nextCost, maxLevel, type UpgradeDef } from "./upgrades";

export type Phase =
  | "shop"
  | "local"
  | "cosmic"
  | "final"
  | "credits"
  | "multiverse"
  | "timeloop"
  | "empire";

export interface GameState {
  money: number;
  stock: number;
  reputation: number;
  cosmicDough: number;
  singularitySlices: number;
  multiverseShards: number;
  timeCrystals: number;
  empireCredits: number;
  /** Legacy v1 field — kept in sync with upgradeLevel for any external readers. */
  upgradesOwned: Record<string, boolean>;
  /** Current level per upgrade. 0 = not owned; 1+ = owned. Tiered upgrades go up to maxLevel(def). */
  upgradeLevel: Record<string, number>;
  phase: Phase;
  totalPizzasMade: number;
  totalEarned: number;
  startedAt: number;
  endingTriggered: boolean;
  prestigeBonus: number;
  lastSavedAt: number;
  saveVersion: number;
  // derived (recomputed by recalc)
  pizzaValue: number;
  productionPerSec: number;
  sellPerSec: number;
  reputationGain: number;
  reputationCap: number;
  cosmicDoughPerSec: number;
}

export interface GameEvent {
  type: "make" | "sell" | "buy" | "phase" | "transcend";
  amount?: number;
  upgradeId?: string;
  phase?: Phase;
}

type Listener = (state: GameState, event?: GameEvent) => void;

const listeners = new Set<Listener>();

export function freshState(prestigeBonus = 1): GameState {
  const s: GameState = {
    money: 0,
    stock: 0,
    reputation: 5,
    cosmicDough: 0,
    singularitySlices: 0,
    multiverseShards: 0,
    timeCrystals: 0,
    empireCredits: 0,
    upgradesOwned: {},
    upgradeLevel: {},
    phase: "shop",
    totalPizzasMade: 0,
    totalEarned: 0,
    startedAt: Date.now(),
    endingTriggered: false,
    prestigeBonus,
    lastSavedAt: Date.now(),
    saveVersion: 2,
    pizzaValue: 1,
    productionPerSec: 0,
    sellPerSec: 0,
    reputationGain: 0,
    reputationCap: 50,
    cosmicDoughPerSec: 0,
  };
  recalc(s);
  return s;
}

let state: GameState = freshState();

export function getState(): GameState {
  return state;
}

export function setState(next: GameState): void {
  state = next;
  syncOwnedFromLevel(state);
  recalc(state);
  emit();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit(event?: GameEvent): void {
  for (const l of listeners) l(state, event);
}

function syncOwnedFromLevel(s: GameState): void {
  for (const def of UPGRADES) {
    const lvl = s.upgradeLevel[def.id] ?? 0;
    s.upgradesOwned[def.id] = lvl >= 1;
  }
}

function lvl(s: GameState, id: string): number {
  return s.upgradeLevel[id] ?? 0;
}

export function recalc(s: GameState): void {
  let value = 1;
  if (lvl(s, "dough") >= 1) value *= 1.25;
  if (lvl(s, "cheese") >= 1) value *= 1.5;
  if (lvl(s, "echo") >= 1) value *= 2;
  if (lvl(s, "fractal") >= 1) value *= 3;
  if (lvl(s, "empire") >= 1) value *= 100;
  s.pizzaValue = value * s.prestigeBonus * (1 + s.multiverseShards * 0.0);

  let prod = 0;
  const ovenLvl = lvl(s, "oven");
  if (ovenLvl >= 1) prod += 0.5;
  if (ovenLvl >= 2) prod *= 1.5;
  if (ovenLvl >= 3) prod *= 2;
  if (lvl(s, "kitchen") >= 1) prod *= 2;
  if (lvl(s, "bots") >= 1) prod *= 5;
  if (lvl(s, "parallel") >= 1) prod *= 10 * Math.max(1, s.multiverseShards);
  if (lvl(s, "echo") >= 1) prod *= 3;
  if (lvl(s, "fractal") >= 1) prod *= 5;
  if (lvl(s, "colony") >= 1) prod *= 20;
  s.productionPerSec = prod;

  let sell = 0;
  const bikeLvl = lvl(s, "bike");
  if (bikeLvl >= 1) sell += 2;
  if (bikeLvl >= 2) sell *= 1.5;
  if (bikeLvl >= 3) sell *= 2;
  if (lvl(s, "bots") >= 1) sell *= 3;
  if (lvl(s, "drones") >= 1) sell *= 4;
  if (lvl(s, "tachyon") >= 1) sell *= 10;
  if (lvl(s, "fleet") >= 1) sell *= 20;
  s.sellPerSec = sell;

  const mktLvl = lvl(s, "marketing");
  s.reputationGain = mktLvl >= 1 ? 1 : 0;
  if (mktLvl >= 3) s.reputationGain *= 2;
  if (lvl(s, "precog") >= 1) s.reputationGain *= 5;
  s.reputationCap = mktLvl >= 1 ? 100 : 50;
  if (mktLvl >= 2) s.reputationCap += 50;

  let cosmic = 0;
  if (lvl(s, "cosmic") >= 1) cosmic = 0.2;
  const droneLvl = lvl(s, "drones");
  if (droneLvl >= 1) cosmic *= 5;
  if (droneLvl >= 2) cosmic *= 2;
  if (droneLvl >= 3) cosmic *= 2;
  s.cosmicDoughPerSec = cosmic;

  if (lvl(s, "singularity") >= 1) {
    const mult = Math.pow(2, Math.max(1, s.multiverseShards));
    s.pizzaValue *= mult;
    s.productionPerSec *= mult;
    s.sellPerSec *= mult;
    s.cosmicDoughPerSec *= mult;
  }
}

function deriveSalePrice(s: GameState): number {
  return s.pizzaValue * (1 + s.reputation / 100);
}

export function clickMake(): void {
  state.stock += 1;
  state.totalPizzasMade += 1;
  emit({ type: "make", amount: 1 });
  maybePhaseShift();
}

export function clickSell(): boolean {
  if (state.stock < 1) return false;
  const price = deriveSalePrice(state);
  state.stock -= 1;
  state.money += price;
  state.totalEarned += price;
  emit({ type: "sell", amount: price });
  return true;
}

export function buyUpgrade(id: string): boolean {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return false;
  const current = lvl(state, id);
  if (current >= maxLevel(def)) return false;
  const cost = nextCost(def, current);
  if (!cost || !canAfford(state, cost)) return false;
  if (cost.money) state.money -= cost.money;
  if (cost.reputation) state.reputation -= cost.reputation;
  if (cost.cosmicDough) state.cosmicDough -= cost.cosmicDough;
  if (cost.multiverseShards) state.multiverseShards -= cost.multiverseShards;
  if (cost.timeCrystals) state.timeCrystals -= cost.timeCrystals;
  if (cost.empireCredits) state.empireCredits -= cost.empireCredits;
  state.upgradeLevel[id] = current + 1;
  state.upgradesOwned[id] = true;
  if (current === 0) applySpecial(def);
  recalc(state);
  emit({ type: "buy", upgradeId: id });
  maybePhaseShift();
  return true;
}

function applySpecial(def: UpgradeDef): void {
  if (def.id === "cosmic") {
    state.cosmicDough += 1;
    state.phase = "cosmic";
    emit({ type: "phase", phase: "cosmic" });
  }
  if (def.id === "wormhole") {
    state.phase = "final";
    emit({ type: "phase", phase: "final" });
  }
  if (def.id === "rift") {
    state.multiverseShards += 1;
  }
  if (def.id === "chrono") {
    state.timeCrystals += 1;
    state.phase = "timeloop";
    emit({ type: "phase", phase: "timeloop" });
  }
  if (def.id === "eternal") {
    state.prestigeBonus *= 2;
  }
  if (def.id === "fleet") {
    state.phase = "empire";
    emit({ type: "phase", phase: "empire" });
  }
  if (def.id === "crown") {
    state.empireCredits += 1;
  }
}

function maybePhaseShift(): void {
  const next: Phase = state.phase === "shop" && state.upgradesOwned.oven ? "local" : state.phase;
  if (next !== state.phase) {
    state.phase = next;
    emit({ type: "phase", phase: next });
  }
}

export function transcend(): void {
  if (state.phase !== "final") return;
  const earned = 1 + Math.floor(Math.log10(Math.max(state.totalEarned, 1)) - 4);
  const slices = Math.max(1, earned);
  // Multiverse shards rewarded on transcend once "rift" is unlocked.
  const shardReward = state.upgradesOwned.rift ? Math.max(1, Math.floor(slices / 2)) : 0;
  // Time crystals on transcend if chrono unlocked.
  const crystalReward = state.upgradesOwned.chrono ? Math.max(1, Math.floor(slices / 5)) : 0;
  // Empire credits on transcend if crown unlocked.
  const creditReward = state.upgradesOwned.crown ? Math.max(1, Math.floor(slices / 10)) : 0;
  const newBonus = state.prestigeBonus + slices * 0.5;
  state.phase = "credits";
  state.endingTriggered = true;
  emit({ type: "transcend", amount: slices });
  setTimeout(() => {
    const next = freshState(newBonus);
    next.singularitySlices = state.singularitySlices + slices;
    next.multiverseShards = state.multiverseShards + shardReward;
    next.timeCrystals = state.timeCrystals + crystalReward;
    next.empireCredits = state.empireCredits + creditReward;
    // First transcend opens the multiverse-side progression.
    if (next.multiverseShards > 0) {
      next.phase = "multiverse";
    }
    state = next;
    syncOwnedFromLevel(state);
    recalc(state);
    emit({ type: "phase", phase: state.phase });
  }, 4000);
}

export function hardReset(): void {
  state = freshState(1);
  emit();
}

export function tick(dtSec: number): void {
  if (state.productionPerSec > 0) {
    state.stock += state.productionPerSec * dtSec;
    state.totalPizzasMade += state.productionPerSec * dtSec;
  }

  // Rewind counter keeps stock from depleting below 100
  if (state.upgradesOwned.rewind && state.stock < 100) state.stock = 100;

  if (state.sellPerSec > 0 && state.stock > 0) {
    const wantSell = Math.min(state.stock, state.sellPerSec * dtSec);
    const price = deriveSalePrice(state);
    state.stock -= wantSell;
    state.money += wantSell * price;
    state.totalEarned += wantSell * price;
  }

  if (state.reputationGain > 0 && state.reputation < state.reputationCap) {
    state.reputation = Math.min(
      state.reputationCap,
      state.reputation + state.reputationGain * dtSec,
    );
  } else if (!state.upgradesOwned.marketing && state.reputation > 5) {
    state.reputation = Math.max(5, state.reputation - 0.1 * dtSec);
  }

  if (state.cosmicDoughPerSec > 0) {
    state.cosmicDough += state.cosmicDoughPerSec * dtSec;
  }

  emit();
}

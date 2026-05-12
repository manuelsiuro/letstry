import { UPGRADES, canAfford, type UpgradeDef } from "./upgrades";

export type Phase = "shop" | "local" | "cosmic" | "final" | "credits";

export interface GameState {
  money: number;
  stock: number;
  reputation: number;
  cosmicDough: number;
  singularitySlices: number;
  upgradesOwned: Record<string, boolean>;
  phase: Phase;
  totalPizzasMade: number;
  totalEarned: number;
  startedAt: number;
  endingTriggered: boolean;
  prestigeBonus: number;
  lastSavedAt: number;
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
    upgradesOwned: {},
    phase: "shop",
    totalPizzasMade: 0,
    totalEarned: 0,
    startedAt: Date.now(),
    endingTriggered: false,
    prestigeBonus,
    lastSavedAt: Date.now(),
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

export function recalc(s: GameState): void {
  let value = 1;
  if (s.upgradesOwned.dough) value *= 1.25;
  if (s.upgradesOwned.cheese) value *= 1.5;
  s.pizzaValue = value * s.prestigeBonus;

  let prod = 0;
  if (s.upgradesOwned.oven) prod += 0.5;
  if (s.upgradesOwned.kitchen) prod *= 2;
  if (s.upgradesOwned.bots) prod *= 5;
  s.productionPerSec = prod;

  let sell = 0;
  if (s.upgradesOwned.bike) sell += 2;
  if (s.upgradesOwned.bots) sell *= 3;
  if (s.upgradesOwned.drones) sell *= 4;
  s.sellPerSec = sell;

  s.reputationGain = s.upgradesOwned.marketing ? 1 : 0;
  s.reputationCap = s.upgradesOwned.marketing ? 100 : 50;

  let cosmic = 0;
  if (s.upgradesOwned.cosmic) cosmic = 0.2;
  if (s.upgradesOwned.drones) cosmic *= 5;
  s.cosmicDoughPerSec = cosmic;
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
  if (state.upgradesOwned[id]) return false;
  if (!canAfford(state, def.cost)) return false;
  if (def.cost.money) state.money -= def.cost.money;
  if (def.cost.reputation) state.reputation -= def.cost.reputation;
  if (def.cost.cosmicDough) state.cosmicDough -= def.cost.cosmicDough;
  state.upgradesOwned[id] = true;
  applySpecial(def);
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
}

function maybePhaseShift(): void {
  const owned = state.upgradesOwned;
  let next: Phase = state.phase;
  if (state.phase === "shop" && owned.oven) next = "local";
  if (next !== state.phase) {
    state.phase = next;
    emit({ type: "phase", phase: next });
  }
}

export function transcend(): void {
  if (state.phase !== "final") return;
  const earned = 1 + Math.floor(Math.log10(Math.max(state.totalEarned, 1)) - 4);
  const slices = Math.max(1, earned);
  const newBonus = state.prestigeBonus + slices * 0.5;
  state.phase = "credits";
  state.endingTriggered = true;
  emit({ type: "transcend", amount: slices });
  setTimeout(() => {
    const next = freshState(newBonus);
    next.singularitySlices = state.singularitySlices + slices;
    state = next;
    emit({ type: "phase", phase: "shop" });
  }, 4000);
}

export function hardReset(): void {
  state = freshState(1);
  emit();
}

export function tick(dtSec: number): void {
  const owned = state.upgradesOwned;

  if (state.productionPerSec > 0) {
    state.stock += state.productionPerSec * dtSec;
    state.totalPizzasMade += state.productionPerSec * dtSec;
  }

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
  } else if (!owned.marketing && state.reputation > 5) {
    state.reputation = Math.max(5, state.reputation - 0.1 * dtSec);
  }

  if (state.cosmicDoughPerSec > 0) {
    state.cosmicDough += state.cosmicDoughPerSec * dtSec;
  }

  emit();
}

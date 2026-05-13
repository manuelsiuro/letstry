import type { GameState, Phase } from "./state";

export interface UpgradeCost {
  money?: number;
  reputation?: number;
  cosmicDough?: number;
  multiverseShards?: number;
  timeCrystals?: number;
  empireCredits?: number;
}

export type UpgradeTier =
  | "food"
  | "auto"
  | "marketing"
  | "cosmic"
  | "multiverse"
  | "timeloop"
  | "empire";

export interface UpgradeStep {
  cost: UpgradeCost;
  descKey: string;
}

export interface UpgradeDef {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
  tier: UpgradeTier;
  cost: UpgradeCost;
  requires?: string[];
  unlockPhase?: Phase;
  /** Additional levels past the base purchase. Level 1 = base; Level N = base + tiers[N-2]. */
  tiers?: UpgradeStep[];
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "dough",
    nameKey: "upgrade.dough.name",
    descKey: "upgrade.dough.desc",
    icon: "dough",
    tier: "food",
    cost: { money: 25 },
  },
  {
    id: "cheese",
    nameKey: "upgrade.cheese.name",
    descKey: "upgrade.cheese.desc",
    icon: "cheese",
    tier: "food",
    cost: { money: 150 },
    requires: ["dough"],
  },
  {
    id: "oven",
    nameKey: "upgrade.oven.name",
    descKey: "upgrade.oven.desc",
    icon: "fire",
    tier: "auto",
    cost: { money: 500 },
    requires: ["dough"],
    tiers: [
      { cost: { money: 4000 }, descKey: "upgrade.oven.tier2.desc" },
      { cost: { money: 25000 }, descKey: "upgrade.oven.tier3.desc" },
    ],
  },
  {
    id: "bike",
    nameKey: "upgrade.bike.name",
    descKey: "upgrade.bike.desc",
    icon: "bike",
    tier: "auto",
    cost: { money: 1200 },
    requires: ["oven"],
    tiers: [
      { cost: { money: 12000 }, descKey: "upgrade.bike.tier2.desc" },
      { cost: { money: 60000 }, descKey: "upgrade.bike.tier3.desc" },
    ],
  },
  {
    id: "kitchen",
    nameKey: "upgrade.kitchen.name",
    descKey: "upgrade.kitchen.desc",
    icon: "store",
    tier: "auto",
    cost: { money: 5000 },
    requires: ["oven"],
  },
  {
    id: "marketing",
    nameKey: "upgrade.marketing.name",
    descKey: "upgrade.marketing.desc",
    icon: "megaphone",
    tier: "marketing",
    cost: { money: 15000 },
    requires: ["bike"],
    tiers: [
      { cost: { money: 60000 }, descKey: "upgrade.marketing.tier2.desc" },
      { cost: { money: 200000, reputation: 60 }, descKey: "upgrade.marketing.tier3.desc" },
    ],
  },
  {
    id: "bots",
    nameKey: "upgrade.bots.name",
    descKey: "upgrade.bots.desc",
    icon: "robot",
    tier: "marketing",
    cost: { money: 80000 },
    requires: ["kitchen"],
  },
  {
    id: "cosmic",
    nameKey: "upgrade.cosmic.name",
    descKey: "upgrade.cosmic.desc",
    icon: "cosmic",
    tier: "cosmic",
    cost: { money: 500000, reputation: 80 },
    requires: ["marketing", "bots"],
  },
  {
    id: "drones",
    nameKey: "upgrade.drones.name",
    descKey: "upgrade.drones.desc",
    icon: "drone",
    tier: "cosmic",
    cost: { cosmicDough: 3 },
    requires: ["cosmic"],
    unlockPhase: "cosmic",
    tiers: [
      { cost: { cosmicDough: 15 }, descKey: "upgrade.drones.tier2.desc" },
      { cost: { cosmicDough: 60 }, descKey: "upgrade.drones.tier3.desc" },
    ],
  },
  {
    id: "wormhole",
    nameKey: "upgrade.wormhole.name",
    descKey: "upgrade.wormhole.desc",
    icon: "wormhole",
    tier: "cosmic",
    cost: { cosmicDough: 50 },
    requires: ["drones"],
    unlockPhase: "cosmic",
  },
  // ---- Multiverse phase ----
  {
    id: "rift",
    nameKey: "upgrade.rift.name",
    descKey: "upgrade.rift.desc",
    icon: "swirl",
    tier: "multiverse",
    cost: { cosmicDough: 100 },
    requires: ["wormhole"],
    unlockPhase: "multiverse",
  },
  {
    id: "parallel",
    nameKey: "upgrade.parallel.name",
    descKey: "upgrade.parallel.desc",
    icon: "store",
    tier: "multiverse",
    cost: { multiverseShards: 1 },
    requires: ["rift"],
    unlockPhase: "multiverse",
  },
  {
    id: "echo",
    nameKey: "upgrade.echo.name",
    descKey: "upgrade.echo.desc",
    icon: "robot",
    tier: "multiverse",
    cost: { multiverseShards: 3 },
    requires: ["parallel"],
    unlockPhase: "multiverse",
  },
  {
    id: "fractal",
    nameKey: "upgrade.fractal.name",
    descKey: "upgrade.fractal.desc",
    icon: "fire",
    tier: "multiverse",
    cost: { multiverseShards: 8 },
    requires: ["echo"],
    unlockPhase: "multiverse",
  },
  {
    id: "singularity",
    nameKey: "upgrade.singularity.name",
    descKey: "upgrade.singularity.desc",
    icon: "cosmic",
    tier: "multiverse",
    cost: { multiverseShards: 20 },
    requires: ["fractal"],
    unlockPhase: "multiverse",
  },
  // ---- Time-loop phase ----
  {
    id: "chrono",
    nameKey: "upgrade.chrono.name",
    descKey: "upgrade.chrono.desc",
    icon: "swirl",
    tier: "timeloop",
    cost: { multiverseShards: 50 },
    requires: ["singularity"],
    unlockPhase: "timeloop",
  },
  {
    id: "rewind",
    nameKey: "upgrade.rewind.name",
    descKey: "upgrade.rewind.desc",
    icon: "pizza",
    tier: "timeloop",
    cost: { timeCrystals: 1 },
    requires: ["chrono"],
    unlockPhase: "timeloop",
  },
  {
    id: "precog",
    nameKey: "upgrade.precog.name",
    descKey: "upgrade.precog.desc",
    icon: "megaphone",
    tier: "timeloop",
    cost: { timeCrystals: 3 },
    requires: ["rewind"],
    unlockPhase: "timeloop",
  },
  {
    id: "tachyon",
    nameKey: "upgrade.tachyon.name",
    descKey: "upgrade.tachyon.desc",
    icon: "drone",
    tier: "timeloop",
    cost: { timeCrystals: 8 },
    requires: ["precog"],
    unlockPhase: "timeloop",
  },
  {
    id: "eternal",
    nameKey: "upgrade.eternal.name",
    descKey: "upgrade.eternal.desc",
    icon: "swirl",
    tier: "timeloop",
    cost: { timeCrystals: 20 },
    requires: ["tachyon"],
    unlockPhase: "timeloop",
  },
  // ---- Empire phase ----
  {
    id: "fleet",
    nameKey: "upgrade.fleet.name",
    descKey: "upgrade.fleet.desc",
    icon: "bike",
    tier: "empire",
    cost: { timeCrystals: 50 },
    requires: ["eternal"],
    unlockPhase: "empire",
  },
  {
    id: "colony",
    nameKey: "upgrade.colony.name",
    descKey: "upgrade.colony.desc",
    icon: "store",
    tier: "empire",
    cost: { empireCredits: 1 },
    requires: ["fleet"],
    unlockPhase: "empire",
  },
  {
    id: "empire",
    nameKey: "upgrade.empire.name",
    descKey: "upgrade.empire.desc",
    icon: "cosmic",
    tier: "empire",
    cost: { empireCredits: 3 },
    requires: ["colony"],
    unlockPhase: "empire",
  },
  {
    id: "crown",
    nameKey: "upgrade.crown.name",
    descKey: "upgrade.crown.desc",
    icon: "star",
    tier: "empire",
    cost: { empireCredits: 8 },
    requires: ["empire"],
    unlockPhase: "empire",
  },
  {
    id: "omega",
    nameKey: "upgrade.omega.name",
    descKey: "upgrade.omega.desc",
    icon: "wormhole",
    tier: "empire",
    cost: { empireCredits: 30 },
    requires: ["crown"],
    unlockPhase: "empire",
  },
];

export function maxLevel(def: UpgradeDef): number {
  return 1 + (def.tiers?.length ?? 0);
}

/** Cost to advance from `current` level to `current+1`. Returns null if maxed. */
export function nextCost(def: UpgradeDef, current: number): UpgradeCost | null {
  const max = maxLevel(def);
  if (current >= max) return null;
  if (current === 0) return def.cost;
  return def.tiers?.[current - 1]?.cost ?? null;
}

/** descKey for the *next* level (what the player is about to buy). */
export function nextDescKey(def: UpgradeDef, current: number): string {
  if (current === 0) return def.descKey;
  return def.tiers?.[current - 1]?.descKey ?? def.descKey;
}

export function canAfford(state: GameState, cost: UpgradeCost): boolean {
  if (cost.money && state.money < cost.money) return false;
  if (cost.reputation && state.reputation < cost.reputation) return false;
  if (cost.cosmicDough && state.cosmicDough < cost.cosmicDough) return false;
  if (cost.multiverseShards && state.multiverseShards < cost.multiverseShards) return false;
  if (cost.timeCrystals && state.timeCrystals < cost.timeCrystals) return false;
  if (cost.empireCredits && state.empireCredits < cost.empireCredits) return false;
  return true;
}

/** Visible in the upgrade list — not yet maxed AND prerequisites satisfied AND phase reached. */
export function isUnlocked(state: GameState, def: UpgradeDef): boolean {
  if ((state.upgradeLevel[def.id] ?? 0) >= maxLevel(def)) return false;
  if (def.requires && !def.requires.every((id) => (state.upgradeLevel[id] ?? 0) >= 1)) return false;
  if (def.unlockPhase) {
    const order: Phase[] = ["shop", "local", "cosmic", "final", "credits", "multiverse", "timeloop", "empire"];
    // Treat unlockPhase as a minimum: shop < local < cosmic < final < (credits ↔ multiverse) < timeloop < empire.
    // For pre-credits phases this is the existing behavior.
    if (def.unlockPhase === "cosmic" && state.phase === "shop") return false;
    if (def.unlockPhase === "multiverse" && order.indexOf(state.phase) < order.indexOf("multiverse")) {
      // Multiverse unlocks after the first transcend (we set phase to "multiverse" there)
      return false;
    }
    if (def.unlockPhase === "timeloop" && order.indexOf(state.phase) < order.indexOf("timeloop")) return false;
    if (def.unlockPhase === "empire" && order.indexOf(state.phase) < order.indexOf("empire")) return false;
  }
  return true;
}

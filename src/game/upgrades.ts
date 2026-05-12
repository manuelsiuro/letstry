import type { GameState } from "./state";

export interface UpgradeCost {
  money?: number;
  reputation?: number;
  cosmicDough?: number;
}

export type UpgradeTier = "food" | "auto" | "marketing" | "cosmic";

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tier: UpgradeTier;
  cost: UpgradeCost;
  requires?: string[];
  unlockPhase?: GameState["phase"];
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "dough",
    name: "Hand-Tossed Dough",
    desc: "Pizza value ×1.25",
    icon: "dough",
    tier: "food",
    cost: { money: 25 },
  },
  {
    id: "cheese",
    name: "Premium Mozzarella",
    desc: "Pizza value ×1.5",
    icon: "cheese",
    tier: "food",
    cost: { money: 150 },
    requires: ["dough"],
  },
  {
    id: "oven",
    name: "Brick Oven",
    desc: "Auto-makes 0.5 pizza/s",
    icon: "fire",
    tier: "auto",
    cost: { money: 500 },
    requires: ["dough"],
  },
  {
    id: "bike",
    name: "Delivery Bike",
    desc: "Auto-sells 2 pizza/s",
    icon: "bike",
    tier: "auto",
    cost: { money: 1200 },
    requires: ["oven"],
  },
  {
    id: "kitchen",
    name: "Second Kitchen",
    desc: "Production ×2",
    icon: "store",
    tier: "auto",
    cost: { money: 5000 },
    requires: ["oven"],
  },
  {
    id: "marketing",
    name: "Marketing Blitz",
    desc: "+Reputation/s (cap 100)",
    icon: "megaphone",
    tier: "marketing",
    cost: { money: 15000 },
    requires: ["bike"],
  },
  {
    id: "bots",
    name: "Auto-Cook Bots",
    desc: "Production ×5, sell ×3",
    icon: "robot",
    tier: "marketing",
    cost: { money: 80000 },
    requires: ["kitchen"],
  },
  {
    id: "cosmic",
    name: "Cosmic Recipe",
    desc: "Unlock the cosmos. +0.2 cosmic/s",
    icon: "cosmic",
    tier: "cosmic",
    cost: { money: 500000, reputation: 80 },
    requires: ["marketing", "bots"],
  },
  {
    id: "drones",
    name: "Delivery Drones",
    desc: "Cosmic income ×5, sell ×4",
    icon: "drone",
    tier: "cosmic",
    cost: { cosmicDough: 3 },
    requires: ["cosmic"],
    unlockPhase: "cosmic",
  },
  {
    id: "wormhole",
    name: "Wormhole Oven",
    desc: "The Final Recipe. Endgame.",
    icon: "wormhole",
    tier: "cosmic",
    cost: { cosmicDough: 50 },
    requires: ["drones"],
    unlockPhase: "cosmic",
  },
];

export function canAfford(state: GameState, cost: UpgradeCost): boolean {
  if (cost.money && state.money < cost.money) return false;
  if (cost.reputation && state.reputation < cost.reputation) return false;
  if (cost.cosmicDough && state.cosmicDough < cost.cosmicDough) return false;
  return true;
}

export function isUnlocked(state: GameState, def: UpgradeDef): boolean {
  if (state.upgradesOwned[def.id]) return false;
  if (def.requires && !def.requires.every((id) => state.upgradesOwned[id])) return false;
  if (def.unlockPhase === "cosmic" && state.phase === "shop") return false;
  return true;
}

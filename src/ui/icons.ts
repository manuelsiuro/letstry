export type IconName =
  | "pizza"
  | "star"
  | "money"
  | "dollar"
  | "cosmic"
  | "swirl"
  | "wormhole"
  | "audio-on"
  | "audio-off"
  | "dough"
  | "cheese"
  | "fire"
  | "bike"
  | "store"
  | "megaphone"
  | "robot"
  | "drone";

export function iconImg(name: IconName, cls = "ui-icon"): HTMLImageElement {
  const img = document.createElement("img");
  img.src = `/assets/icons/${name}.png`;
  img.alt = "";
  img.className = cls;
  img.draggable = false;
  return img;
}

export function iconHtml(name: IconName, cls = "ui-icon"): string {
  return `<img class="${cls}" src="/assets/icons/${name}.png" alt="" draggable="false">`;
}

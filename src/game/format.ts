const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

export function fmt(n: number, digits = 1): string {
  if (!isFinite(n)) return "∞";
  if (n < 0) return "-" + fmt(-n, digits);
  if (n < 1000) return n < 10 ? n.toFixed(n < 1 ? 2 : 1).replace(/\.0+$/, "") : Math.floor(n).toString();
  const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
  const scaled = n / Math.pow(10, tier * 3);
  return scaled.toFixed(digits) + SUFFIXES[tier];
}

export function fmtMoney(n: number): string {
  return "$" + fmt(n);
}

export function fmtInt(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  return fmt(n);
}

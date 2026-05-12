import { tick } from "./state";

const STEP_SEC = 0.1; // 10 Hz sim tick
const MAX_ACCUM = 1.0;

let accumulator = 0;

export function advance(deltaSec: number): void {
  accumulator += Math.min(deltaSec, MAX_ACCUM);
  while (accumulator >= STEP_SEC) {
    tick(STEP_SEC);
    accumulator -= STEP_SEC;
  }
}

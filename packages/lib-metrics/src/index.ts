// @brain/lib-metrics — v1 internal contract exports.
// CF-C2-PRIMITIVE-1: single TS home for all money primitives; Child 4 imports from here.
// DO NOT re-export from an alternate path — the Single-Primitive Rule requires ONE home.

export type { Money } from './money.js';
export { makeMoney } from './money.js';

export { decimalToMinorUnits } from './convert.js';

export { ratioToBasisPoints } from './ratio.js';

export { subunitMultiplier } from './subunits.js';

export type { GoalType, GoalValue } from './goal-type.js';

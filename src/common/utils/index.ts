// src/common/utils/index.ts
import Decimal from 'decimal.js';
import { customAlphabet } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── ID generators ───────────────────────────────────────────────────────────

const betRefAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 10);
const bookingAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
const idempotencyAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 32);

export const generateBetRef = (): string => `BET-${betRefAlphabet()}`;
export const generateBookingCode = (): string => bookingAlphabet();
export const generateIdempotencyKey = (): string => idempotencyAlphabet();
export const generateUuid = (): string => uuidv4();

// ─── Odds calculations ────────────────────────────────────────────────────────

/**
 * Calculate combined odds for a multi-bet (accumulator)
 */
export function calculateCombinedOdds(oddsArr: number[]): Decimal {
  return oddsArr.reduce(
    (acc, odds) => acc.mul(new Decimal(odds)),
    new Decimal(1),
  );
}

/**
 * Calculate potential winnings
 */
export function calculatePotentialWin(stake: number, combinedOdds: number): Decimal {
  return new Decimal(stake).mul(new Decimal(combinedOdds));
}

/**
 * Convert decimal odds to implied probability
 */
export function decimalOddsToProb(odds: number): Decimal {
  return new Decimal(1).div(new Decimal(odds));
}

/**
 * Convert American odds to decimal
 */
export function americanToDecimal(americanOdds: number): Decimal {
  if (americanOdds > 0) {
    return new Decimal(americanOdds).div(100).add(1);
  }
  return new Decimal(100).div(new Decimal(Math.abs(americanOdds))).add(1);
}

/**
 * Convert decimal to American odds
 */
export function decimalToAmerican(decimalOdds: number): number {
  const d = new Decimal(decimalOdds);
  if (d.gte(2)) {
    return d.sub(1).mul(100).toNumber();
  }
  return new Decimal(-100).div(d.sub(1)).toNumber();
}

/**
 * Convert decimal to fractional string
 */
export function decimalToFractional(decimalOdds: number): string {
  const decimal = new Decimal(decimalOdds).sub(1);
  const denominator = 100;
  const numerator = decimal.mul(denominator).toNumber();
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(numerator), denominator);
  return `${Math.round(numerator) / g}/${denominator / g}`;
}

/**
 * Calculate cashout value for a bet
 */
export function calculateCashoutValue(
  stake: number,
  originalOdds: number,
  currentOdds: number,
  margin: number = 0.05,
): Decimal {
  const stakeD = new Decimal(stake);
  const originalOddsD = new Decimal(originalOdds);
  const currentOddsD = new Decimal(currentOdds);
  const marginD = new Decimal(1).sub(margin);

  // cashout = (stake * original_odds) / current_odds * margin
  return stakeD.mul(originalOddsD).div(currentOddsD).mul(marginD);
}

/**
 * Calculate cashout value for partial cashout
 */
export function calculatePartialCashoutValue(
  stake: number,
  cashoutPercentage: number,
  originalOdds: number,
  currentOdds: number,
  margin: number = 0.05,
): { cashoutAmount: Decimal; remainingStake: Decimal } {
  const partialStake = new Decimal(stake).mul(cashoutPercentage / 100);
  const cashoutAmount = calculateCashoutValue(
    partialStake.toNumber(),
    originalOdds,
    currentOdds,
    margin,
  );
  const remainingStake = new Decimal(stake).sub(partialStake);
  return { cashoutAmount, remainingStake };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export function isOddsChangeAcceptable(
  originalOdds: number,
  newOdds: number,
  tolerance: number = 0.05,
): { acceptable: boolean; direction: 'BETTER' | 'WORSE' | 'SAME' } {
  const orig = new Decimal(originalOdds);
  const updated = new Decimal(newOdds);
  const diff = updated.sub(orig).div(orig).abs().toNumber();

  if (updated.gt(orig)) return { acceptable: true, direction: 'BETTER' };
  if (updated.eq(orig)) return { acceptable: true, direction: 'SAME' };
  return { acceptable: diff <= tolerance, direction: 'WORSE' };
}

// ─── System bet combinations ──────────────────────────────────────────────────

export function getSystemBetCombinations(
  selections: any[],
  size: number,
): any[][] {
  const result: any[][] = [];
  function combine(start: number, combo: any[]) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < selections.length; i++) {
      combine(i + 1, [...combo, selections[i]]);
    }
  }
  combine(0, []);
  return result;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export function paginateResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
  };
}

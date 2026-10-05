'use client';

import { useEffect, useMemo } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import {
  MAX_TICKET_BET,
  ARCADE_BET_INCREMENT,
  ARCADE_MIN_BET,
} from '@/server/arcade/arcade-constants';

/** Baseline preset tiers shared across wager games. Larger wallets get generated tiers below. */
const PRESET_TIERS = [
  10, 25, 50, 100, 150, 250, 500, 750, 1000, 2500, 5000, 7500, 10000, 25000,
  50000, 75000, 100000, 250000, 500000, 750000, 1000000,
];
const GENERATED_TIER_MULTIPLIERS = [1, 2.5, 5, 7.5];
const BET_LABEL_UNITS = [
  { threshold: 1_000_000_000_000, suffix: 'T' },
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
];

type ArcadeBetSelectorProps = {
  value: number;
  onChange: (amount: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  balance?: number;
};

function roundDownToIncrement(amount: number): number {
  return Math.floor(amount / ARCADE_BET_INCREMENT) * ARCADE_BET_INCREMENT;
}

function dedupeAndSortAmounts(amounts: number[]): number[] {
  return Array.from(new Set(amounts)).sort((a, b) => a - b);
}

function isValidBetAmount(amount: number, min: number, max: number): boolean {
  const normalizedMin = Math.max(min, ARCADE_MIN_BET);
  return (
    Number.isInteger(amount) &&
    amount >= normalizedMin &&
    amount <= max &&
    amount % ARCADE_BET_INCREMENT === 0
  );
}

/** Short display label for pill buttons: 500 → "500", 2500 → "2.5K", 1000000 → "1M". */
function formatBetLabel(amount: number): string {
  const unit = BET_LABEL_UNITS.find(({ threshold }) => amount >= threshold);
  if (unit) {
    const scaled = amount / unit.threshold;
    return amount % unit.threshold === 0
      ? `${scaled}${unit.suffix}`
      : `${scaled.toFixed(1)}${unit.suffix}`;
  }
  return String(amount);
}

function computeDynamicMin(balance: number, absMin: number, hardMax: number): number {
  const balanceFloor = roundDownToIncrement(balance * 0.01);
  const cappedFloor = Math.max(absMin, balanceFloor);
  return Math.min(cappedFloor, roundDownToIncrement(hardMax));
}

function getGeneratedPresetTiers(min: number, max: number): number[] {
  const normalizedMin = Math.max(min, ARCADE_MIN_BET);
  if (max < normalizedMin) return [];

  const highestFixedTier = PRESET_TIERS[PRESET_TIERS.length - 1];
  const firstGeneratedPower = 10 ** Math.floor(Math.log10(highestFixedTier));
  const generatedBases: number[] = [];

  for (let base = firstGeneratedPower; base <= max; base *= 10) {
    generatedBases.push(base);
  }

  const generatedOptions = generatedBases
    .flatMap((base) =>
      GENERATED_TIER_MULTIPLIERS.map((multiplier) =>
        roundDownToIncrement(base * multiplier),
      ),
    )
    .filter((amount) => amount >= normalizedMin && amount <= max);

  return isValidBetAmount(max, normalizedMin, max)
    ? [...generatedOptions, max]
    : generatedOptions;
}

function buildPresetTiers(min: number, max: number): number[] {
  const normalizedMin = Math.max(min, ARCADE_MIN_BET);
  if (max < normalizedMin) return [];

  const fixedOptions = PRESET_TIERS.filter(
    (amount) => amount >= normalizedMin && amount <= max,
  );
  const generatedOptions = getGeneratedPresetTiers(normalizedMin, max);
  return dedupeAndSortAmounts([...fixedOptions, ...generatedOptions]);
}

function computeEffectiveMax(balance: number | undefined, max: number): number {
  const balanceCap =
    balance != null ? roundDownToIncrement(Math.max(0, balance)) : Number.POSITIVE_INFINITY;
  return Math.min(max, balanceCap);
}

function computeEffectiveMin({
  balance,
  effectiveMax,
  max,
  min,
}: {
  balance: number | undefined;
  effectiveMax: number;
  max: number;
  min: number;
}): number {
  if (balance != null && balance >= min) {
    return Math.min(computeDynamicMin(balance, min, max), effectiveMax);
  }
  return min;
}

function selectCurrentBet({
  betOptions,
  effectiveMin,
  preserveCurrentValue,
  value,
}: {
  betOptions: number[];
  effectiveMin: number;
  preserveCurrentValue: boolean;
  value: number;
}): number {
  if (preserveCurrentValue) return value;

  const affordable = betOptions.filter((amount) => amount <= value);
  return affordable[affordable.length - 1] ?? betOptions[0] ?? effectiveMin;
}

function computeAllInValue({
  balance,
  betOptions,
  max,
  min,
  selectedValue,
}: {
  balance: number | undefined;
  betOptions: number[];
  max: number;
  min: number;
  selectedValue: number;
}): number {
  const fallback = betOptions[betOptions.length - 1] ?? selectedValue;
  if (balance == null) return fallback;

  const roundedBalance = roundDownToIncrement(balance);
  return roundedBalance >= min ? Math.min(roundedBalance, max) : fallback;
}

export function ArcadeBetSelector({
  value,
  onChange,
  min = ARCADE_MIN_BET,
  max = MAX_TICKET_BET,
  disabled = false,
  balance,
}: ArcadeBetSelectorProps) {
  const effectiveMax = useMemo(
    () => computeEffectiveMax(balance, max),
    [balance, max],
  );

  const effectiveMin = useMemo(
    () => computeEffectiveMin({ balance, effectiveMax, max, min }),
    [balance, effectiveMax, max, min],
  );

  const shouldPreserveCurrentValue = useMemo(
    () => isValidBetAmount(value, effectiveMin, effectiveMax),
    [effectiveMax, effectiveMin, value],
  );

  const betOptions = useMemo(() => {
    let options = buildPresetTiers(
      effectiveMin,
      Number.isFinite(effectiveMax) ? effectiveMax : max,
    );

    if (shouldPreserveCurrentValue && !options.includes(value)) {
      options = [...options, value].sort((a, b) => a - b);
    }

    return options;
  }, [effectiveMax, effectiveMin, max, shouldPreserveCurrentValue, value]);

  const selectedValue = useMemo(
    () =>
      selectCurrentBet({
        betOptions,
        effectiveMin,
        preserveCurrentValue: shouldPreserveCurrentValue,
        value,
      }),
    [betOptions, effectiveMin, shouldPreserveCurrentValue, value],
  );

  useEffect(() => {
    if (value !== selectedValue) {
      onChange(selectedValue);
    }
  }, [onChange, selectedValue, value]);

  const allInValue = computeAllInValue({
    balance,
    betOptions,
    max,
    min,
    selectedValue,
  });

  return (
    <div className='arc-bet-selector space-y-2'>
      <div className='flex items-center justify-between gap-3'>
        <span className='arcade-kicker'>Bet</span>
        {/* Remount on change so the mono readout pops with the selection. */}
        <span key={selectedValue} className='arc-bet-readout arc-num-pop'>
          {selectedValue.toLocaleString()} tickets
        </span>
      </div>

      <div className='arc-bet-options flex gap-1.5'>
        {betOptions.map((amount) => (
          <button
            key={amount}
            type='button'
            onClick={() => onChange(amount)}
            disabled={disabled}
            data-active={selectedValue === amount || undefined}
            className='arc-bet-pill'
          >
            {formatBetLabel(amount)}
          </button>
        ))}
      </div>

      <div className='arc-bet-all-in'>
        <ArcadeButton
          tone='tickets'
          size='xs'
          onClick={() => onChange(allInValue)}
          disabled={disabled || allInValue < effectiveMin || selectedValue === allInValue}
        >
          All in{allInValue >= effectiveMin ? ` (${formatBetLabel(allInValue)})` : ''}
        </ArcadeButton>
      </div>
    </div>
  );
}

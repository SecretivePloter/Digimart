export type FeePolicy = { basisPoints: number; fixedIdr: number };

export function feePolicyFromEnv(env: NodeJS.ProcessEnv = process.env): FeePolicy {
  const rate = env.MIDTRANS_FEE_BPS;
  const fixed = env.MIDTRANS_FEE_FIXED_IDR;
  if (rate === undefined || fixed === undefined) {
    throw new Error('Set MIDTRANS_FEE_BPS and MIDTRANS_FEE_FIXED_IDR from your merchant tariff');
  }
  const basisPoints = Number(rate);
  const fixedIdr = Number(fixed);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints >= 10000 ||
      !Number.isSafeInteger(fixedIdr) || fixedIdr < 0) {
    throw new Error('Invalid payment fee configuration');
  }
  return { basisPoints, fixedIdr };
}

export function calculateQuote(basePriceIdr: number, policy: FeePolicy) {
  if (!Number.isSafeInteger(basePriceIdr) || basePriceIdr <= 0 ||
      !Number.isSafeInteger(policy.basisPoints) || policy.basisPoints < 0 ||
      policy.basisPoints >= 10000 ||
      !Number.isSafeInteger(policy.fixedIdr) || policy.fixedIdr < 0) {
    throw new Error('Invalid price or fee policy');
  }
  // Charge enough to cover a percentage assessed on the total collected.
  const totalIdr = Math.ceil((basePriceIdr + policy.fixedIdr) * 10000 / (10000 - policy.basisPoints));
  if (!Number.isSafeInteger(totalIdr)) throw new Error('Total exceeds safe integer range');
  return { base_price_idr: basePriceIdr, payment_fee_idr: totalIdr - basePriceIdr, total_idr: totalIdr };
}

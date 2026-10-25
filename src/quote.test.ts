import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { calculateQuote, feePolicyFromEnv } from './quote.js';

test('fee covers percentage assessed on final amount', () => {
  const quote = calculateQuote(12000, { basisPoints: 70, fixedIdr: 0 });
  assert.deepEqual(quote, { base_price_idr: 12000, payment_fee_idr: 85, total_idr: 12085 });
  assert.ok(quote.total_idr - Math.ceil(quote.total_idr * 0.007) >= 12000);
});

test('fixed and percentage fees combine without losing base price', () => {
  const quote = calculateQuote(25000, { basisPoints: 100, fixedIdr: 1000 });
  assert.ok(quote.total_idr - Math.ceil(quote.total_idr * 0.01) - 1000 >= 25000);
});

test('merchant fee must be configured explicitly', () => {
  assert.throws(() => feePolicyFromEnv({}), /Set MIDTRANS_FEE/);
  assert.throws(() => feePolicyFromEnv({ MIDTRANS_FEE_BPS: '10000', MIDTRANS_FEE_FIXED_IDR: '0' }), /Invalid/);
});

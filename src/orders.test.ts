import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { handlePaymentNotice } from './orders.js';
import type { MidtransNotification } from './midtrans.js';

function signed(status: string, amount = '12085.00'): MidtransNotification {
  return {
    order_id: 'ORD-123', status_code: '200', gross_amount: amount,
    transaction_id: 'txn-1', payment_type: 'qris', transaction_status: status,
    signature_key: createHash('sha512').update('ORD-123200' + amount + 'test-key').digest('hex'),
  };
}

function fakePool() {
  const state = { orderStatus: 'awaiting_payment', paymentStatus: 'pending', outboxCount: 0 };
  const client = {
    async query(sql: string) {
      if (sql.includes('SELECT o.id')) return { rows: [{
        id: '1', status: state.orderStatus, total_idr: '12085',
        phone: '6281234567890', variant_name_snapshot: 'Invite 1 Bulan',
      }] };
      if (sql.includes('SELECT id, provider_transaction_id')) return {
        rows: [{ id: '2', provider_transaction_id: 'txn-1' }],
      };
      if (sql.includes('UPDATE payments SET status')) {
        state.paymentStatus = sql.includes("'settlement'") ? 'settlement' : 'expire';
      }
      if (sql.includes('UPDATE orders SET status')) {
        state.orderStatus = sql.includes("'awaiting_customer_data'") ? 'awaiting_customer_data' : 'expired';
      }
      if (sql.includes('INSERT INTO message_outbox')) state.outboxCount++;
      return { rows: [] };
    },
    release() {},
  };
  return { state, pool: { connect: async () => client } as unknown as Pool };
}

test('settlement changes status and queues messages once despite duplicate notification', async () => {
  const { pool, state } = fakePool();
  await handlePaymentNotice(pool, signed('settlement'), 'test-key');
  await handlePaymentNotice(pool, signed('settlement'), 'test-key');
  assert.equal(state.orderStatus, 'awaiting_customer_data');
  assert.equal(state.paymentStatus, 'settlement');
  assert.equal(state.outboxCount, 2);
});

test('amount mismatch leaves order unchanged', async () => {
  const { pool, state } = fakePool();
  await assert.rejects(handlePaymentNotice(pool, signed('settlement', '12086.00'), 'test-key'), /mismatch/);
  assert.equal(state.orderStatus, 'awaiting_payment');
  assert.equal(state.outboxCount, 0);
});

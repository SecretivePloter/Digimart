import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { MidtransClient, paymentState, verifyNotification } from './midtrans.js';

test('signed settlement accepted; altered amount rejected', () => {
  const key = 'test-server-key';
  const notice = {
    order_id: 'ORD-123', status_code: '200', gross_amount: '12085.00',
    transaction_status: 'settlement', payment_type: 'qris',
    signature_key: createHash('sha512').update('ORD-12320012085.00' + key).digest('hex'),
  };
  assert.equal(verifyNotification(notice, key), true);
  assert.equal(paymentState(notice), 'paid');
  assert.equal(verifyNotification({ ...notice, gross_amount: '12086.00' }, key), false);
  assert.equal(paymentState({ ...notice, transaction_status: 'expire' }), 'expired');
});

test('sandbox QRIS charge sends configured amount and fifteen-minute expiry', async () => {
  let called = false;
  const mock = (async (url: string | URL | Request, options?: RequestInit) => {
    called = true;
    assert.equal(String(url), 'https://api.sandbox.midtrans.com/v2/charge');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.transaction_details.gross_amount, 12085);
    assert.deepEqual(body.custom_expiry, { expiry_duration: 15, unit: 'minute' });
    return new Response(JSON.stringify({
      status_code: '201', transaction_status: 'pending', transaction_id: 'txn-1',
      order_id: 'ORD-123', gross_amount: '12085.00',
      actions: [{ name: 'generate-qr-code-v2', url: 'https://api.sandbox.midtrans.com/v4/qris/qr-code' }],
    }), { status: 201 });
  }) as typeof fetch;
  const result = await new MidtransClient('test-key', 'sandbox', mock)
    .chargeQris('ORD-123', 12085, '6281234567890');
  assert.equal(called, true);
  assert.equal(result.transactionId, 'txn-1');
});

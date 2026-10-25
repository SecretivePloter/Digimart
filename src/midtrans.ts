import { createHash, timingSafeEqual } from 'node:crypto';

export type MidtransNotification = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
  transaction_id?: string;
  payment_type?: string;
  fraud_status?: string;
};

export function verifyNotification(payload: MidtransNotification, serverKey: string): boolean {
  if (!serverKey || !payload.order_id || !payload.status_code ||
      !payload.gross_amount || !/^[0-9a-f]{128}$/i.test(payload.signature_key ?? '')) return false;
  const expected = createHash('sha512')
    .update(payload.order_id + payload.status_code + payload.gross_amount + serverKey)
    .digest();
  return timingSafeEqual(expected, Buffer.from(payload.signature_key, 'hex'));
}

export function paymentState(payload: MidtransNotification): 'paid' | 'expired' | 'pending' | 'rejected' {
  if (payload.transaction_status === 'settlement' && payload.fraud_status !== 'deny') return 'paid';
  if (payload.transaction_status === 'expire') return 'expired';
  if (payload.transaction_status === 'pending') return 'pending';
  return 'rejected';
}

export class MidtransClient {
  private readonly baseUrl: string;
  constructor(
    private readonly serverKey: string,
    environment: 'sandbox' | 'production' = 'sandbox',
    private readonly request: typeof fetch = fetch,
  ) {
    if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY is required');
    this.baseUrl = environment === 'production'
      ? 'https://api.midtrans.com'
      : 'https://api.sandbox.midtrans.com';
  }

  async chargeQris(orderId: string, amountIdr: number, customerPhone: string) {
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(orderId) || !Number.isSafeInteger(amountIdr) ||
        amountIdr <= 0 || !/^[1-9][0-9]{7,14}$/.test(customerPhone)) {
      throw new Error('Invalid charge details');
    }
    const response = await this.request(`${this.baseUrl}/v2/charge`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(this.serverKey + ':').toString('base64')}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        payment_type: 'qris',
        transaction_details: { order_id: orderId, gross_amount: amountIdr },
        customer_details: { phone: '+' + customerPhone },
        qris: { acquirer: 'gopay' },
        custom_expiry: { expiry_duration: 15, unit: 'minute' },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json() as {
      status_code?: string; transaction_status?: string; transaction_id?: string;
      order_id?: string; gross_amount?: string;
      actions?: Array<{ name: string; url: string }>; status_message?: string;
    };
    if (!response.ok || result.transaction_status !== 'pending' ||
        result.order_id !== orderId || Number(result.gross_amount) !== amountIdr ||
        !result.transaction_id) {
      throw new Error(`Midtrans charge failed (HTTP ${response.status}, code ${result.status_code ?? 'unknown'})`);
    }
    const qrUrl = result.actions?.find(a => a.name === 'generate-qr-code-v2')?.url
      ?? result.actions?.find(a => a.name === 'generate-qr-code')?.url;
    if (!qrUrl || !new URL(qrUrl).hostname.endsWith('.midtrans.com') ||
        new URL(qrUrl).protocol !== 'https:') throw new Error('Midtrans did not return a valid QR URL');
    return { orderId, transactionId: result.transaction_id, qrUrl, amountIdr };
  }

  async getStatus(orderId: string): Promise<MidtransNotification> {
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(orderId)) throw new Error('Invalid order ID');
    const response = await this.request(`${this.baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: { authorization: `Basic ${Buffer.from(this.serverKey + ':').toString('base64')}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Midtrans status failed (HTTP ${response.status})`);
    return await response.json() as MidtransNotification;
  }
}

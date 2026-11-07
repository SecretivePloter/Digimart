import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

export function manualPaymentsActive() { return process.env.PAYMENT_PROVIDER === 'qris_manual'; }
export function qrisPath() { return resolve(process.env.MANUAL_QRIS_IMAGE ?? 'private/qris-gopay.png'); }
export function merchantName() { return process.env.MANUAL_QRIS_MERCHANT ?? 'MUGENWORKLABS, PULSA & INTERNET'; }
export async function verifyManualConfig() {
  if (manualPaymentsActive()) await access(qrisPath(), constants.R_OK);
}
export function sandboxMessaging() {
  return !manualPaymentsActive() && (process.env.MIDTRANS_ENV ?? 'sandbox') === 'sandbox';
}

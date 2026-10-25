# Midtrans Sandbox integration

The order CLI is for trusted local testing only; no public order-creation endpoint exists. It requires an active product and variant, configured merchant fees, and a Sandbox Server Key. Never commit local environment files or paste the Server Key into chat.

Add these variables to `.env.local` after Neon variables:

```dotenv
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=<your Sandbox Server Key>
MIDTRANS_FEE_BPS=<merchant QRIS percentage in basis points>
MIDTRANS_FEE_FIXED_IDR=<fixed charge in IDR; use 0 if none>
```

For example, 0.7% corresponds to 70 basis points, but **do not assume that is your product-digital merchant tariff**. The quote grosses up the final charged amount to cover both configured fees. Verify the merchant contract and any applicable taxes.

Run `npm run db:migrate`, `npm run build`, and `npm test`. After activating a real variant and confirming its stock, use `npm run catalog:inspect` to find its variant ID, then `npm run order:create -- <buyer-wa-62...> <variant-id>`. This makes a real **Sandbox** QRIS charge (not a live payment). The output contains a QR image URL and order ID. Inspect local records with `npm run order:inspect`.

Set the Midtrans Sandbox Payment Notification URL to `https://<your-public-https-host>/webhooks/midtrans`. A localhost URL cannot receive Midtrans notifications; use a deployed HTTPS server when ready. The endpoint verifies the signature, independently checks status at Midtrans, checks amount and transaction ID against Neon, and applies settlement/expiry once. Repeated notifications do not duplicate outbox messages. A settled payment creates an email request to the buyer and alerts active admins in `message_outbox`; a WhatsApp sender is needed to deliver those queued messages.

If a charge succeeds but writing its result to Neon fails, the order remains `payment_setup`; do not create a second order blindly. Inspect the Midtrans dashboard and reconcile by order ID. The `payment:reconcile` command handles status of an order whose payment row exists; a missing payment row needs operator intervention before retrying.

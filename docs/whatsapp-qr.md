# QR-paired WhatsApp transport

This transport uses Baileys, an **unofficial** WhatsApp Web client. It is not affiliated with or authorized by WhatsApp. The linked number can be restricted if WhatsApp treats the automation as unauthorized. Use a dedicated number, do not send bulk messages, and operate only for incoming buyer conversations. The official Cloud API remains the supported alternative.

From the project directory, run `npm install`, `npm run build`, `npm test`, then `npm run wa:start`. A QR appears in the terminal. On the phone whose account will be the bot, open WhatsApp → Settings/⋮ → Linked devices/Perangkat tertaut → Link a device/Tautkan perangkat, then scan the QR shown on the **computer screen**. Keep the process running; this is a persistent WebSocket connection. You do not need a public webhook URL for WhatsApp QR pairing.

The session is stored under `.wa-auth/` in the project directory and excluded from Git. Treat that folder like a credential: do not share or commit it. Keep the project on persistent storage, and back up the session securely if moving hosts. `npm start` still runs the separate HTTP service for Midtrans webhooks; `npm run wa:start` runs the WhatsApp connection in another terminal.

Current chat flow: `list`, product name/catalog number, then varian number. Outbox messages for paid/expired orders and admin alerts are sent when connected. The `payment` / `konfirmasi beli` chat command currently **does not create a QRIS charge**; it will be enabled after testing QR connection, setting merchant fees, and activating a product. The example YouTube product is intentionally inactive.

If pairing fails, stop the process and check the WhatsApp account's linked devices. Do not paste QR images or the `.wa-auth` directory into chat.

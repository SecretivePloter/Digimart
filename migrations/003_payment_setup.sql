ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'awaiting_stock', 'payment_setup', 'awaiting_payment', 'paid',
  'awaiting_customer_data', 'processing', 'completed',
  'stock_rejected', 'expired', 'failed_processing'
));

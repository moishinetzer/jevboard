-- A paid order Jev couldn't deliver is refunded. `refund_state` is the outbox:
-- 'due' when the order fails after payment, 'done' once the payment provider
-- accepted the refund. The cron retries anything still 'due'.
ALTER TABLE orders ADD COLUMN refund_state TEXT;
ALTER TABLE orders ADD COLUMN refund_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refunded_at INTEGER;
CREATE INDEX orders_refund_due_idx ON orders (updated_at) WHERE refund_state = 'due';

-- The simulated checkout records refunds too.
ALTER TABLE fake_payments ADD COLUMN refunded_at INTEGER;

-- Queue jobs are delivered at least once: a claim token marks which job owns
-- an in-flight order, and one judgment per order makes placement idempotent.
ALTER TABLE orders ADD COLUMN claim_token TEXT;
CREATE UNIQUE INDEX judgments_order_unique ON judgments (order_id);

-- A business as it presents itself, read from its homepage and shown on board
-- rows: its <title>, meta description and app icon (NULL when it has none).
ALTER TABLE entries ADD COLUMN site_title TEXT;
ALTER TABLE entries ADD COLUMN site_description TEXT;
ALTER TABLE entries ADD COLUMN icon_url TEXT;
-- When those were last read. NULL means never: the maintenance sweep reads them
-- for entries placed before this migration.
ALTER TABLE entries ADD COLUMN site_checked_at INTEGER;

-- The same three, staged with the verdict (JSON) until the order is placed.
ALTER TABLE orders ADD COLUMN site_json TEXT;

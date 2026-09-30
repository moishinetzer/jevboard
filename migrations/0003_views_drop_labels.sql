-- Page views per UTC day. site_key '' counts the whole board (every full page
-- load); any other site_key counts views of that business's details.
CREATE TABLE views (
  site_key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_key, day)
);

-- Jev no longer writes a hyphenated verdict label.
ALTER TABLE entries DROP COLUMN label;
ALTER TABLE judgments DROP COLUMN label;

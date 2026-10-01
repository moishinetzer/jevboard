-- Each row's logo, copied from the business's site when Jev judges it and
-- served from our own address (/icon/<site>). The board never loads a picture
-- from a business's server: what Jev saw is what visitors see, and their
-- browsers don't call anyone else's host.
CREATE TABLE site_icons (
  site_key TEXT PRIMARY KEY,
  -- image/png, image/jpeg, image/webp, image/gif or image/x-icon (sniffed from the bytes)
  content_type TEXT NOT NULL,
  -- The picture, base64 (at most 400 KB before encoding)
  body TEXT NOT NULL,
  -- Where it was copied from
  source_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- NULL: not copied yet (the cron does older entries). 0: tried, the site has no
-- usable icon. Otherwise the copy's created_at, which versions its address.
ALTER TABLE entries ADD COLUMN icon_version INTEGER;

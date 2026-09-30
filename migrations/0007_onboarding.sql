-- The guided onboarding (test B): what Jev read on a site before anyone paid,
-- cached per site so a refresh or a second visitor doesn't pay for it again.
CREATE TABLE site_previews (
  site_key TEXT PRIMARY KEY,
  -- { profile: { title, description, icon }, preview: { summary, category, audiences, strengths, landingPages, firstImpression } }
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- What the buyer told Jev in the guided onboarding (JSON), passed to Jev as
-- claims to check against the site. NULL for orders from the plain form.
ALTER TABLE orders ADD COLUMN intake_json TEXT;

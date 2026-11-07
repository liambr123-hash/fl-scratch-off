-- Private inquiries only. This table has no public read API.
-- The Worker deletes rows older than 30 days on new submissions and its daily Cron Trigger.
CREATE TABLE IF NOT EXISTS sponsor_inquiries (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  company TEXT NOT NULL CHECK(length(company) BETWEEN 2 AND 160),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 20 AND 4000),
  budget TEXT CHECK(budget IS NULL OR length(budget) BETWEEN 1 AND 120),
  consent_version TEXT NOT NULL CHECK(consent_version = '2026-11-07')
);

CREATE INDEX IF NOT EXISTS sponsor_inquiries_email_created
  ON sponsor_inquiries(email, created_at);
CREATE INDEX IF NOT EXISTS sponsor_inquiries_created
  ON sponsor_inquiries(created_at);

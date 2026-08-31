-- 0001_init — artifacts, versions, viewers, comments.
--
-- Timestamps are ISO-8601 UTC strings (TEXT) so they sort lexicographically
-- and `?since=<ISO>` comparisons are plain string comparisons.

CREATE TABLE IF NOT EXISTS artifacts (
  channel        TEXT    PRIMARY KEY,
  title          TEXT    NOT NULL,
  owner          TEXT    NOT NULL,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  revoked_at     TEXT
);

CREATE TABLE IF NOT EXISTS versions (
  channel    TEXT    NOT NULL,
  version    INTEGER NOT NULL,
  sha256     TEXT    NOT NULL,
  bytes      INTEGER NOT NULL,
  label      TEXT,
  note       TEXT,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (channel, version)
);

CREATE TABLE IF NOT EXISTS viewers (
  channel  TEXT NOT NULL,
  email    TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (channel, email)
);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT    PRIMARY KEY,
  channel       TEXT    NOT NULL,
  version       INTEGER NOT NULL,
  parent_id     TEXT,
  author        TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  resolved_at   TEXT,
  resolved_by   TEXT,
  to_agent      INTEGER NOT NULL DEFAULT 0,
  agent_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_versions_channel ON versions (channel, version DESC);
CREATE INDEX IF NOT EXISTS idx_comments_channel_created ON comments (channel, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_agent_inbox ON comments (to_agent, agent_seen_at);

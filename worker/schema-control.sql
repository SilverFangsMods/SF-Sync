CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  name          TEXT,
  password_hash TEXT,
  totp_secret   TEXT,
  totp_enrolled INTEGER DEFAULT 0,
  created_at    INTEGER
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  invited_by TEXT,
  used       INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email);

CREATE TABLE IF NOT EXISTS invite_links (
  token      TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_links_by ON invite_links (created_by);

CREATE TABLE IF NOT EXISTS devices (
  token      TEXT PRIMARY KEY,
  device_id  TEXT UNIQUE NOT NULL,
  person     TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_person ON devices (person);

CREATE TABLE IF NOT EXISTS spaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  r2_prefix     TEXT NOT NULL,
  crypt_key_enc TEXT NOT NULL,
  crypt_salt_enc TEXT,
  backend_kind  TEXT DEFAULT 'r2',
  encrypted     INTEGER DEFAULT 1,
  folders       TEXT,
  owner         TEXT NOT NULL,
  created_at    INTEGER
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  email     TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rc_email ON recovery_codes (email);

CREATE TABLE IF NOT EXISTS members (
  space_id   TEXT NOT NULL,
  person     TEXT NOT NULL,
  status     TEXT DEFAULT 'active',
  invited_by TEXT,
  invited_at INTEGER,
  PRIMARY KEY (space_id, person)
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram',
  post_type TEXT NOT NULL,
  media_url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_result JSONB DEFAULT '{}'::jsonb,
  error_code TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  client_request_id TEXT,
  content_hash TEXT,
  locked_at TIMESTAMPTZ
);

-- Query helpers
CREATE INDEX IF NOT EXISTS idx_posts_account_sched
  ON posts (account_id, scheduled_at, id);

-- Up-next for workers
CREATE INDEX IF NOT EXISTS idx_posts_status_sched
  ON posts (status, scheduled_at);

-- Idempotency (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_acc_clientreq
  ON posts (account_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Optional if you filter by status a lot
CREATE INDEX IF NOT EXISTS idx_posts_acc_status_sched
  ON posts (account_id, status, scheduled_at);

-- =========================
-- Accounts & Media Assets
-- =========================

CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  handle        TEXT        NOT NULL,
  ig_user_id    BIGINT      NOT NULL,
  access_token  TEXT,
  timezone      TEXT        NOT NULL DEFAULT 'UTC',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ig_user_id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(active);
CREATE INDEX IF NOT EXISTS idx_accounts_handle ON accounts(handle);

CREATE TABLE IF NOT EXISTS media_assets (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  orig_filename TEXT,
  stored_path   TEXT        NOT NULL,
  media_url     TEXT        NOT NULL,
  bytes         BIGINT      NOT NULL,
  sha256        TEXT        NOT NULL,
  hash8         TEXT        NOT NULL,
  caption_slug  TEXT        DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_media_account_created ON media_assets(account_id, created_at);

-- Link posts → media/account
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS asset_id BIGINT;

ALTER TABLE posts
  ADD CONSTRAINT IF NOT EXISTS fk_posts_asset
  FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;

ALTER TABLE posts
  ADD CONSTRAINT IF NOT EXISTS fk_posts_account
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_posts_asset ON posts(asset_id);

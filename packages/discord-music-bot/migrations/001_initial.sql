CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT '*' CHECK (char_length(prefix) BETWEEN 1 AND 5),
  dj_role_id TEXT,
  dj_channel_id TEXT,
  allowed_channel_ids TEXT[] NOT NULL DEFAULT '{}',
  blocked_channel_ids TEXT[] NOT NULL DEFAULT '{}',
  default_volume INTEGER NOT NULL DEFAULT 80 CHECK (default_volume BETWEEN 0 AND 200),
  autoplay BOOLEAN NOT NULL DEFAULT FALSE,
  stay_247 BOOLEAN NOT NULL DEFAULT FALSE,
  announcements BOOLEAN NOT NULL DEFAULT TRUE,
  now_playing_channel_id TEXT,
  source_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS music_sessions (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  voice_channel_id TEXT,
  text_channel_id TEXT,
  session_owner TEXT,
  volume INTEGER NOT NULL DEFAULT 80 CHECK (volume BETWEEN 0 AND 200),
  loop_mode TEXT NOT NULL DEFAULT 'off' CHECK (loop_mode IN ('off', 'track', 'queue')),
  autoplay BOOLEAN NOT NULL DEFAULT FALSE,
  stay_247 BOOLEAN NOT NULL DEFAULT FALSE,
  current_track JSONB,
  queue JSONB NOT NULL DEFAULT '[]'::jsonb,
  position_ms BIGINT NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lavalink_node_sessions (
  node_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlists (
  playlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS playlists_owner_name_lower_uq ON playlists(owner_id, lower(name));
CREATE INDEX IF NOT EXISTS playlists_owner_created_idx ON playlists(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  track_data JSONB NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, position)
);
CREATE INDEX IF NOT EXISTS playlist_tracks_playlist_added_idx ON playlist_tracks(playlist_id, added_at);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  track_key TEXT NOT NULL,
  track_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_key)
);
CREATE INDEX IF NOT EXISTS favorites_user_created_idx ON favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS premium_guilds (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  active_until TIMESTAMPTZ NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_guilds_expiration_idx ON premium_guilds(active_until);

CREATE TABLE IF NOT EXISTS premium_users (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  active_until TIMESTAMPTZ NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_users_expiration_idx ON premium_users(active_until);

CREATE TABLE IF NOT EXISTS premium_expirations (
  expiration_id BIGSERIAL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'guild')),
  subject_id TEXT NOT NULL,
  expired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'scheduled'
);
CREATE INDEX IF NOT EXISTS premium_expirations_subject_idx ON premium_expirations(subject_type, subject_id, expired_at DESC);

CREATE TABLE IF NOT EXISTS payment_records (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'guild')),
  subject_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_reference)
);
CREATE INDEX IF NOT EXISTS payment_records_subject_idx ON payment_records(subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS command_usage (
  usage_id BIGSERIAL PRIMARY KEY,
  command_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS command_usage_created_idx ON command_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS command_usage_guild_created_idx ON command_usage(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS command_usage_user_created_idx ON command_usage(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blacklist (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'guild')),
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  guild_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_guild_created_idx ON audit_logs(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON audit_logs(actor_id, created_at DESC);
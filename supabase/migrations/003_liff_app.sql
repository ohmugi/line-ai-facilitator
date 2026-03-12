-- ============================================================
-- 003_liff_app.sql
-- LIFF Web App 用テーブル追加
-- 既存の Bot 用テーブル (households, sessions, messages, scenes) は保持
-- ============================================================

-- uuid 拡張が未作成の場合は作成
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- liff_households: LIFF 版の夫婦単位
-- group_id は Bot 通知用（後から設定可能）
-- ============================================================
CREATE TABLE IF NOT EXISTS liff_households (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        text        UNIQUE,                          -- LINE グループID（Bot通知用、任意）
  invite_code     text        UNIQUE NOT NULL
                              DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  child_birth_year  int,
  child_birth_month int,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ============================================================
-- liff_users: LINE ユーザー
-- ============================================================
CREATE TABLE IF NOT EXISTS liff_users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    text        UNIQUE NOT NULL,
  household_id    uuid        REFERENCES liff_households(id),
  display_name    text,
  role            text        CHECK (role IN ('inviter', 'invitee')),
  created_at      timestamptz DEFAULT now()
);

-- ============================================================
-- scenes テーブルに生成コンテンツキャッシュを追加
-- ============================================================
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS generated_content jsonb;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS generated_at      timestamptz;

-- ============================================================
-- liff_sessions: LIFF 版セッション
-- user1 = inviter, user2 = invitee
-- ============================================================
CREATE TABLE IF NOT EXISTS liff_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid        NOT NULL REFERENCES liff_households(id),
  scenario_id         uuid        NOT NULL REFERENCES scenes(id),
  status              text        NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new', 'in_progress', 'completed')),
  user1_id            uuid        REFERENCES liff_users(id),
  user2_id            uuid        REFERENCES liff_users(id),
  user1_current_step  text        CHECK (user1_current_step IN ('step1','step2','step3','step4','completed')),
  user2_current_step  text        CHECK (user2_current_step IN ('step1','step2','step3','step4','completed')),
  reflection          jsonb,                                   -- AI 生成リフレクション
  delivered_at        timestamptz DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz DEFAULT now()
);

-- ============================================================
-- session_answers: ユーザー回答
-- Supabase Realtime でパートナーの回答をリアルタイム同期
-- ============================================================
CREATE TABLE IF NOT EXISTS session_answers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES liff_sessions(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES liff_users(id),
  step        text        NOT NULL CHECK (step IN ('step1','step2','step3','step4')),
  answer      jsonb       NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (session_id, user_id, step)   -- 同一 step は上書きではなく upsert
);

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_liff_sessions_household   ON liff_sessions(household_id);
CREATE INDEX IF NOT EXISTS idx_liff_sessions_scenario    ON liff_sessions(scenario_id);
CREATE INDEX IF NOT EXISTS idx_session_answers_session   ON session_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_liff_users_line_id        ON liff_users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_liff_users_household      ON liff_users(household_id);

-- ============================================================
-- RLS (Row Level Security)
-- 書き込みはすべてバックエンド (service role) 経由
-- Realtime 購読は anon key から SELECT のみ許可
-- ============================================================
ALTER TABLE liff_households  ENABLE ROW LEVEL SECURITY;
ALTER TABLE liff_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE liff_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_answers  ENABLE ROW LEVEL SECURITY;

-- anon / authenticated からの SELECT を許可（Realtime + 直接取得用）
CREATE POLICY "anon select liff_households"  ON liff_households  FOR SELECT USING (true);
CREATE POLICY "anon select liff_users"       ON liff_users       FOR SELECT USING (true);
CREATE POLICY "anon select liff_sessions"    ON liff_sessions    FOR SELECT USING (true);
CREATE POLICY "anon select session_answers"  ON session_answers  FOR SELECT USING (true);

-- 書き込みは service role のみ（バックエンド経由）
-- service role は RLS をバイパスするため追加ポリシー不要

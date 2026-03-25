-- ============================================================
-- 009_rls_legacy_tables.sql
-- 旧 Bot 用テーブルへの RLS 有効化
-- Security Advisor の "RLS Disabled in Public" / "Sensitive Columns Exposed" 対策
--
-- 対象テーブル:
--   public.households  - Bot 用グループ単位
--   public.users       - Bot 用ユーザー
--   public.messages    - Bot メッセージ（センシティブ）
--   public.sessions    - Bot セッション
--   public.scenes      - シナリオ（Bot + LIFF 共通）
--   public.responses   - Bot 回答（センシティブ）
--
-- アクセス方針:
--   ・scenes のみ anon SELECT を許可（シナリオ内容は非センシティブな公開コンテンツ）
--   ・その他テーブルはポリシーなし = anon/authenticated からのアクセスを全拒否
--   ・書き込み・読み取りはすべてバックエンド（service_role）経由のため影響なし
-- ============================================================

-- ============================================================
-- 1. RLS 有効化
-- ============================================================
ALTER TABLE households  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. scenes: anon SELECT のみ許可（シナリオ文は非センシティブ）
--    書き込みは service_role のみ（RLS バイパス）
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'scenes'
      AND policyname = 'anon select scenes'
  ) THEN
    CREATE POLICY "anon select scenes" ON scenes FOR SELECT USING (true);
  END IF;
END $$;

-- ============================================================
-- 3. households / users / messages / sessions / responses
--    ポリシーなし = anon・authenticated からのアクセスを全拒否
--    service_role はRLSをバイパスするため影響なし
-- ============================================================
-- （ポリシーを追加しないことで拒否を実現）

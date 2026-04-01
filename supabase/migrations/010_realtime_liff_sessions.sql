-- ============================================================
-- 010_realtime_liff_sessions.sql
-- liff_sessions を Supabase Realtime publication に追加
-- カップルリフレクションのリアルタイム配信に必要
-- ============================================================

-- liff_sessions が未追加の場合のみ追加（冪等）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'liff_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE liff_sessions;
  END IF;
END $$;

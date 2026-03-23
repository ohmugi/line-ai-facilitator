-- 008_session_answers_concreteness_level.sql
-- session_answers に concreteness_level カラムを追加（007 は誤って liff_answers に適用されていた）

ALTER TABLE session_answers
  ADD COLUMN IF NOT EXISTS concreteness_level text
    CHECK (concreteness_level IN ('high', 'mid', 'low'));

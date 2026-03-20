-- 007_concreteness_level.sql
-- Step4 リニューアル: liff_answers に concreteness_level カラムを追加

ALTER TABLE liff_answers
  ADD COLUMN IF NOT EXISTS concreteness_level text
    CHECK (concreteness_level IN ('high', 'mid', 'low'));

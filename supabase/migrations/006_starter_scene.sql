-- ============================================================
-- 006_starter_scene.sql
-- ・scenes に is_starter カラムを追加
-- ・スーパーシナリオのテキスト修正（「床に寝転がって」を削除）＆ 先頭固定に設定
-- Supabase Dashboard の SQL Editor で実行してください
-- ============================================================

-- 1. is_starter カラムを追加
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS is_starter boolean NOT NULL DEFAULT false;

-- 2. スーパーシナリオのテキストを修正し、先頭固定フラグを立てる
UPDATE scenes
SET
  scene_text = 'もしもスーパーで子どもが「お菓子買って!」と泣き叫んだら、どう感じるかにゃ?',
  is_starter = true
WHERE scene_text LIKE '%スーパーで子どもが%お菓子買って%';

-- ============================================================
-- 004_couple_reflection.sql
-- カップルリフレクション & Step1三段階化 対応
-- ============================================================

-- liff_sessions にカップルリフレクション用カラムを追加
ALTER TABLE liff_sessions
  ADD COLUMN IF NOT EXISTS couple_reflection jsonb;

-- session_answers の step1 answer 構造メモ（スキーマ変更不要）
-- 旧: { thought: string, intensity: number }
-- 新: { emotion: string, intensity: number, thought: string }
-- → answer は jsonb のため後方互換性あり。マイグレーション不要。

-- カップルリフレクション用インデックス（両者完了チェックを高速化）
CREATE INDEX IF NOT EXISTS idx_liff_sessions_status
  ON liff_sessions(status);

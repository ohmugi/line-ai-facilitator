-- child_age_context カラムを削除（コード内で未使用の旧カラム）
ALTER TABLE scenes DROP COLUMN IF EXISTS child_age_context;

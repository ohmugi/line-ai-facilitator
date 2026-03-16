-- ============================================================
-- 005_child_lens.sql
-- 子どもレンズ機能追加
-- 「子どもはどうすると思う？」4ステップ
-- ============================================================

-- ============================================================
-- scenes テーブルに session_type カラム追加
-- 'parent'    : 既存の「もしも〜どう感じる？」形式
-- 'child_lens': 新「子どもはどうすると思う？」形式
-- ============================================================
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS session_type text
    NOT NULL DEFAULT 'parent'
    CHECK (session_type IN ('parent', 'child_lens'));

-- ============================================================
-- scenes テーブルに requires_siblings カラム追加
-- true: 兄弟・姉妹がいる家庭向けシナリオ（ひとりっ子除外）
-- ============================================================
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS requires_siblings boolean NOT NULL DEFAULT false;

-- ============================================================
-- liff_households に has_siblings フラグを追加
-- null: 未設定, true: 兄弟あり, false: ひとりっ子
-- ============================================================
ALTER TABLE liff_households
  ADD COLUMN IF NOT EXISTS has_siblings boolean;

CREATE INDEX IF NOT EXISTS idx_scenes_session_type ON scenes(session_type);

-- ============================================================
-- 子どもレンズ用シナリオデータ
-- scene_text: 子どもが置かれた状況のみを記述
--   NG: 「〜して泣いているとき」（反応を埋め込まない）
--   OK: 「〜なとき」（状況だけ。Step A の AI が行動選択肢を生成）
-- ============================================================

INSERT INTO scenes (scene_text, category, age_group, session_type, requires_siblings, is_active) VALUES

-- ── toddler (乳幼児・未就学) ──────────────────────────────────
(
  'お友達においもちゃを取られてしまったとき',
  '親子関係・愛着',
  'toddler',
  'child_lens',
  false,
  true
),
(
  'お砂場でお友達に「一緒に遊ぼう」と声をかけられたとき',
  '遊び・発達',
  'toddler',
  'child_lens',
  false,
  true
),
(
  '難しいパズルや積み木がどうしてもうまくいかないとき',
  '遊び・発達',
  'toddler',
  'child_lens',
  false,
  true
),

-- ── elementary_lower (小学校低学年) ───────────────────────────
(
  '班の発表者に選ばれたとき',
  '他者との関係',
  'elementary_lower',
  'child_lens',
  false,
  true
),
(
  'テストで思ったより点数が取れなかったとき',
  '生活リズム・しつけ',
  'elementary_lower',
  'child_lens',
  false,
  true
),
(
  'グループ遊びで自分だけルールを知らなかったとき',
  '他者との関係',
  'elementary_lower',
  'child_lens',
  false,
  true
),

-- ── elementary_upper (小学校高学年) ───────────────────────────
(
  '放課後のグループLINEで自分だけ返信できていないとき',
  '他者との関係',
  'elementary_upper',
  'child_lens',
  false,
  true
),
(
  'クラスで多数決のとき自分だけ違う意見だったとき',
  '他者との関係',
  'elementary_upper',
  'child_lens',
  false,
  true
),
(
  '習い事の発表会で大きなミスをしてしまったとき',
  '遊び・発達',
  'elementary_upper',
  'child_lens',
  false,
  true
),

-- ── teen (中学生・高校生) ─────────────────────────────────────
(
  '部活でレギュラーから外されたとき',
  '他者との関係',
  'teen',
  'child_lens',
  false,
  true
),
(
  '親友に打ち明けた秘密が他の子に広まってしまったとき',
  '他者との関係',
  'teen',
  'child_lens',
  false,
  true
),
(
  '志望校について親と意見が合わないとき',
  '親子関係・愛着',
  'teen',
  'child_lens',
  false,
  true
),

-- ── universal (全年齢) ────────────────────────────────────────
(
  '挑戦しようとして何度も失敗してしまったとき',
  '親子関係・愛着',
  'universal',
  'child_lens',
  false,
  true
),

-- ── requires_siblings=true: 兄弟のいる家庭のみ ───────────────
(
  '兄弟とけんかをして自分が悪かったとき',
  '親子関係・愛着',
  'universal',
  'child_lens',
  true,
  true
);

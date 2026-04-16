-- 011_domain.sql
-- ドメイン機能追加: scenes に domain カラムを追加し、
-- お金・コミュニケーションドメインの general セッションシナリオを投入

-- ============================================================

-- 0. session_type の CHECK 制約を拡張（'general' を追加）
--    005_child_lens.sql で ('parent','child_lens') のみ許可していたため更新
-- ============================================================
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_session_type_check;
ALTER TABLE scenes ADD CONSTRAINT scenes_session_type_check
  CHECK (session_type IN ('parent', 'child_lens', 'general'));

-- ============================================================
-- 1. domain カラムを追加
-- ============================================================
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS domain text;

-- ============================================================
-- 2. 既存シナリオにドメインをセット
-- ============================================================
UPDATE scenes SET domain = '育児'     WHERE session_type = 'parent'     AND domain IS NULL;
UPDATE scenes SET domain = '子の個性' WHERE session_type = 'child_lens' AND domain IS NULL;

-- ============================================================
-- 3. お金ドメイン（general タイプ・全年齢共通）
-- ============================================================
INSERT INTO scenes (scene_text, category, age_group, session_type, domain, is_active, is_starter, requires_siblings) VALUES
  ('今月の支払いが全部終わって、いつもよりちょっと余裕が出てきたとき',                             '余剰金・貯蓄',           'universal', 'general', 'お金', true, false, false),
  ('ふたりで使う「ちょっといい生活家電」を買う機会がやってきたとき',                               '消費・購入判断',         'universal', 'general', 'お金', true, false, false),
  ('家計を見直して、どこかひとつ出費を削らなきゃいけないとき',                                     '節約・削減',             'universal', 'general', 'お金', true, false, false),
  ('仲のいい友人の結婚祝いに、1万円でお返しを選ぶとき',                                           '贈り物・特別支出',       'universal', 'general', 'お金', true, false, false),
  ('急に家電が壊れて、予定外のまとまった出費が必要になったとき',                                   '予定外支出',             'universal', 'general', 'お金', true, false, false),
  ('大きな仕事やプロジェクトをやり遂げた自分に、ご褒美をあげるとしたら',                           '自分へのご褒美',         'universal', 'general', 'お金', true, false, false),
  ('週末に家族みんなで外食に行くとき、お店を選ぶ場面',                                             '外食・娯楽費',           'universal', 'general', 'お金', true, false, false),
  ('1,000円払えば面倒な家事が30分短縮できるサービスがあると知ったとき',                           '時間と費用のトレードオフ', 'universal', 'general', 'お金', true, false, false),
  ('SNSやニュースで「つい目が止まってしまう」お金の話題が流れてきたとき',                         'お金の情報収集',         'universal', 'general', 'お金', true, false, false),
  ('30年後にしか引き出せないが確実に倍になるという投資の話を耳にしたとき',                         '将来への投資',           'universal', 'general', 'お金', true, false, false);

-- ============================================================
-- 4. コミュニケーションドメイン（general タイプ・全年齢共通）
-- ============================================================
INSERT INTO scenes (scene_text, category, age_group, session_type, domain, is_active, is_starter, requires_siblings) VALUES
  ('パートナーが仕事や人間関係の愚痴をこぼしてきたとき',                                           '傾聴・共感',             'universal', 'general', 'コミュニケーション', true, false, false),
  ('パートナーにちょっとした不満を感じたとき',                                                     '不満の伝え方',           'universal', 'general', 'コミュニケーション', true, false, false),
  ('今日あった出来事や気持ちを、パートナーとどのくらい共有したいか考えるとき',                     '情報共有の深さ',         'universal', 'general', 'コミュニケーション', true, false, false),
  ('ふたりの意見が真っ向から対立してしまったとき',                                                 '意見の対立',             'universal', 'general', 'コミュニケーション', true, false, false),
  ('仕事で大きなミスをして落ち込んで帰ってきたとき、パートナーにどうするか',                       '落ち込み時の発信',       'universal', 'general', 'コミュニケーション', true, false, false),
  ('自分が大きなミスをして落ち込んでいるとき、パートナーにどう接してほしいか考えるとき',           '落ち込み時のサポート',   'universal', 'general', 'コミュニケーション', true, false, false),
  ('スマホを見ているときに、パートナーから深刻そうなトーンで声をかけられたとき',                   '集中中の声かけ',         'universal', 'general', 'コミュニケーション', true, false, false),
  ('家事でバタバタしているときに、パートナーから関係ない動画を「ねえ、これ見て」と見せられたとき', '忙しい時の割り込み',     'universal', 'general', 'コミュニケーション', true, false, false),
  ('パートナーが家事をしてくれているのを見て「助かるな」と思ったとき',                             '感謝の表現',             'universal', 'general', 'コミュニケーション', true, false, false),
  ('一生懸命話しているのに、パートナーの視線がずっとテレビやスマホに向いているとき',               '傾聴態度',               'universal', 'general', 'コミュニケーション', true, false, false);

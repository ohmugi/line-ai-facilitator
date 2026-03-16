# けみー (kemy) — CLAUDE.md

## プロジェクト概要

**けみー** は夫婦・パートナー間の子育て対話を深める LINE ボット + LIFF アプリ。
シナリオを読んで感情・考えを4ステップで答え、パートナーと比べて振り返るしくみ。

## 技術スタック

| 領域 | 技術 |
|------|------|
| LINE Bot サーバー | Node.js (ESM) + Express |
| フロントエンド (LIFF) | React + Vite + Tailwind CSS + Zustand |
| DB | Supabase (PostgreSQL) |
| AI | Anthropic Claude API (@anthropic-ai/sdk) |
| ホスティング | Render (サーバー) |

## ディレクトリ構成

```
src/
  server.js              # LINE Webhook エントリーポイント
  api/liff.js            # LIFF REST API（/api/liff/*）
  ai/                    # Claude API 呼び出し（Step別に分割）
  handlers/
    follow.js            # 友達追加イベント
    join.js              # グループ参加イベント
  session/sessionManager.js  # セッション状態管理（メモリ + DB）
  supabase/client.js     # Supabase クライアント

client/src/
  pages/
    HomePage.jsx         # ホーム（セッション一覧 + チュートリアル）
    SessionPage.jsx      # セッション進行（全ステップ）
    OnboardingPage.jsx   # 初回登録
    InviteAcceptPage.jsx # 招待受け取り（LIFFフォールバック）
    InviteGeneratePage.jsx
  stores/appStore.js     # Zustand グローバルストア
  api/client.js          # バックエンド API クライアント

supabase/migrations/     # マイグレーションSQL（005まで適用済み）
```

## セッションの流れ（親目線）

```
Step1-1: 感情選択（プリセット or 自由入力）
  └─「特に感情はない」の場合 → Step1-2 をスキップ
Step1-2: 感情の強度（1〜10）
Step1-3: 想い・考え（AI生成選択肢 or 自由入力）
Step2:   価値観・こだわり（AI生成チェックボックス or 自由入力）
Step3:   原体験（AI生成ラジオ or 自由入力）
Step4:   優先順位（ドラッグ&ドロップ + カスタム追加）
→ リフレクション生成
```

## セッションの流れ（子どもレンズ）

```
StepA: 子どもの行動予測（AI生成 or 自由入力）
StepB: 根拠の性質（固定選択肢 or 自由入力）
StepC: 感情反応（固定選択肢 or 自由入力）
StepD: 理想像（AI生成 or 自由入力）
→ リフレクション生成
```

## 招待フロー（最新）

1. 招待者が「LINEで送る」ボタンを押す
2. `VITE_LINE_OA_ID` 設定済み → `https://line.me/R/oaMessage/@{OA_ID}?text=join_{invite_code}` を共有
3. 招待された側がリンクをタップ → LINEが開いてbotに `join_XXXX` を送信
4. `server.js` が受信 → `liff_households.invite_code` で家族を特定 → `liff_users` を作成・紐づけ
5. bot が LIFF リンクを返信 → 以後はリッチメニューからアクセス可能

`VITE_LINE_OA_ID` 未設定の場合は LIFF 直URLにフォールバック。

## 環境変数

```
# サーバー側
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
SUPABASE_URL=
SUPABASE_KEY=
ANTHROPIC_API_KEY=
LIFF_ID=                  # 例: 2009352425-OUZXKZII

# フロントエンド側（client/.env に設定）
VITE_LIFF_ID=             # LIFF_IDと同じ
VITE_LINE_OA_ID=          # LINE公式アカウントID（@なし）
```

## DB テーブル（主要）

| テーブル | 役割 |
|---------|------|
| `liff_households` | 家族単位（invite_code, has_siblings） |
| `liff_users` | ユーザー（line_user_id, household_id, role） |
| `liff_sessions` | セッション（user1_id, user2_id, status） |
| `scenes` | シナリオ（session_type: parent/child_lens, requires_siblings） |
| `liff_answers` | 各ステップの回答 |

## 開発ルール

- **ブランチ**: `claude/review-codebase-status-TQflc` で開発・プッシュ
- **ビルド**: `cd client && npm run build`（public/ に出力される）
- **DB マイグレーション**: `supabase/migrations/` に SQL を追加し Supabase Dashboard の SQL Editor で実行
- **シナリオ初回配信**: 1件のみ（完了するごとに1件追加解放）
- **チュートリアル**: `localStorage['kemy_tutorial_seen']` で管理（初回ホーム表示時に表示）

## 直近の変更履歴

| 日付 | 内容 |
|------|------|
| 2026-03-16 | UX改善4点（招待フロー・チュートリアル・感情スキップ・自由入力） |
| 2026-03-16 | 子どもレンズ機能実装（005_child_lens.sql） |
| 2026-03-16 | シナリオ文言見直し・ひとりっ子除外対応 |

## よくある作業

```bash
# 開発サーバー起動
npm run dev

# フロントエンドビルド
npm run build

# git push（このブランチ限定）
git push -u origin claude/review-codebase-status-TQflc
```

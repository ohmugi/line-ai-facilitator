// src/ai/generateReflection.js
import { callClaude } from "./claude.js";

/**
 * リフレクションを生成（新フロー: アクション→感情→意図→スクリプト）
 * ユーザーの個性をポジティブに伝え、その個性を活かせる代替アクションも提示する
 */
export async function generateReflection({
  sceneText,
  actionChoice,
  emotionAnswer,
  intentChoice,
  scriptValues,
  identifiedTraits, // string[] | undefined
  userName,
}) {
  const traitText = identifiedTraits?.length
    ? identifiedTraits.join("、")
    : null;

  const system = `あなたは、夫婦の対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。

役割:
これまでの対話を振り返り、ユーザーへのリフレクションメッセージを送ってください。

メッセージのルール:
- 語尾は「にゃ」を使う
- 全体で8〜12行程度
- 構成:
  1. アクションと意図の肯定（「〜したかったんだにゃ」「〜しようと思ったのはすごくいいにゃ」）
  2. その奥にある感情とスクリプト（価値観）の言語化（「〜という気持ちの奥に〜があるにゃ」）
  3. ユーザーの個性を具体的にポジティブに伝える（「${userName}さんは〜な人にゃ」）
  4. その個性を活かせる他の関わり方を1〜2つ自然に提示（「その〜な力を使えば、〜もできるにゃ」）
- 個性が特定されていない場合は 3・4 を省略する
- 押し付けがましくなく、温かく背中を押すトーン
- 絵文字は🐾を最後に1回のみ

悪い例:
- 長すぎる（15行以上）
- 説教臭い
- 代替アクションを箇条書きで列挙する`;

  const traitLine = traitText ? `\n${userName}さんの個性: ${traitText}` : "";

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
${userName}さんのアクション: ${actionChoice}
気持ち: ${emotionAnswer}
意図: ${intentChoice}
スクリプト（価値観）: ${scriptValues}${traitLine}

リフレクションメッセージのみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 600 });
}

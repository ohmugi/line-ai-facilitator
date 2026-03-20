// src/ai/generateChildLensReflection.js
// 子どもレンズ リフレクション生成
import { callClaude } from "./claude.js";

/**
 * 個別リフレクション（子どもレンズ）
 * ユーザーの4ステップ回答を踏まえて、けみーからのメッセージを生成
 */
export async function generateChildLensReflection({
  sceneText,
  behaviorChoice,   // Step A: 子どもの行動予測
  reasonType,       // Step B: 根拠の性質
  feelingChoice,    // Step C: 感情反応
  idealChoice,      // Step D: 理想像
  userName,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
親が子どもを「どう見ているか」のレンズを振り返り、優しくフィードバックしてください。

メッセージのルール:
- 語尾は「にゃ」「にゃ🐾」を使う
- 全体で6〜9行程度
- 構成：①この親の子ども観の紹介 → ②その見方が生まれた背景（根拠タイプから推察）→ ③感情と理想の意味（理想像をStep A〜Cと接続して言及）→ ④子どもへの温かいまなざし
- Step D の理想像は列挙せず、「〇〇という気持ちの奥に△△な子どもになってほしいという願いがあるんだにゃ」という形で感情と接続して言及する
- 批判や正解提示はせず、「そういう見方があるんだにゃ」という発見のトーン
- 絵文字は🐾を最後の1箇所のみ`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

${userName}さんの回答:
- 子どもの行動予測: ${behaviorChoice}
- そう思う根拠: ${reasonType}
- 感情反応: ${feelingChoice}
- 子どもへの理想像: ${idealChoice}

${userName}さんへのリフレクションを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 500 });
}

/**
 * カップルリフレクション（子どもレンズ）
 * ふたりの子ども観の違いと共通点をけみーが届ける
 */
export async function generateChildLensCoupleReflection({
  sceneText,
  user1Name,
  user1Behavior,  // Step A
  user1Basis,     // Step B
  user1Feeling,   // Step C
  user1Ideal,     // Step D
  user2Name,
  user2Behavior,
  user2Basis,     // Step B
  user2Feeling,
  user2Ideal,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
ふたりの「子ども観」の違いと共通点を読んで、けみーからのメッセージとして届けてください。

メッセージのルール:
- 語尾は「にゃ」「にゃ🐾」を使う
- 全体で8〜12行程度
- 構成：①ふたりの子ども予測の紹介 → ②見方の違いが意味すること → ③感情と理想の重なりと差 → ④ふたりで子どもを見ることの強み
- 違いを「ズレ・問題」ではなく「子どもへの見方の豊かさ」として肯定的に翻訳する
- 「こういうシーンで意見が分かれやすいかも」という予告は優しく
- 最後は「ふたりの目があることで子どもがもらえるもの」で締める
- 絵文字は🐾を最後の1箇所のみ`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

${user1Name}さんの回答:
- 子どもの行動予測: ${user1Behavior}${user1Basis ? `\n- 根拠の性質: ${user1Basis}` : ""}
- 感情反応: ${user1Feeling}
- 子どもへの理想像: ${user1Ideal}

${user2Name}さんの回答:
- 子どもの行動予測: ${user2Behavior}${user2Basis ? `\n- 根拠の性質: ${user2Basis}` : ""}
- 感情反応: ${user2Feeling}
- 子どもへの理想像: ${user2Ideal}

ふたりへのメッセージを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 600 });
}

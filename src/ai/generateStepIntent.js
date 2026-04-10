// src/ai/generateStepIntent.js
import { callClaude } from "./claude.js";

/**
 * Step3: 意図の質問を生成（なぜそうしようと思ったか）
 */
export async function generateStepIntentQuestion({
  sceneText,
  actionChoice,
  emotionAnswer,
  userName,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。

役割:
ユーザーが選んだアクションの「なぜ」を引き出す質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 「なぜそうしたいのか」「何のためにそうしたいのか」を問う
- 具体的で答えやすい問いにする
- 詰問じゃなく、一緒に考える温かさ`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
${userName}さんがしたいこと: ${actionChoice}
${userName}さんの気持ち: ${emotionAnswer}

${userName}さんに、なぜそうしたいのかを聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 200 });
}

/**
 * Step3: 意図の選択肢を生成（なぜそうしようと思ったか）
 */
export async function generateStepIntentOptions({
  sceneText,
  actionChoice,
  emotionAnswer,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
ユーザーがそのアクションを取ろうと思った「意図・動機」の選択肢を3つ生成してください。

選択肢のルール:
- 「〜だから」「〜のために」「〜してあげたいから」のような動機・意図の表現
- 25文字以内
- 3つで異なる動機をカバー（子どものため／自分の気持ち／関係性のため など）
- 文として完結`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
したいこと: ${actionChoice}
気持ち: ${emotionAnswer}

このアクションを取ろうと思った「意図・動機」の選択肢を3つ生成してください。

出力フォーマット(このフォーマット厳守):
1. (選択肢1)
2. (選択肢2)
3. (選択肢3)`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 300 });
  return response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim());
}

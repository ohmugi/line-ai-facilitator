// src/ai/generateStepScript.js
import { callClaude } from "./claude.js";

/**
 * Step4: スクリプト（価値観・信念）の質問を生成
 */
export async function generateStepScriptQuestion({
  sceneText,
  actionChoice,
  emotionAnswer,
  intentChoice,
  userName,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。

役割:
ユーザーの意図の背後にある「価値観・信念（スクリプト）」を引き出す質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 「なぜそれが大事なのか」「どんな信念がそこにあるか」を問う
- 「〜すべき」「〜が大事」「〜であってほしい」などの信念を言語化させる
- 優しく、一緒に探る温度感`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
${userName}さんのアクション: ${actionChoice}
気持ち: ${emotionAnswer}
意図: ${intentChoice}

${userName}さんに、その意図の奥にある「価値観や信念」を聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 200 });
}

/**
 * Step4: スクリプト（価値観・信念）の選択肢を生成
 */
export async function generateStepScriptOptions({
  sceneText,
  actionChoice,
  emotionAnswer,
  intentChoice,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
ユーザーの意図の背後にある「価値観・信念」の選択肢を3つ生成してください。

選択肢のルール:
- 20文字以内
- 「〜すべき」「〜が大事」「〜を信じている」のような信念の表現
- 3つで信念の幅をカバー（ポジティブ/ネガティブ/中立）
- 文として完結`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
アクション: ${actionChoice}
気持ち: ${emotionAnswer}
意図: ${intentChoice}

この意図の背後にある「価値観や信念」の選択肢を3つ生成してください。

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

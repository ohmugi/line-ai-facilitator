// src/ai/generateStep2.js
import { callClaude } from "./claude.js";

/**
 * Step2の質問を生成(スクリプトを引き出す)
 */
export async function generateStep2Question({ sceneText, emotionAnswer, userName }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
相手の感情の裏にある「価値観・信念(スクリプト)」を引き出す質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 具体的で、答えやすい問いにする
- 「〜べき」「〜すべきじゃない」みたいな信念を引き出す
- 選択肢を示すと答えやすい(例:「〇〇かにゃ?それとも△△かにゃ?」)
- 詰問じゃなく、一緒に考える温度感

感情別のアプローチ:
- イライラ → 「こうあるべき」というべき論を問う
- 心配 → 「こうなったら困る」という恐れを問う
- 悲しい → 「本当はこうあってほしい」という願いを問う
- 嬉しい → 「これが大事」という価値観を問う`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
${userName}さんの気持ち: ${emotionAnswer}

${userName}さんに、その気持ちの裏にある「考え方や信念」を聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 300 });
}

/**
 * Step2の選択肢を生成(価値観・信念)
 */
export async function generateStep2Options({ sceneText, emotionAnswer }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
相手の感情の裏にある「価値観・信念」の選択肢を3つ生成してください。

選択肢のルール:
- 1つ20文字以内
- 「〜すべき」「〜が大事」「〜が怖い」のような信念
- 3つで感情の振れ幅をカバー(ポジティブ/ネガティブ/中立)
- 文として完結(単語ではなく、「〜と思う」「〜と感じる」)`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}

この気持ちの裏にありそうな「価値観や信念」の選択肢を3つ生成してください。

出力フォーマット(このフォーマット厳守):
1. (選択肢1)
2. (選択肢2)
3. (選択肢3)`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 300 });
  
  // 選択肢をパース
  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim());

  return options;
}

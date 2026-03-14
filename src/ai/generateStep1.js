// src/ai/generateStep1.js
import { callClaude } from "./claude.js";

/**
 * Step1-3 の選択肢を生成（シナリオ + 感情 + 強度を踏まえた想い・考え）
 */
export async function generateStep1Options({ sceneText, emotion, intensity }) {
  const intensityLabel =
    intensity <= 3 ? "少し" :
    intensity <= 5 ? "そこそこ" :
    intensity <= 7 ? "かなり" : "とても強く";

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
シナリオに対して、ユーザーの感情と強さを踏まえた「想い・考え」の選択肢を3つ生成してください。

選択肢のルール:
- ユーザーは「${emotion}」を「${intensityLabel}（${intensity}/10）」感じています
- この感情と強さに自然につながる、具体的な想い・考えを生成する
- 一人称で、「〜と思う」「〜が気になる」「〜してあげたい」のような自然な想い
- 25文字以内
- 3つで異なる視点をカバー
- 感情ラベルの繰り返しではなく、その場面で湧く具体的な考えや想い
- 文として完結していること`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
感情: ${emotion}（${intensityLabel}、${intensity}/10）

この感情を踏まえた「想い・考え」の選択肢を3つ生成してください。

出力フォーマット(このフォーマット厳守):
1. (選択肢1)
2. (選択肢2)
3. (選択肢3)`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 300 });

  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim());

  return options;
}

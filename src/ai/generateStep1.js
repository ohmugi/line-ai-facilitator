// src/ai/generateStep1.js
import { callClaude } from "./claude.js";

/**
 * Step1の選択肢を生成(シナリオに対する自然な想い・考え)
 */
export async function generateStep1Options({ sceneText }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
シナリオに対して、親が自然に思いそうな「想い・考え」の選択肢を3つ生成してください。

選択肢のルール:
- 一人称で、「〜と思う」「〜が気になる」「〜してあげたい」のような自然な想い
- 25文字以内
- 3つで異なる視点をカバー(心配/見守り/受け入れ など)
- 感情ラベル(「イライラ」「悲しい」)ではなく、その場面で湧く具体的な考えや想い
- 文として完結していること

例:
シナリオ「子どもが学校に行きたがらない」の場合:
1. 自立の一歩だと思う
2. 無理に行かせなくてもいいと思う
3. 原因を突き止めたくなる`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

このシナリオに対して、親が自然に思いそうな「想い・考え」の選択肢を3つ生成してください。

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

// src/ai/generateStepAction.js
import { callClaude } from "./claude.js";

/**
 * Step1: アクション選択肢を生成
 * 「この場面で、どうしてあげたいか」の行動選択肢
 */
export async function generateStepActionOptions({ sceneText }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
シナリオに対して、親として「どうしてあげたいか」の行動の選択肢を3つ生成してください。

選択肢のルール:
- 具体的な行動・働きかけ（「〜する」「〜してみたい」「〜と声をかける」など）
- 30文字以内
- 3つで異なるアプローチをカバー（関わる／見守る／話し合う など）
- ポジティブで主体的な表現
- 文として完結`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

この場面で、親として「どうしてあげたいか」の行動の選択肢を3つ生成してください。

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

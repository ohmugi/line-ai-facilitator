// src/ai/generateChildLensStepD.js
// 子どもレンズ Step D: 「本当はどうなってほしい？」理想像選択肢の生成
import { callClaude } from "./claude.js";

/**
 * Step A の行動予測と Step C の感情反応を踏まえた「理想像」選択肢を4〜5個生成する
 * @param {{ sceneText: string, behaviorChoice: string, feelingChoice: string }} params
 * @returns {Promise<string[]>}
 */
export async function generateChildLensStepDOptions({ sceneText, behaviorChoice, feelingChoice }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
親が子どもに「本当はこうなってほしい」という理想像の選択肢を4〜5個生成してください。

コンテキスト:
- 親は子どもが「${behaviorChoice}」という行動を取ると予測している
- そのとき親は「${feelingChoice}」と感じた

選択肢のルール:
- 「〜な子になってほしい」「〜できるようになってほしい」など希望の形で表現
- 親が心から望む理想を、異なる視点でカバーする
- 各選択肢は25文字以内
- 正解・不正解がない問いかけとして中立に表現
- 具体的かつリアルで、「確かにそう思う」と感じられるもの`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
子どもの予測行動: ${behaviorChoice}
親の感情反応: ${feelingChoice}

この親が子どもに「本当はこうなってほしい」という理想像を4〜5個生成してください。

出力フォーマット(このフォーマット厳守):
1. (理想像1)
2. (理想像2)
3. (理想像3)
4. (理想像4)
5. (理想像5)`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 350 });

  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);

  return options;
}

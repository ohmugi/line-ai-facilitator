// src/ai/generateChildLensStepA.js
// 子どもレンズ Step A: 「子どもはどうすると思う？」行動選択肢の生成
import { callClaude } from "./claude.js";

/**
 * 子どもが取りそうな行動の選択肢を4〜5個生成する
 * @param {{ sceneText: string }} params
 * @returns {Promise<string[]>}
 */
export async function generateChildLensStepAOptions({ sceneText }) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
シナリオに対して、子どもが実際に取りそうな「行動」の選択肢を4〜5個生成してください。

選択肢のルール:
- 子どもの行動を「動詞句」で表現する（例: ひとりで我慢する、泣いて助けを求める）
- 幅広い反応を網羅する（内向き・外向き・攻撃的・回避的など）
- 各選択肢は20文字以内
- 親が「うちの子はこれかな…」と思えるリアルなもの
- 良い・悪いの価値判断を含まない中立表現`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

このシナリオで子どもが取りそうな行動を4〜5個生成してください。

出力フォーマット(このフォーマット厳守):
1. (行動1)
2. (行動2)
3. (行動3)
4. (行動4)
5. (行動5)`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 300 });

  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);

  return options;
}

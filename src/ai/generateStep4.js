// src/ai/generateStep4.js
import { callClaude } from "./claude.js";

/**
 * Step4の質問を生成(どう関わりたいか)
 */
export async function generateStep4Question({
  sceneText,
  emotionAnswer,
  valueChoice,
  backgroundChoice,
  userName,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
スクリプトと原体験を振り返った上で、「子どもとどう関わりたいか」を聞く質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- これまでの振り返りを軽く言及しつつ、未来志向で問う
- 「〜したい」という主体的な意思を引き出す
- 温かく、励ますトーン

アプローチ例:
- 「ここまで振り返ってみて、この場面で子どもとどう関わっていきたいかにゃ?」
- 「自分のスクリプトが分かった上で、どんな声かけをしたいと思うかにゃ?」`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観・信念: ${valueChoice}
原体験: ${backgroundChoice}

${userName}さんに、子どもとどう関わっていきたいかを聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 300 });
}

/**
 * Step4の選択肢を生成(関わり方)
 */
export async function generateStep4Options({
  sceneText,
  emotionAnswer,
  valueChoice,
  backgroundChoice,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
「子どもとの関わり方」の選択肢を3つ生成してください。

選択肢のルール:
- 1つ25文字以内
- 具体的な行動や姿勢(「〜したい」「〜を大切にしたい」)
- 3つで関わり方のバリエーション(寄り添う/教える/見守る など)
- ポジティブで、主体的な表現`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観・信念: ${valueChoice}
原体験: ${backgroundChoice}

これらを踏まえた「子どもとの関わり方」の選択肢を3つ生成してください。

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

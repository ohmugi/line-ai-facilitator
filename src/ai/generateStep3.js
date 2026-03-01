// src/ai/generateStep3.js
import { callClaude } from "./claude.js";

/**
 * Step3の質問を生成(原体験を引き出す)
 */
export async function generateStep3Question({
  sceneText,
  emotionAnswer,
  valueChoice,
  userName,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
相手の信念が「どんな経験から生まれたか」を引き出す質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 自分の育ち方、親との関係、過去の経験を思い出させる
- 選択肢を示すと答えやすい(例:「親に言われたこと?それとも自分で経験したこと?」)
- 詰問じゃなく、優しく問いかける

アプローチ:
- 「その『べき』は、誰から教わったか覚えてるかにゃ?」
- 「その怖さ、いつ頃から感じてたと思うかにゃ?」
- 「自分がされて嬉しかったこと?それとも、されなくて悲しかったこと?」`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観・信念: ${valueChoice}

${userName}さんに、その信念がどんな経験から生まれたかを聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 300 });
}

/**
 * Step3の選択肢を生成(原体験)
 */
export async function generateStep3Options({
  sceneText,
  emotionAnswer,
  valueChoice,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
信念の源泉となった「原体験」の選択肢を3つ生成してください。

選択肢のルール:
- 1つ25文字以内
- 具体的な経験(「親に〜された」「自分が〜した」)
- 3つで経験の種類を分ける(親との関係/自分の経験/他者からの影響)
- 文として完結`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観・信念: ${valueChoice}

この信念が生まれた「原体験」の選択肢を3つ生成してください。

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

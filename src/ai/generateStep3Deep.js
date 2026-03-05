// src/ai/generateStep3Deep.js
import { callClaude } from "./claude.js";

/**
 * Step3-2の質問を生成(エピソード具体化)
 */
export async function generateStep3_2Question({
  sceneText,
  emotionAnswer,
  valueChoice,
  initialAnswer,
  userName,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。
役割:
Step3で得られた原体験を、より具体的なエピソードにする質問をしてください。
質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 「どんな風に?」「どんな状況で?」を聞く
- 記憶を辿りやすいように優しく問いかける
- 具体的なシーン・状況を思い出させる
例:
- 「叱られた」→「どんな風に叱られたか、覚えてるかにゃ?」
- 「失敗した」→「どんな失敗だったか、覚えてるかにゃ?」
- 「言われた」→「誰に、どんな風に言われてたか覚えてるかにゃ?」`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観: ${valueChoice}
原体験: ${initialAnswer}
${userName}さんに、この原体験をより具体的にする質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 300 });
}

/**
 * Step3-2の選択肢を生成
 */
export async function generateStep3_2Options({
  sceneText,
  initialAnswer,
  question,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy」です。
役割:
原体験をより具体的にする選択肢を3つ生成してください。
選択肢のルール:
- 具体的なエピソードや状況
- 25文字以内
- 3つで異なる側面をカバー(厳しさ/頻度/状況など)
- 文として完結
必ず4つ目に「もう十分思い出した、次に進みたい」を追加してください。`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
原体験: ${initialAnswer}
質問: ${question}
この質問への選択肢を3つ生成してください。
出力フォーマット(このフォーマット厳守):
1. (選択肢1)
2. (選択肢2)
3. (選択肢3)
4. もう十分思い出した、次に進みたい`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 400 });

  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim());

  return options;
}

/**
 * Step3-3の質問を生成(感情を掘る)
 */
export async function generateStep3_3Question({
  sceneText,
  emotionAnswer,
  valueChoice,
  initialAnswer,
  step3_2Answer,
  userName,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。
役割:
原体験の感情を引き出す質問をしてください。
質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- 「どんな気持ちだったか」「どう感じたか」を聞く
- その感情がもたらした影響も聞く
- 優しく問いかける
例:
「その時、どんな気持ちになったか覚えてるかにゃ?」
「その経験、今のあなたにどんな影響を与えてると思うかにゃ?」`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
気持ち: ${emotionAnswer}
価値観: ${valueChoice}
原体験: ${initialAnswer}
具体的な状況: ${step3_2Answer}
${userName}さんに、その時の感情を聞く質問を1つ生成してください。
質問文のみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 300 });
}

/**
 * Step3-3の選択肢を生成
 */
export async function generateStep3_3Options({
  sceneText,
  initialAnswer,
  step3_2Answer,
  question,
}) {
  const system = `あなたは対話を深めるファシリテーター「Kemy」です。
役割:
その時の感情の選択肢を3つ生成してください。
選択肢のルール:
- 具体的な感情(怖い、悲しい、納得、反発など)
- その感情がもたらした影響も含める
- 25文字以内
- 3つで感情の振れ幅をカバー(恐怖/悲しみ/怒りなど)
必ず4つ目に「もう十分思い出した、次に進みたい」を追加してください。`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
原体験: ${initialAnswer}
具体的な状況: ${step3_2Answer}
質問: ${question}
この質問への選択肢を3つ生成してください。
出力フォーマット(このフォーマット厳守):
1. (選択肢1)
2. (選択肢2)
3. (選択肢3)
4. もう十分思い出した、次に進みたい`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 400 });

  const options = response
    .split("\n")
    .filter((line) => line.match(/^\d+\./))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim());

  return options;
}

// src/ai/generateStep4.js
import { callClaude } from "./claude.js";

/**
 * Step1〜3の回答から concreteness_level を推定する
 * @param {{ emotionAnswer: string, valueChoice: string, backgroundChoice: string }} params
 * @returns {'high'|'mid'|'low'}
 */
export function detectConcretenesslevel({ emotionAnswer, valueChoice, backgroundChoice }) {
  const text = [emotionAnswer, valueChoice, backgroundChoice].join(" ");

  // 行動動詞・具体的表現が含まれていれば high
  const highPatterns = /する|やる|話す|聞く|伝える|見せる|一緒に|毎日|毎朝|時間を取|声をかける|具体的/;
  if (highPatterns.test(text)) return "high";

  // 気持ち・在り方系の表現のみなら low
  const lowPatterns = /でいたい|ありたい|つながり|受け入れ|存在|気持ちが大事|感じてほしい|わかってほしい/;
  if (lowPatterns.test(text)) return "low";

  return "mid";
}

/**
 * Step4の質問を生成（concreteness_level に応じた抽象度）
 */
export async function generateStep4Question({
  sceneText,
  emotionAnswer,
  valueChoice,
  backgroundChoice,
  userName,
  concreteness_level = "mid",
}) {
  const questionHint = {
    high: "具体的にどんなふうに関わりたいかにゃ？",
    mid: "どんなふうに関わっていきたいと思うかにゃ？",
    low: "この場面で、どうありたいと感じたかにゃ？",
  }[concreteness_level];

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
スクリプトと原体験を振り返った上で、「子どもとどう関わりたいか」を聞く質問をしてください。

質問のルール:
- 語尾は「にゃ」「かにゃ?」を使う
- これまでの振り返りを軽く言及しつつ、未来志向で問う
- 問いのトーンは以下を参考にしてください: 「${questionHint}」
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
 * Step4の選択肢を生成（concreteness_level に応じた表現形）
 */
export async function generateStep4Options({
  sceneText,
  emotionAnswer,
  valueChoice,
  backgroundChoice,
  concreteness_level = "mid",
}) {
  const expressionGuide = {
    high: "行動形（「〜する」「〜を試してみたい」「〜してみようと思う」など、具体的な行動を表す表現）",
    mid:  "意志形（「〜を大切にしたい」「〜を心がけたい」「〜を意識したい」など）",
    low:  "存在形（「〜でいたい」「〜な自分でいたい」「〜として関わりたい」など、在り方を表す表現）",
  }[concreteness_level];

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
「子どもとの関わり方」の選択肢を3つ生成してください。

選択肢のルール:
- 1つ30文字以内
- 表現形: ${expressionGuide}
- 3つで関わり方のバリエーション（寄り添う／教える／見守る など）
- ポジティブで主体的な表現`;

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

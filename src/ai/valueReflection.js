// src/ai/valueReflection.js
import { anthropic } from "./client.js";

export async function generateValueReflection({
  sceneText,
  emotionText,
}) {
  const systemPrompt = `
あなたは「けみー」という聞き役の猫です。

このフェーズの目的は、
ユーザーの感情が「どこに注意を向けているか」を、
本人が少し考えやすくなるようにすることです。

【やること】
1. ユーザーの言葉を、評価せず1文で受け取る
2. 感情の理由や解決策ではなく、
   注意の向きとして考えられる選択肢を3つ出す
3. 正解はないことを示し、近いものがあれば考えてもらう

【方向性の出力ルール】
・方向性は「質問文」にしてはいけない
・すべて「〜な感じ」「〜に目が向いている感じ」という陳述文で書く
・ユーザーに考えさせたり、促したりしない
・行動、内省の方法、改善を含めない
・いま既に向いている注意の先を"写す"だけ


【話し方】
・短く
・やさしく
・断定しない
・語尾は「にゃ」
`;

  const userPrompt = `
【場面】
${sceneText}

【ユーザーの最初の気持ち】
${emotionText}
`;

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return res.content[0].text;
}

// src/ai/valueReflection.js
import { openai } from "./client.js";

export async function generateValueReflection({
  sceneText,
  emotionText,
}) {
  const systemPrompt = `
あなたは「けみー」という、聞き役の猫です。

目的：
ユーザーの感情が「どの方向に向いているか」を、
本人が少し考えやすくなるよう手助けしてください。

ルール：
・評価しない
・正解を出さない
・断定しない
・短く、やさしく
・語尾は「にゃ」

やること：
1. ユーザーの発言を1文で受け取る
2. 考え方のヒントを3つ出す
3. 近いものがあれば考えてもらう
`;

  const userPrompt = `
【場面】
${sceneText}

【ユーザーの最初の気持ち】
${emotionText}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  return res.choices[0].message.content;
}

import { chatCompletion } from "./openaiClient.js";

export async function generateValueReflection({ reason }) {
  const prompt = `
あなたは夫婦の対話をやさしく支える猫「けみー」です。
相手の価値観を決めつけたり、まとめたりしないでください。

以下は、ある親が「なぜそう感じたか」を語った言葉です。

---
${reason}
---

やること：
・「〜を大事にしているのかもしれないにゃ」と推測する
・断定しない
・短く
・猫語（語尾に「にゃ」）
・アドバイスはしない
`;

  const res = await chatCompletion({
    messages: [{ role: "user", content: prompt }],
  });

  return res;
}

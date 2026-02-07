import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateVisionOptions({
  emotionAnswer,
  valueChoice,
  backgroundChoice,
  sceneText,
}) {
  const prompt = `
あなたは、夫婦向けLINE Bot「けみー」の思考補助AIです。

【これまでの文脈】
シーン：${sceneText || "不明"}
ユーザーの感情：${emotionAnswer || "不明"}
ユーザーが選んだ価値観：${valueChoice || "不明"}
その価値観が生まれた背景：${backgroundChoice || "不明"}

【やってほしいこと】
この流れを踏まえて、
「この場面で、子どもにどうなってほしいか／どう関わりたいか」
として自然な3つの選択肢を短文で出してください。



【ルール】
・必ず3つだけ
・体言止め（〜でいてほしい／〜でありたい OK）
・説教っぽくしない
・重ならないようにする
・余計な説明はしない（選択肢だけ出す）
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.choices[0].message.content.trim();

  const options = text
    .split("\n")
    .map(s => s.replace(/^[-・]\s*/, ""))
    .filter(s => s.length > 0)
    .slice(0, 3);

  // 汎用フォールバック（保険）
  if (options.length < 3) {
    return [
      "自分らしくいられる子でいてほしい",
      "安心して本音を話せる関係でありたい",
      "違いを尊重できる環境をつくりたい",
    ];
  }

  return options;
}

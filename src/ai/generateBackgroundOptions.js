import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateBackgroundOptions({
  emotionAnswer,
  valueChoice,
  sceneText,
}) {
  const prompt = `
あなたは、夫婦向けLINE Bot「けみー」の思考補助AIです。

【これまでの文脈】
シーン：
${sceneText || "不明"}

ユーザーの感情：
${emotionAnswer || "不明"}

ユーザーが選んだ考えの例：
${valueChoice || "不明"}

【あなたの役割（超重要）】
ユーザーの過去を“当てる”必要はありません。
「あり得そうな背景の例」を提示して、思い出すきっかけをつくってください。

【やってほしいこと】
この流れに沿って、
その考えが生まれた“あり得そうな経験の例”を3つだけ短文で出してください。




【ルール】
・必ず3つだけ
・体言止め
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
      "自分が決めつけられて嫌だった経験",
      "周囲の価値観に違和感を持った経験",
      "子ども時代に大切にされた記憶",
    ];
  }

  return options;
}

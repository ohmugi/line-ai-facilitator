import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateValueOptions({
  emotionAnswer,
  valueText,
  sceneText,
}) {
  const prompt = `
あなたは、夫婦向けLINE Bot「けみー」の思考補助AIです。

【状況】
シーン：${sceneText || "不明"}
ユーザーの感情：${emotionAnswer || "不明"}
ユーザーの考え：${valueText}

【やってほしいこと】
この考えをふまえて、
「価値観／社会規範」として自然な3つの選択肢を短文で出してください。



【ルール】
・必ず3つだけ
・体言止め（〜したい、〜が大事 などOK）
・説教っぽくしない
・意味が重ならないようにする
・余計な説明はしない（選択肢だけ出す）
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.choices[0].message.content.trim();

  // 箇条書き想定で整形
  const options = text
    .split("\n")
    .map(s => s.replace(/^[-・]\s*/, ""))
    .filter(s => s.length > 0)
    .slice(0, 3);

  // 万が一AIが失敗したときの保険（超重要）
  if (options.length < 3) {
    return [
          "子どもの気持ちを尊重したい",
         "周りに流されすぎたくない",
         "自分なりに考えて判断したい",
    ];
  }

  return options;
}

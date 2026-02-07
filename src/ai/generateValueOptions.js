import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateValueOptions({
  emotionAnswer,
  valueText,
  sceneText,
}) {
  const prompt = `
あなたは、夫婦向けLINE Bot「けみー」の思考補助AIです。

【状況】
シーン：${sceneText}
ユーザーの感情：${emotionAnswer || "不明"}
ユーザーの考え：${valueText}

【やってほしいこと】
この考えをふまえて、
「価値観／社会規範」として自然な3つの選択肢を短文で出してください。


【ルール】
・3つだけ出す
・体言止め（〜したい、〜が大事 などOK）
・説教っぽくしない
・重ならないようにする
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
  });

  // 想定：改行区切りで返ってくるので整形
  const text = res.choices[0].message.content.trim();
  const options = text
    .split("\n")
    .map(s => s.replace(/^[-・]\s*/, "")) // 先頭の「-」や「・」を除去
    .slice(0, 3);

  return options;
}

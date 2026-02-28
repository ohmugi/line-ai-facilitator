import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateValueOptions(context) {
  const prompt = `
【これまでの文脈】
シーン：
${context.sceneText || "不明"}

ユーザーの感情：
${context.emotion || "不明"}

ユーザーの価値観：
${context.value || "（まだなし）"}

【あなたの役割（超重要）】
あなたは「正解を当てる人」ではありません。
ユーザーが自分の考えを思い出したり、言葉にしやすくするための
"思考の足場（ヒント）"を提示してください。

【やってほしいこと】
このシーンと感情に沿って、
「あり得そうな考えの例」を3つだけ短文で出してください。

※ポイント
- ユーザーの本心を推測しなくてよい
- 「違ってもOK」な例でよい
- できるだけシーンに寄せる（抽象すぎない）
- 説教っぽくしない

【ルール】
・必ず3つだけ
・体言止め（〜したい、〜が大事 などOK）
・説教っぽくしない
・意味が重ならないようにする
・余計な説明はしない（選択肢だけ出す）
`;

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content[0].text.trim();

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

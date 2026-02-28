import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateBackgroundOptions(context) {
  const prompt = `
【これまでの文脈】
シーン：
${context.sceneText || "不明"}

ユーザーの感情：
${context.emotion || "不明"}

ユーザーが選んだ価値観：
${context.value || "不明"}

【あなたの役割（超重要）】
ユーザーの過去を"当てる"必要はありません。
「あり得そうな背景の例」を提示して、思い出すきっかけをつくってください。

【やってほしいこと】
この流れに沿って、
その考えが生まれた"あり得そうな経験の例"を3つだけ短文で出してください。




【ルール】
・必ず3つだけ
・体言止め
・重ならないようにする
・余計な説明はしない（選択肢だけ出す）
`;

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content[0].text.trim();

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

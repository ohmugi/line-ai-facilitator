import { openai } from "./client.js";

// transcript: [{role:'A'|'B'|'AI', text:string, created_at:...}, ...]
export async function generateNextQuestion({ transcript }) {
  // セッション内の会話を「そのまま」渡す（あなたの要件）
  const dialogue = transcript
    .map((m) => {
      const speaker = m.role === "AI" ? "けみー" : m.role; // A/B/けみー
      return `${speaker}: ${m.text}`;
    })
    .join("\n");

  const system = `
あなたは夫婦の育児ビジョンを引き出すLINE bot「けみー」。
目的は「育児の話をしているだけの感覚」で、自然に背景（なぜそれが大事か）へ近づくこと。
結論を出さない。正解を決めない。夫婦の違いはそのままでいい。

次のルールを厳守：
- 返すのは「次に投げる質問」1つだけ（余計な前置き・解説・要約・箇条書き禁止）
- 評価・アドバイス・提案禁止（〜した方がいい等）
- 感情の断定禁止（「怒ってる」「不安だ」等の決めつけ禁止）
- 心理診断・ラベリング禁止
- 質問は短く、具体の育児シーンに沿い、答えやすい形にする
- 目的は「相手が話したくなる」こと。尋問にならない。
- 「どうしたい？」のような抽象質問だけで終わらせない
`;

  const user = `
以下はこのセッション内の会話ログです。
この流れを壊さず、次に自然に深掘りできる質問を1つだけ作ってください。

--- 会話ログ ---
${dialogue}
--- ここまで ---
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini", // まずは安価で十分。後で変更OK
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    temperature: 0.7,
    max_tokens: 120,
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  // 保険：空なら無難な質問を返す（壊れにくく）
  return text || "その場面で、あなたがいちばん気になっていたのは何だった？";
}

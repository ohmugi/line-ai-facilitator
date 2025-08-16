import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// ---- env ----
const {
  PORT = 3000,
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

// ---- clients ----
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- util: LINE署名検証（任意/推奨）----
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hmac = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(body).digest("base64");
  return signature === hmac;
}

// ---- health ----
app.get("/health", (_req, res) => res.status(200).send("ok"));

// ---- 定数：固定質問（MVPは1問だけ）----
const QUESTION_ID = "q001";
const QUESTION_TEXT = "最近、お互いに「嬉しかった小さなこと」を1つ教えてください。";

// ---- コマンド: /sekirara start ----
app.post("/webhook", async (req, res) => {
  // 署名チェック（開発中は一時オフでもOK）
  // if (!verifyLineSignature(req)) return res.status(403).end();

  const events = req.body?.events || [];
  for (const ev of events) {
    try {
      if (ev.type === "message" && ev.message?.type === "text") {
        const text = ev.message.text.trim();
        const source = ev.source; // { type: 'group' | 'user' | ... , groupId?, userId? }

        // MVP: グループでのみ動かす
        if (source.type !== "group") continue;
        const groupId = source.groupId;

        // コマンドで質問を投下
        if (text === "/sekirara start") {
          await reply(ev.replyToken, [
            {
              type: "text",
              text:
                `【セキララ質問】\n${QUESTION_TEXT}\n\n` +
                "このスレッドでは、各自“最初の回答”だけ保存します。"
            }
          ]);
          continue;
        }

        // 回答の受理（/sekirara start 後は自由入力でOK）
        // 条件：テキストを送ったユーザの最初の回答のみ保存
        const userId = source.userId; // グループでも個人の userId が入る
        if (!userId) continue;

        // 既にこの userId が回答済みか？
        const { data: existed, error: selErr } = await supabase
          .from("answers")
          .select("id")
          .eq("group_id", groupId)
          .eq("user_id", userId)
          .eq("question_id", QUESTION_ID)
          .maybeSingle();

        if (selErr) {
          await push(groupId, `保存確認エラー：${selErr.message}`);
          continue;
        }

        if (!existed) {
          const { error: insErr } = await supabase
            .from("answers")
            .insert({
              group_id: groupId,
              user_id: userId,
              question_id: QUESTION_ID,
              text
            });

          if (insErr) {
            await push(groupId, `保存エラー：${insErr.message}`);
          } else {
            await push(groupId, "回答を受け取りました（最初の1回だけ保存します）");
          }

          // 2件そろったか or 片方だけ24h経過の判定は簡易でOK
          // ここでは「2件そろったら即AI返答」にします
          const { data: two, error: cntErr } = await supabase
            .from("answers")
            .select("id", { count: "exact", head: true })
            .eq("group_id", groupId)
            .eq("question_id", QUESTION_ID);

          if (!cntErr && two?.length === 0) {
            // head:true の場合 dataは空配列。件数は count で取得する方法も可。
          }

          // 再取得して実体を集める
          const { data: rows, error: getErr } = await supabase
            .from("answers")
            .select("user_id,text,created_at")
            .eq("group_id", groupId)
            .eq("question_id", QUESTION_ID)
            .order("created_at", { ascending: true });

          if (!getErr && rows && rows.length >= 2) {
            // 既に要約済みか？
            const { data: summed } = await supabase
              .from("ai_summaries")
              .select("id")
              .eq("group_id", groupId)
              .eq("question_id", QUESTION_ID)
              .maybeSingle();
            if (!summed) {
              const [a, b] = rows;
              const aiText = await buildAiSummary(QUESTION_TEXT, a.text, b.text);
              await supabase.from("ai_summaries").insert({
                group_id: groupId,
                question_id: QUESTION_ID,
                summary_text: aiText
              });
              await push(groupId, aiText);
            }
          }
        } else {
          // 2回目以降は保存しない
          await push(groupId, "今回は“最初の回答”だけ保存しています。");
        }
      }
    } catch (e) {
      // 失敗時は短く通知
      try { await push(ev.source.groupId, `処理に失敗しました：${e.message}`); } catch {}
    }
  }
  res.status(200).end();
});

// ---- AI 要約（OpenAI例：環境変数 OPENAI_API_KEY 必要）----
async function buildAiSummary(question, aText, bText) {
  const prompt =
    `質問:「${question}」\nAさん:「${aText}」\nBさん:「${bText}」\n` +
    `以下のフォーマットで短く。追い質問は禁止。\n` +
    `1) まとめ（3行以内）\n2) 共通点（1行）\n3) 相違点（1行）\n4) 次の一歩（1行, 今夜3分で実行できること）`;

  // 必要なモデルに置き換えてください（仮のシンプル実装）
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "短く、穏やかに、具体的に。フォーマット厳守。" },
        { role: "user", content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.4
    })
  });
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "要約に失敗しました。";
  return text;
}

// ---- LINE返信/プッシュ ----
async function reply(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ replyToken, messages })
  });
}

async function push(to, text) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }]
    })
  });
}

app.listen(PORT, () => console.log("listening on", PORT));

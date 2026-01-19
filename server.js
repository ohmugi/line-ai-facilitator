import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// LINE署名検証
function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// 固定の育児シーン質問（最初はDB使わない）
const QUESTION =
  "3〜4歳くらいのあなたの子どもが、うまくできなくて泣いているとき、あなたはどう思いますか？";

// Webhook
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  if (!validateSignature(body, signature)) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.body.events?.[0];
  if (!event || event.type !== "message" || event.message.type !== "text") {
    return res.sendStatus(200);
  }

  const replyToken = event.replyToken;
  const userText = event.message.text;
  const source = event.source;

  // グループ以外は無視（重要）
  if (source.type !== "group") {
    return res.sendStatus(200);
  }

  const householdId = source.groupId;

  // ① ユーザー発言を保存（仮）
  await supabase.from("messages").insert({
    household_id: householdId,
    role: "A", // 仮。あとでA/B判定
    text: userText,
    session_id: "debug-session",
  });

  // ② 質問を返す
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: `Aに聞くね。\n${QUESTION}`,
        },
      ],
    }),
  });

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("server running");
});

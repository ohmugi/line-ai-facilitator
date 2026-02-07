// src/line/replyQuick.js
import fetch from "node-fetch";

export async function replyQuickText(replyToken, text, options = []) {
  const body = {
    replyToken,
    messages: [
      {
        type: "text",
        text,
        quickReply: {
          items: options.map(opt => ({
            type: "action",
            action: {
              type: "message",
              label: opt,
              text: opt
            }
          }))
        }
      }
    ]
  };

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("LINE quick reply error:", err);
  }
}

// src/line/pushQuick.js

export async function pushQuickText(to, text, options = []) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      messages: [
        {
          type: "text",
          text,
          quickReply: {
            items: options.map((opt) => ({
              type: "action",
              action: { type: "message", label: opt.substring(0, 20), text: opt },
            })),
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[pushQuickText ERROR]", err);
  }
}

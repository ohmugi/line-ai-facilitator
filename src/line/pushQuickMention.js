// src/line/pushQuickMention.js
import fetch from "node-fetch";

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message/push";
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

/**
 * メンション付きクイックリプライをpush送信
 */
export async function pushQuickMention(to, text, options, mentionUserId, mentionName) {
  const mentionText = `@${mentionName} `;
  const fullText = mentionText + text;

  const quickReply = {
    items: options.slice(0, 13).map((option) => ({
      type: "action",
      action: {
        type: "message",
        label: option.substring(0, 20),
        text: option,
      },
    })),
  };

  const body = {
    to,
    messages: [
      {
        type: "text",
        text: fullText,
        quickReply,
        mention: {
          mentionees: [
            {
              index: 0,
              length: mentionText.length,
              userId: mentionUserId,
            },
          ],
        },
      },
    ],
  };

  const response = await fetch(LINE_MESSAGING_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[pushQuickMention ERROR]", error);
    throw new Error(`LINE API error: ${error}`);
  }

  console.log("[pushQuickMention] sent to:", mentionUserId);
}

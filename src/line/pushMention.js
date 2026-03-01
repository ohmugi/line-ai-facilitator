// src/line/pushMention.js
import fetch from "node-fetch";

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message/push";
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

/**
 * メンション付きメッセージをpush送信
 * @param {string} to - 送信先(groupId)
 * @param {string} text - メッセージ本文
 * @param {string} mentionUserId - メンション対象のLINE User ID
 * @param {string} mentionName - メンション対象の表示名
 */
export async function pushMention(to, text, mentionUserId, mentionName) {
  // メンション用のテキストを先頭に追加
  const mentionText = `@${mentionName} `;
  const fullText = mentionText + text;

  const body = {
    to,
    messages: [
      {
        type: "text",
        text: fullText,
        mention: {
          mentionees: [
            {
              index: 0, // @の位置
              length: mentionText.length, // @名前の長さ
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
    console.error("[pushMention ERROR]", error);
    throw new Error(`LINE API error: ${error}`);
  }

  console.log("[pushMention] sent to:", mentionUserId);
}

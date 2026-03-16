// src/handlers/follow.js
import { replyText } from "../line/reply.js";

export async function handleFollow({ event, replyToken }) {
  console.log("[FOLLOW] detected");
  if (replyToken) {
    const liffId = process.env.LIFF_ID;
    const msg = liffId
      ? `友だち追加ありがとうにゃ🐾\nけみーをひらくにゃ↓\nhttps://liff.line.me/${liffId}`
      : "友だち追加ありがとうにゃ🐾";
    await replyText(replyToken, msg);
  }
}

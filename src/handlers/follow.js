// src/handlers/follow.js
import { replyText } from "../line/reply.js";

export async function handleFollow({ replyToken }) {
  console.log("[FOLLOW] detected");
  if (replyToken) {
    await replyText(replyToken, "友だち追加ありがとうにゃ🐾");
  }
}

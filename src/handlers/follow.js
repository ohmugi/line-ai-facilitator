// src/handlers/follow.js
import { replyText } from "../line/reply.js";

export async function handleFollow({ event, replyToken }) {
  console.log("[FOLLOW] detected");
  if (replyToken) {
    const liffId = process.env.LIFF_ID;
    const msg = liffId
      ? `はじめまして。けみーだにゃ🐾\n友達になってくれてありがと🎉\nこれから夫婦で子どもについて話すサポートをさせてほしいにゃ✨\n\nやり方はかんたん。\n下のけみーのイラストをタップして、子どもの情報を登録して、パートナーにURLを送る📩\nあとはふたりでけみーの質問にこたえるだけにゃ🐱\n\nそれじゃ、待ってるね🌿\nhttps://liff.line.me/${liffId}`
      : `はじめまして。けみーだにゃ🐾\n友達になってくれてありがと🎉\nこれから夫婦で子どもについて話すサポートをさせてほしいにゃ✨\n\nやり方はかんたん。\nけみーのイラストをタップして、子どもの情報を登録して、パートナーにURLを送る📩\nあとはふたりでけみーの質問にこたえるだけにゃ🐱\n\nそれじゃ、待ってるね🌿`;
    await replyText(replyToken, msg);
  }
}

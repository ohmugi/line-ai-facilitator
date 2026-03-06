// src/handlers/join.js
import crypto from "crypto";
import { replyText } from "../line/reply.js";
import { pushMessage } from "../line/push.js";
import { startFirstSceneByPush } from "../logic/startFirstSceneByPush.js";

export async function handleJoin({ event, householdId, replyToken, startSession, getSession }) {
  console.log("JOIN EVENT ENTERED");
  console.log("[ONBOARDING] join detected");
  
  await startSession(householdId, crypto.randomUUID());

  // ★ セッション初期化は await の前に行う（memberJoined との競合を防ぐ）
  const session = getSession(householdId);
  // memberJoined が先に parents をセットしている場合は上書きしない
  if (!session.parents) session.parents = { A: null, B: null };

  if (!session.firstSpeaker) {
    session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
    console.log("[TURN] firstSpeaker:", session.firstSpeaker);
  }

  session.turn = session.firstSpeaker;
  session.finishedUsers = [];

  // ★ Step1: 自己紹介
  await replyText(
    replyToken,
    `はじめまして、Kemy(けみー)だにゃ🐾

わたしも子育て中の猫で、
パートナー猫とよく意見が合わなかったんだにゃ。

「なんでこの人、分かってくれないの?」
って思ってたんだけど、
ある日「なぜそう思うの?」って聞いてみたら、
育った環境が違うだけだったんだにゃ。

それが分かったら、
イライラが「へー、そうなんだ」に変わって、
なんか楽になったにゃ。

それから、同じように悩んでる夫婦の話を
聞くようになったんだにゃ。

ふたりはどんな風に感じるか、
教えてほしいにゃ🐾`
  );
  
  // ★ memberJoined が userId を確定してからシナリオを送るため、フラグだけ立てる
  session.pendingStart = true;
}


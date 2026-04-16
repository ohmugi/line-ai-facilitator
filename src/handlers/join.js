// src/handlers/join.js
import crypto from "crypto";
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

  // ★ Step1: 自己紹介（datetimepicker付き）
  const today = new Date().toISOString().split("T")[0];
  const replyRes = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: "text",
        text: `はじめまして、Kemy(けみー)だにゃ🐾

夫婦って、
同じ場面でも感じ方が違うこと、ない?

Kemyは、そんなふたりの「違い」を
一緒に見つける猫だにゃ。

やることは簡単:
Kemyがシナリオを出す
→ 選択肢から選ぶ
→ お互いの答えを見る

時間は5-10分くらい。
選ぶだけだから、負担ないにゃ🐾

---

【使い方は2パターン】

◆ 2人で盛り上がりたいなら:
夜、一緒にスマホを見ながら。
その場で「へー!」って会話が生まれるにゃ。

◆ ゆっくり考えたいなら:
好きな時間に、1人ずつ。
通勤中でも、寝る前でもOKだにゃ。

どっちでもいいし、
平日は1人ずつ、週末は一緒に、
みたいな使い分けもできるにゃ🐾

---

お子さんの年齢を教えてくれたら、
年齢に合ったシナリオをお届けできるにゃ。

[年齢を設定する]`,
        quickReply: {
          items: [{
            type: "action",
            action: {
              type: "datetimepicker",
              label: "📅 生まれ年月を選ぶ",
              data: "set_birth_date",
              mode: "date",
              initial: "2022-01-01",
              max: today,
              min: "2006-01-01",
            }
          }]
        }
      }]
    }),
  });
  if (!replyRes.ok) {
    const err = await replyRes.text();
    console.error("[handleJoin reply ERROR]", err);
  }
  
  // ★ memberJoined が userId を確定してからシナリオを送るため、フラグだけ立てる
  session.pendingStart = true;
}


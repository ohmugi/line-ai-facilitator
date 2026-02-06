// src/server.js
console.log("SERVER FILE LOADED");

import "dotenv/config";
import express from "express";
import crypto from "crypto";

import { replyText } from "./line/reply.js";
import { saveMessage } from "./supabase/messages.js";
import {
  startSession,
  isSessionActive,
  getSession,
  endSession,
} from "./session/sessionManager.js";

import { getActiveScene } from "./db/scenes.js";
import { getEmotionExamples } from "./supabase/emotionExamples.js";
import { getLineProfile } from "./line/getProfile.js";


// AI
import { generateDirection } from "./ai/generateDirection.js";
import { generateReflection } from "./ai/generateReflection.js";

const app = express();

/**
 * =========================
 * Health check
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";

/**
 * =========================
 * LINE署名検証
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const computed = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return computed === signature;
}

/**
 * =========================
 * Webhook
 * =========================
 */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    req.rawBody = req.body;

    if (!validateLineSignature(req)) {
      console.error("signature validation failed");
      return res.sendStatus(401);
    }

    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    res.sendStatus(200);
    handleWebhookEvents(body.events).catch(console.error);
  }
);

/**
 * =========================
 * Webhook handler
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    const source = event.source;
    const householdId =
      source.groupId || source.roomId || source.userId;
    const replyToken = event.replyToken;

    // --- セッション開始（postback / はじめる）---
    if (
      event.type === "postback" ||
      (event.type === "message" &&
        event.message?.type === "text" &&
        event.message.text.trim() === START_SIGNAL)
    ) {
     startSession(householdId, crypto.randomUUID());

// 名前を取得
const profile = await getLineProfile(source.userId);
const displayName = profile?.displayName || "あなた";

// セッションに必要な情報をまとめて入れる（★ここが重要）
const session = getSession(householdId);
session.currentUserId = source.userId;   // ← 追加
session.currentUserName = displayName;   // ← 既存
session.finishedUsers = [];              // ← 追加（切り替え用）

await sendSceneAndEmotion(replyToken, householdId);
continue;

    }

    // --- テキスト ---
    if (event.type === "message" && event.message?.type === "text") {
      const userText = event.message.text.trim();

      if (!isSessionActive(householdId)) {
        await replyText(replyToken, "けみーは聞いてるにゃ🐾");
        continue;
      }

      const session = getSession(householdId);
      console.log("[SESSION]", householdId, session.phase);

      await saveMessage({
        householdId,
        role: "A",
        text: userText,
        sessionId: session.sessionId,
      });

      switch (session.phase) {

        /**
         * ①② scene + emotion → ユーザー①
         */
        case "scene_emotion": {
          const directionText = await generateDirection({
            sceneId: session.sceneId,
            emotionText: userText,
          });

          session.phase = "direction";

          await saveMessage({
            householdId,
            role: "AI",
            text: directionText,
            sessionId: session.sessionId,
          });

          await replyText(replyToken, directionText);
          break;
        }

        /**
         * ③ direction → ユーザー②
         */
        case "direction": {
          session.phase = "background";
          await replyText(
  replyToken,
  `${session.currentUserName}さん、
そう感じた理由として、
自分のこれまでの経験や前提が
関係していそうなところはあるかにゃ？`
);

          break;
        }

        /**
         * ④ background → ユーザー③
         */
        case "background": {
          const reflection = await generateReflection({
            backgroundText: userText,
          });

          session.phase = "reflection";

          await saveMessage({
            householdId,
            role: "AI",
            text: reflection,
            sessionId: session.sessionId,
          });

          await replyText(replyToken, reflection);
          break;
        }

        /**
         * ⑤⑥ reflection → ユーザー④（任意）
         */
        case "reflection": {
          session.phase = "closing";
          await replyText(
            replyToken,
            `ここまで一緒に考えてくれてありがとうにゃ🐾
今日は、気持ちの奥にある見え方が
少し整理できた気がするにゃ。

また別の場面でも考えてみるにゃ🐾`
          );
          endSession(householdId);
          break;
        }
      }
    }
  }
}

/**
 * =========================
 * scene + emotion
 * =========================
 */
async function sendSceneAndEmotion(replyToken, householdId) {
  const scene = await getActiveScene();
  if (!scene) {
    await replyText(replyToken, "ごめんにゃ、準備中みたいにゃ🐾");
    return;
  }

  const session = getSession(householdId);
  const name = session.currentUserName || "あなた";

  const examples = await getEmotionExamples();
  const exampleLines = examples.map(e => `・${e}`).join("\n");

  // ★★★ ここでちゃんと message を定義する ★★★
  const message = `
${name}さん、けみーだにゃ🐾
ちょっと考えてほしい場面があるにゃ。

${scene.scene_text}

この場面を思い浮かべたとき、
いちばん最初に浮かんだ気持ちを
そのまま教えてほしいにゃ。

たとえば…
${exampleLines}
`;

  // セッション状態の更新
  session.phase = "scene_emotion";
  session.sceneId = scene.id;

  await replyText(replyToken, message);
}


/**
 * =========================
 * Server start
 * =========================
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});

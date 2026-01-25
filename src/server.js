// src/server.js
console.log("SERVER FILE LOADED");

import "dotenv/config";
import express from "express";
import crypto from "crypto";

// 既存ロジック
import { replyText } from "./line/reply.js";
import { saveMessage, getSessionTranscript } from "./supabase/messages.js";
// import { getRandomQuestion } from "./supabase/questions.js";
import {
  startSession,
  isSessionActive,
  getSession,
  proceedSession,
  endSession,
} from "./session/sessionManager.js";
import { generateNextQuestion } from "./ai/nextQuestion.js";
import { getActiveScene } from "./db/scenes.js";
import { getEmotionExamples } from "./supabase/emotionExamples.js";
import { generateValueReflection } from "./ai/valueReflection.js";


const app = express();

/**
 * =========================
 * Health check（Render）
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));
app.use((req, res, next) => {
  console.log("INCOMING:", req.method, req.url);
  next();
});

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

/**
 * =========================
 * LINE署名検証（自前・唯一）
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const computed = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  console.log("=== SIGNATURE DEBUG ===");
  console.log("header signature :", signature);
  console.log("computed signature:", computed);
  console.log("secret length     :", process.env.LINE_CHANNEL_SECRET?.length);
  console.log("rawBody length    :", req.rawBody?.length);
  console.log("=======================");

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
    // raw body 保存
    req.rawBody = req.body;

    // 署名検証
    if (!validateLineSignature(req)) {
      console.error("signature validation failed (custom)");
      return res.sendStatus(401);
    }

    // JSON parse
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    console.log("webhook OK (signature verified)");

    // LINE には即 200
    res.sendStatus(200);

    // 非同期処理
    handleWebhookEvents(body.events).catch(console.error);
  }
);

/**
 * =========================
 * Webhook 中身
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    console.log("EVENT TYPE =", event.type);
    console.log("source.type =", event.source?.type);

    const source = event.source;
    const householdId =
      source.groupId || source.roomId || source.userId;

    const replyToken = event.replyToken;

    // ===== postback（リッチメニュー） =====
    if (event.type === "postback") {
      const sessionId = crypto.randomUUID();
      startSession(householdId, sessionId, MAX_QUESTIONS);

      // await sendFirstScene(replyToken, householdId, sessionId);
      await sendFirstScene(replyToken, householdId);
      continue;
    }

    // ===== message（テキスト） =====
    if (event.type === "message" && event.message?.type === "text") {
      const userText = event.message.text.trim();

      // セッション開始
      if (userText === START_SIGNAL) {
        const sessionId = crypto.randomUUID();
        startSession(householdId, sessionId, MAX_QUESTIONS);

        // await sendFirstScene(replyToken, householdId, sessionId);
        await sendFirstScene(replyToken, householdId);

        continue;
      }

      // ===== セッション中 =====
   if (isSessionActive(householdId)) {
  const session = getSession(householdId);

  /**
   * ===== 価値観フェーズ =====
   */
  if (session.phase === "value") {
    const userReason = userText;

    await saveMessage({
      householdId,
      role: "A",
      text: userReason,
      sessionId: session.sessionId,
    });

    // AIで「価値観の芽」をやさしく返す
    const aiReply = await generateValueReflection({
      emotion: getSessionTranscript({ householdId, sessionId: session.sessionId }),
      reason: userReason,
    });

    await replyText(replyToken, aiReply);

    // セッションはここで一旦終える（次は将来、相手へ）
    endSession(householdId);

    await replyText(
      replyToken,
      "教えてくれてありがとうにゃ🐾\n次は、パートナーにも同じ場面を聞いてみたいにゃ。"
    );

    continue;
  }

  
        await sendNextAiQuestion(replyToken, householdId, session.sessionId);
        continue;
      }

      // セッション外の通常メッセージ
      await replyText(replyToken, "けみーは聞いてるにゃ🐾");
    }
  }
}

/**
 * =========================
 * シーン送信
 * =========================
 */async function sendFirstScene(replyToken, householdId) {
  const scene = await getActiveScene();

  if (!scene) {
    await replyText(replyToken, "ごめんにゃ、準備中みたいにゃ🐾");
    return;
  }

  const examples = await getEmotionExamples();
  const exampleLines = examples
    .map(e => `・「${e}」`)
    .join("\n");

  const message =
`けみーだにゃ🐾
ちょっと考えてほしい場面があるにゃ。

${scene.scene_text}

この場面を思い浮かべたとき、
いちばん最初に浮かんだ気持ちを教えてほしいにゃ🐾

うまく言葉にならなくても大丈夫にゃ。

たとえば…
${exampleLines}

近い感じでも、ちがう言葉でも大丈夫にゃ🐾`;

  // セッションにフェーズをセット
  const session = getSession(householdId);
  session.phase = "emotion";
  session.sceneId = scene.id;

  await replyText(replyToken, message);
}



/**
 * =========================
 * 質問送信
 * =========================
 */
// async function sendFirstQuestion(replyToken, householdId, sessionId) {
//   const q = await getRandomQuestion();
//
//   await saveMessage({
//     householdId,
//     role: "AI",
//     text: q.text,
//     sessionId,
//   });
//
//   await replyText(replyToken, `Aに聞くね。\n${q.text}`);
// }


async function sendNextAiQuestion(replyToken, householdId, sessionId) {
  const transcript = await getSessionTranscript({ householdId, sessionId });

  const nextQ = await generateNextQuestion({ transcript });

  await saveMessage({
    householdId,
    role: "AI",
    text: nextQ,
    sessionId,
  });

  await replyText(replyToken, `Aに聞くね。\n${nextQ}`);
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


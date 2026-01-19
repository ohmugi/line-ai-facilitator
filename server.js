//line-ai-facilitator/server.js

import express from "express";
import crypto from "crypto";
import { replyText } from "./line/reply.js";
import { supabase } from "./supabase/client.js";
import { getRandomQuestion } from "./supabase/questions.js";
import {
  startSession,
  isSessionActive,
  proceedSession,
  endSession,
} from "./session/sessionManager.js";

const app = express();
app.use(express.json());

const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

app.post("/webhook", async (req, res) => {
  const event = req.body.events?.[0];
  if (!event || event.type !== "message" || event.message.type !== "text") {
    return res.sendStatus(200);
  }

  const userText = event.message.text.trim();
  const replyToken = event.replyToken;
  const source = event.source;

  // グループ以外は無視
  if (source.type !== "group") {
    return res.sendStatus(200);
  }

  const householdId = source.groupId;

  // --- セッション開始 ---
  if (userText === START_SIGNAL) {
    startSession(householdId, MAX_QUESTIONS);

    const question = await getRandomQuestion();
    await supabase.from("messages").insert({
      household_id: householdId,
      role: "AI",
      text: question.text,
      session_id: householdId,
    });

    await replyText(replyToken, `Aに聞くね。\n${question.text}`);
    return res.sendStatus(200);
  }

  // --- セッション中 ---
  if (isSessionActive(householdId)) {
    // ユーザー発言保存
    await supabase.from("messages").insert({
      household_id: householdId,
      role: "A",
      text: userText,
      session_id: householdId,
    });

    const shouldContinue = proceedSession(householdId);

    if (!shouldContinue) {
      await replyText(
        replyToken,
        "いまの話を並べると、大事にしている背景がいくつかありそうだね。"
      );
      endSession(householdId);
      return res.sendStatus(200);
    }

    const question = await getRandomQuestion();
    await supabase.from("messages").insert({
      household_id: householdId,
      role: "AI",
      text: question.text,
      session_id: householdId,
    });

    await replyText(replyToken, `Aに聞くね。\n${question.text}`);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("server running on 3000");
});

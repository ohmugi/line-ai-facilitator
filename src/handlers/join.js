// src/handlers/join.js
import crypto from "crypto";
import { replyText } from "../line/reply.js";
import { startFirstSceneByPush } from "../logic/startFirstSceneByPush.js"; 
// ↑ もし startFirstSceneByPush が server.js 内関数なら、いったん後述の「最小復旧版」にする

export async function handleJoin({ event, householdId, replyToken, startSession, getSession }) {
  console.log("JOIN EVENT ENTERED");
  console.log("[ONBOARDING] join detected");

  startSession(householdId, crypto.randomUUID());

  await replyText(
    replyToken,
    `はじめまして、けみーだにゃ🐾  
よかったらおふたりの感じ方も、少しだけ教えてほしいにゃ。`
  );

  const session = getSession(householdId);
  session.parents = { A: null, B: null };

  if (!session.firstSpeaker) {
    session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
    console.log("[TURN] firstSpeaker:", session.firstSpeaker);
  }

  session.turn = session.firstSpeaker;
  session.finishedUsers = [];

  await startFirstSceneByPush(householdId);

  console.log("startFirstSceneByPush called");
}

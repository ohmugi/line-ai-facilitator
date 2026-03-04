//session/sessionManager.js
import { supabase } from "../supabase/client.js";

const sessions = {}; // householdId -> { sessionId, questionCount, maxQuestions, active, ... }

export async function startSession(householdId, sessionId, maxQuestions) {
  sessions[householdId] = {
    sessionId,
    questionCount: 0,
    maxQuestions,
    active: true,
    askedTotal: 1,
  };

  const { error } = await supabase.from("sessions").insert({
    id: sessionId,
    household_id: householdId,
    session_uuid: sessionId,
    status: "active",
    started_at: new Date().toISOString(),
    state: sessions[householdId],
  });

  if (error) {
    console.error("[sessionManager] DB insert error:", error.message);
  }
}

export function isSessionActive(householdId) {
  return sessions[householdId]?.active === true;
}

export function getSession(householdId) {
  return sessions[householdId] || null;
}

export async function saveSession(householdId) {
  const session = sessions[householdId];
  if (!session) return;

  const { error } = await supabase
    .from("sessions")
    .update({
      state: session,
      current_user_id: session.currentUserId || null,
      scene_id: session.sceneId || null,
      status: "active",
    })
    .eq("id", session.sessionId);

  if (error) {
    console.error("[sessionManager] DB update error:", error.message);
  }
}

export async function loadSessionFromDB(householdId) {
  if (sessions[householdId]?.active) return sessions[householdId];

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("household_id", householdId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.state) return null;

  sessions[householdId] = { ...data.state, active: true };
  console.log("[sessionManager] session restored from DB:", householdId);
  return sessions[householdId];
}

// 次の質問を続けるか判定して、内部カウントを進める
export function proceedSession(householdId) {
  const s = sessions[householdId];
  if (!s) return false;

  // これから「次の質問」を出すので +1
  s.askedTotal += 1;

  // 例：maxQuestions=3なら、1問目+2問目+3問目で終了
  return s.askedTotal <= s.maxQuestions;
}

export async function endSession(householdId) {
  const session = sessions[householdId];
  if (session) {
    const { error } = await supabase
      .from("sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        state: session,
      })
      .eq("id", session.sessionId);

    if (error) {
      console.error("[sessionManager] DB end error:", error.message);
    }
  }
  delete sessions[householdId];
}

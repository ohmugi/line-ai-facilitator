//supabase/messages.js
import { supabase } from "./client.js";

export async function saveMessage({ householdId, role, text, sessionId }) {
  const { error } = await supabase.from("messages").insert({
    household_id: householdId,
    role,
    text,
    session_id: sessionId,
  });
  if (error) throw error;
}

export async function getSessionTranscript({ householdId, sessionId }) {
  const { data, error } = await supabase
    .from("messages")
    .select("role, text, created_at")
    .eq("household_id", householdId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

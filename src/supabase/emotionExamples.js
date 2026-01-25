// src/supabase/emotionExamples.js
import { supabase } from "./client.js";

export async function getEmotionExamples() {
  const { data, error } = await supabase
    .from("emotion_examples")
    .select("label")
    .order("display_order", { ascending: true });

  if (error) {
    console.error("emotion_examples error:", error);
    return [];
  }

  return data.map(d => d.label);
}

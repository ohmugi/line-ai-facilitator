// src/supabase/emotionExamples.js
import { supabase } from "./client.js";

export async function getEmotionExamples() {
  const { data, error } = await supabase
    .from("emotion_examples")
    .select("id, label, display_order")
    .order("display_order", { ascending: true });

  if (error) throw error;
  return data || [];
}

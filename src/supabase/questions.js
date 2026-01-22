//supabase/questions.js
import { supabase } from "./client.js";

export async function getRandomQuestion() {
  const { data, error } = await supabase
    .from("questions")
    .select("id, text")
    .eq("is_active", true);

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("No active questions found");

  const idx = Math.floor(Math.random() * data.length);
  return data[idx];
}

//supabase/questions.js
import { supabase } from "./client.js";

export async function getRandomQuestion() {
  const { data, error } = await supabase
    .from("questions")
    .select("text")
    .eq("is_active", true);

  if (error || !data || data.length === 0) {
    throw new Error("No questions found");
  }

  const index = Math.floor(Math.random() * data.length);
  return data[index];
}

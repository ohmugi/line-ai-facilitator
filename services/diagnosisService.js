import { createClient } from '@supabase/supabase-js';
import { QUESTIONS } from '../utils/questions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function startDiagnosis(userId) {
  const { data, error } = await supabase
    .from('diagnosis_sessions')
    .insert([
      {
        user_id: userId,
        current_question: 0,
        scores: {}, // 初期スコア空
        finished: false,
      },
    ]);

  if (error) throw error;

  return QUESTIONS[0]; // 最初の設問を返す
}

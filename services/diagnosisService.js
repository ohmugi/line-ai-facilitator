import { createClient } from '@supabase/supabase-js';
import { QUESTIONS } from '../utils/questions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 診断開始
export async function startDiagnosis(userId) {
  await supabase
    .from('diagnosis_sessions')
    .insert([{ user_id: userId, current_question: 0, scores: {}, finished: false }]);
  return QUESTIONS[0];
}

// 回答処理
export async function processAnswer(userId, questionId, answerValue) {
  const { data: sessions } = await supabase
    .from('diagnosis_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('finished', false)
    .order('created_at', { ascending: false })
    .limit(1);

  const session = sessions[0];
  if (!session) throw new Error('セッションが見つからないにゃ');

  const newScores = { ...session.scores, [questionId]: parseInt(answerValue) };
  const nextQuestionIndex = session.current_question + 1;
  const isFinished = nextQuestionIndex >= QUESTIONS.length;

  await supabase
    .from('diagnosis_sessions')
    .update({
      scores: newScores,
      current_question: nextQuestionIndex,
      finished: isFinished,
    })
    .eq('id', session.id);

  return isFinished ? null : QUESTIONS[nextQuestionIndex];
}

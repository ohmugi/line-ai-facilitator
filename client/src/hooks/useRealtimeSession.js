// src/hooks/useRealtimeSession.js
// Supabase Realtime でパートナーの回答をリアルタイム受信
import { useEffect } from "react";
import { supabase } from "../api/supabase";
import { useAppStore } from "../stores/appStore";

export function useRealtimeSession(sessionId) {
  const userId             = useAppStore((s) => s.user?.id);
  const updatePartnerAnswer = useAppStore((s) => s.updatePartnerAnswer);

  useEffect(() => {
    if (!sessionId || !userId) return;

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "session_answers",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const { user_id, step, answer } = payload.new;
          // 自分以外の回答を受信したら partnerAnswers を更新
          if (user_id !== userId) {
            updatePartnerAnswer(step, answer);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, userId]);
}

// src/pages/HomePage.jsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Copy, MessageCircle } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { api } from "../api/client";
import { supabase } from "../api/supabase";

// ============================================================
// ユーティリティ
// ============================================================

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function getUserStep(session, userId) {
  if (!session || !userId) return null;
  if (session.user1_id === userId) return session.user1_current_step;
  if (session.user2_id === userId) return session.user2_current_step;
  return null;
}

function stepLabel(step) {
  const map = { step1: 1, step2: 2, step3: 3, step4: 4, completed: 4 };
  return map[step] ?? 0;
}

// ============================================================
// セッションカード
// ============================================================

function SessionCard({ session, userId, onPress }) {
  const myStep      = getUserStep(session, userId) || "step1";
  const scenarioTitle = session.scenario?.scene_text?.slice(0, 30) + "…" || "シナリオ";
  const date          = formatDate(session.delivered_at || session.created_at);

  // 自分の回答済みステップ数
  const myAnswers     = (session.answers || []).filter((a) => a.user_id === userId);
  const partnerAnswers = (session.answers || []).filter((a) => a.user_id !== userId);
  const myStepNum     = myAnswers.length;
  const partnerStepNum = partnerAnswers.length;

  if (session.status === "new" || (!myAnswers.length)) {
    return (
      <motion.div
        className="bg-yellow-50 rounded-2xl p-4 border border-yellow-100"
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">🆕</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800 text-sm leading-tight">{scenarioTitle}</p>
            <p className="text-xs text-gray-400 mt-0.5">{date}</p>
          </div>
        </div>
        <button
          onClick={onPress}
          className="w-full bg-yellow-400 text-white font-semibold py-2.5 rounded-xl text-sm"
        >
          一人で試してみる
        </button>
      </motion.div>
    );
  }

  if (session.status === "completed") {
    return (
      <motion.div
        className="bg-gray-50 rounded-2xl p-4 border border-gray-200"
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">✅</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-700 text-sm leading-tight">{scenarioTitle}</p>
            <p className="text-xs text-gray-400 mt-0.5">{date}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onPress}
            className="flex-1 bg-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm"
          >
            振り返りを見る
          </button>
          <button
            onClick={onPress}
            className="flex-1 border border-gray-300 text-gray-600 font-medium py-2.5 rounded-xl text-sm"
          >
            もう一度やる
          </button>
        </div>
      </motion.div>
    );
  }

  // in_progress
  return (
    <motion.div
      className="bg-orange-50 rounded-2xl p-4 border border-orange-100"
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-3 mb-2">
        <span className="text-2xl">👁️</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm leading-tight">{scenarioTitle}</p>
          <p className="text-xs text-gray-400 mt-0.5">{date} · Step {myStepNum}/4</p>
        </div>
      </div>
      <div className="flex gap-2 text-xs text-gray-500 mb-3">
        <span>あなた: Step {myStepNum}/4</span>
        {partnerStepNum > 0 && (
          <span>· パートナー: Step {partnerStepNum}/4</span>
        )}
      </div>
      <button
        onClick={onPress}
        className="w-full bg-orange-400 text-white font-semibold py-2.5 rounded-xl text-sm"
      >
        続きをやる
      </button>
    </motion.div>
  );
}

// ============================================================
// ホーム画面
// ============================================================

export default function HomePage() {
  const navigate   = useNavigate();
  const household  = useAppStore((s) => s.household);
  const user       = useAppStore((s) => s.user);
  const partner    = useAppStore((s) => s.partner);
  const sessions   = useAppStore((s) => s.sessions);
  const setSessions = useAppStore((s) => s.setSessions);

  const liffId    = import.meta.env.VITE_LIFF_ID;
  const inviteUrl = `https://liff.line.me/${liffId}?invite=${household?.invite_code}`;
  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(
    `パートナーを招待するにゃ🐾\n一緒に「けみー」をやってみよう！\n${inviteUrl}`
  )}`;

  // セッション一覧取得
  useEffect(() => {
    if (!household?.id) return;
    api.getSessions(household.id).then(({ sessions }) => setSessions(sessions));
  }, [household?.id]);

  // Realtime でセッション状態を自動更新
  useEffect(() => {
    if (!household?.id) return;
    const channel = supabase
      .channel(`household-sessions:${household.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "liff_sessions",
        filter: `household_id=eq.${household.id}`,
      }, () => {
        api.getSessions(household.id).then(({ sessions }) => setSessions(sessions));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [household?.id]);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐾</span>
          <span className="font-bold text-gray-800">けみー</span>
        </div>
        {partner && (
          <span className="text-xs text-gray-400">👤 {partner.display_name}と対話中</span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8">
        {/* パートナー未参加バナー */}
        {!partner && (
          <motion.div
            className="bg-green-50 rounded-2xl p-4 mb-4 border border-green-100"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <p className="text-sm font-semibold text-green-700 mb-1">
              📨 パートナーを招待しよう
            </p>
            <p className="text-xs text-green-600 mb-3">
              一緒にやるとお互いの答えが比べられるにゃ🐾
            </p>
            <div className="flex gap-2">
              <a href={lineShareUrl} className="flex-1">
                <button className="w-full flex items-center justify-center gap-1 bg-green-500 text-white text-xs font-medium py-2 rounded-xl">
                  <MessageCircle size={14} />
                  LINEで送る
                </button>
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(inviteUrl)}
                className="flex-1 flex items-center justify-center gap-1 border border-green-300 text-green-600 text-xs font-medium py-2 rounded-xl"
              >
                <Copy size={14} />
                URLをコピー
              </button>
            </div>
          </motion.div>
        )}

        {/* セッション一覧 */}
        {sessions.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-16">
            シナリオを読み込み中にゃ…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                userId={user?.id}
                onPress={() => navigate(`/session/${s.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

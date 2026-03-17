// src/pages/HomePage.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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
// チュートリアルオーバーレイ
// ============================================================
const TUTORIAL_STEPS = [
  {
    emoji: "🐾",
    title: "けみーへようこそ！",
    body: "けみーは、パートナーとの子育て対話を深めるためのアプリにゃ。\nシナリオに答えながら、お互いの気持ちや価値観を発見できるにゃ🐾",
  },
  {
    emoji: "💬",
    title: "こんな流れで進むにゃ",
    body: "①シナリオを読む\n②自分の感情・考えを4ステップで答える\n③パートナーの答えと比べてみる\n④けみーがふたりへのメッセージを届けるにゃ🐾",
  },
  {
    emoji: "✨",
    title: "シナリオは少しずつ増えるにゃ",
    body: "最初は1つのシナリオから始まるにゃ。\n1つ終えるたびに新しいシナリオが届くにゃ🐾\nまずは最初のシナリオに挑戦してみてにゃ！",
  },
];

function TutorialOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const current = TUTORIAL_STEPS[step];
  const isLast = step === TUTORIAL_STEPS.length - 1;

  return (
    <motion.div
      className="fixed inset-0 bg-black/50 flex items-end justify-center z-50"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <motion.div
        className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-8"
        initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ type: "spring", damping: 25 }}
      >
        <div className="flex justify-center mb-4">
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full mx-1 transition-colors ${i === step ? "bg-orange-400" : "bg-gray-200"}`}
            />
          ))}
        </div>
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">{current.emoji}</div>
          <h2 className="text-lg font-bold text-gray-800 mb-3">{current.title}</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{current.body}</p>
        </div>
        <button
          onClick={() => {
            if (isLast) {
              localStorage.setItem("kemy_tutorial_seen", "1");
              onDone();
            } else {
              setStep((s) => s + 1);
            }
          }}
          className="w-full bg-orange-400 text-white font-semibold py-4 rounded-2xl"
        >
          {isLast ? "はじめる 🐾" : "次へ →"}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// アカウントリセットボタン（テスト用）
// ============================================================

function ResetAccountButton() {
  const idToken = useAppStore((s) => s.idToken);
  const setUser = useAppStore((s) => s.setUser);
  const setHousehold = useAppStore((s) => s.setHousehold);
  const setPartner = useAppStore((s) => s.setPartner);
  const setSessions = useAppStore((s) => s.setSessions);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleReset() {
    setLoading(true);
    try {
      await api.resetAccount(idToken);
      // ストアをクリアしてオンボーディングに戻す
      setUser(null);
      setHousehold(null);
      setPartner(null);
      setSessions([]);
      localStorage.removeItem("kemy_tutorial_seen");
    } catch (err) {
      alert(`リセット失敗: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (confirm) {
    return (
      <div className="mt-8 p-4 bg-red-50 rounded-2xl border border-red-100 text-center">
        <p className="text-sm text-red-700 font-semibold mb-1">本当にリセットしますか？</p>
        <p className="text-xs text-red-500 mb-3">世帯・セッション・回答がすべて削除されます</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={handleReset}
            disabled={loading}
            className="px-4 py-2 bg-red-500 text-white text-xs rounded-xl font-medium disabled:opacity-50"
          >
            {loading ? "削除中…" : "リセットする"}
          </button>
          <button
            onClick={() => setConfirm(false)}
            className="px-4 py-2 border border-gray-300 text-gray-600 text-xs rounded-xl"
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 text-center">
      <button
        onClick={() => setConfirm(true)}
        className="text-xs text-gray-300 underline"
      >
        最初からやり直す
      </button>
    </div>
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

  const [showTutorial, setShowTutorial] = useState(
    () => localStorage.getItem("kemy_tutorial_seen") !== "1"
  );
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionError,    setSessionError]    = useState(null);
  const [copiedCode,      setCopiedCode]      = useState(false);

  const liffId   = import.meta.env.VITE_LIFF_ID;
  const lineOaId = import.meta.env.VITE_LINE_OA_ID;

  const inviteCode    = household?.invite_code ?? "";
  const liffInviteUrl = `https://liff.line.me/${liffId}?invite=${inviteCode}`;
  const inviteUrl     = lineOaId
    ? `https://line.me/R/oaMessage/@${lineOaId}?text=${encodeURIComponent(`join_${inviteCode}`)}`
    : liffInviteUrl;
  const lineShareUrl  = `https://line.me/R/msg/text/?${encodeURIComponent(
    `パートナーを招待するにゃ🐾\n招待コード: ${inviteCode}\n一緒に「けみー」をやってみよう！\n${inviteUrl}`
  )}`;
  const addFriendUrl  = lineOaId ? `https://line.me/R/ti/p/@${lineOaId}` : null;

  function copyCode() {
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function fetchSessions() {
    if (!household?.id) return;
    setLoadingSessions(true);
    setSessionError(null);
    api.getSessions(household.id)
      .then(({ sessions }) => setSessions(sessions))
      .catch((err) => setSessionError(err.message))
      .finally(() => setLoadingSessions(false));
  }

  // セッション一覧取得
  useEffect(() => {
    fetchSessions();
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
        api.getSessions(household.id)
          .then(({ sessions }) => setSessions(sessions))
          .catch(() => {});
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [household?.id]);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* チュートリアルオーバーレイ（初回のみ） */}
      <AnimatePresence>
        {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}
      </AnimatePresence>

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
            <p className="text-xs text-green-600 mb-1">
              一緒にやるとお互いの答えが比べられるにゃ🐾
            </p>

            {/* 招待コード表示 */}
            <div className="bg-white rounded-xl px-3 py-2 mb-3 flex items-center justify-between border border-green-200">
              <div>
                <p className="text-xs text-gray-400">招待コード</p>
                <p className="font-mono font-bold text-green-700 text-base tracking-widest">{inviteCode}</p>
              </div>
              <button
                onClick={copyCode}
                className="flex items-center gap-1 text-xs text-green-600 border border-green-300 rounded-lg px-2 py-1"
              >
                <Copy size={12} />
                {copiedCode ? "コピー済み✓" : "コピー"}
              </button>
            </div>

            <div className="flex gap-2">
              <a href={lineShareUrl} className="flex-1">
                <button className="w-full flex items-center justify-center gap-1 bg-green-500 text-white text-xs font-medium py-2 rounded-xl">
                  <MessageCircle size={14} />
                  LINEで送る
                </button>
              </a>
              {addFriendUrl && (
                <a href={addFriendUrl} className="flex-1">
                  <button className="w-full flex items-center justify-center gap-1 border border-green-300 text-green-600 text-xs font-medium py-2 rounded-xl">
                    友だち追加
                  </button>
                </a>
              )}
            </div>
          </motion.div>
        )}

        {/* セッション一覧 */}
        {loadingSessions ? (
          <div className="text-center text-gray-400 text-sm py-16">
            シナリオを読み込み中にゃ…
          </div>
        ) : sessionError ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm mb-3">読み込みに失敗したにゃ😿</p>
            <button
              onClick={fetchSessions}
              className="text-xs text-green-600 border border-green-300 rounded-xl px-4 py-2"
            >
              再試行にゃ
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-16">
            シナリオの準備中にゃ…少し待ってにゃ🐾
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

        {/* リセットボタン（テスト用） */}
        <ResetAccountButton />
      </div>
    </div>
  );
}

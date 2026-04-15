// src/pages/HomePage.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, MessageCircle } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { api } from "../api/client";
import { supabase } from "../api/supabase";

// ============================================================
// ドメイン定義
// ============================================================
const DOMAINS = [
  { id: "育児",             label: "育児",             emoji: "🧒" },
  { id: "子の個性",         label: "子の個性",         emoji: "🌱" },
  { id: "お金",             label: "お金",             emoji: "💰" },
  { id: "コミュニケーション", label: "コミュニケーション", emoji: "💬" },
];

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

function getPartnerStep(session, userId) {
  if (!session || !userId) return null;
  if (session.user1_id === userId) return session.user2_current_step;
  if (session.user2_id === userId) return session.user1_current_step;
  return null;
}

/**
 * セッションの実施状態を返す
 * "new" | "in_progress" | "one_done" | "both_done"
 */
function getSessionStatus(session, userId) {
  const myStep      = getUserStep(session, userId);
  const partnerStep = getPartnerStep(session, userId);
  const myDone      = myStep === "completed";
  const partnerDone = partnerStep === "completed";

  if (myDone && partnerDone) return "both_done";
  if (myDone || partnerDone) return "one_done";

  const hasMyAnswers = (session.answers || []).some((a) => a.user_id === userId);
  if (hasMyAnswers || session.status === "in_progress") return "in_progress";
  return "new";
}

// ============================================================
// セッションカード
// ============================================================

function SessionCard({ session, userId, onPress }) {
  const status = getSessionStatus(session, userId);
  const scenarioTitle = session.scenario?.scene_text?.slice(0, 32) + "…" || "シナリオ";
  const date          = formatDate(session.delivered_at || session.created_at);

  const myAnswers      = (session.answers || []).filter((a) => a.user_id === userId);
  const partnerAnswers = (session.answers || []).filter((a) => a.user_id !== userId);

  // 状態バッジ
  const badges = {
    new:       { emoji: "🆕", bg: "bg-yellow-50",  border: "border-yellow-100",  tag: "未実施",          tagColor: "bg-yellow-100 text-yellow-700" },
    in_progress:{ emoji: "📝", bg: "bg-orange-50", border: "border-orange-100",  tag: "途中",            tagColor: "bg-orange-100 text-orange-700" },
    one_done:  { emoji: "👤", bg: "bg-blue-50",    border: "border-blue-100",    tag: "一人だけ完了",    tagColor: "bg-blue-100 text-blue-700" },
    both_done: { emoji: "✅", bg: "bg-gray-50",    border: "border-gray-200",    tag: "ふたりとも完了",  tagColor: "bg-green-100 text-green-700" },
  };
  const badge = badges[status] || badges.new;

  const buttonLabel = {
    new:        "やってみる",
    in_progress: "続きをやる",
    one_done:   "自分の回答を見る / 続きをやる",
    both_done:  "振り返りを見る",
  }[status];

  const buttonClass = {
    new:        "bg-yellow-400 text-white",
    in_progress:"bg-orange-400 text-white",
    one_done:   "bg-blue-400 text-white",
    both_done:  "bg-gray-200 text-gray-600",
  }[status];

  return (
    <motion.div
      className={`${badge.bg} rounded-2xl p-4 border ${badge.border}`}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-3 mb-2">
        <span className="text-2xl">{badge.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm leading-tight">{scenarioTitle}</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-gray-400">{date}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.tagColor}`}>
              {badge.tag}
            </span>
          </div>
        </div>
      </div>

      {/* 進行状況バー（一人以上が途中/完了の場合） */}
      {(status === "in_progress" || status === "one_done" || status === "both_done") && (
        <div className="flex gap-2 text-xs text-gray-500 mb-3">
          {myAnswers.length > 0 && (
            <span>自分: {myAnswers.length}step{status === "one_done" && getUserStep(session, userId) === "completed" ? "（完了）" : ""}</span>
          )}
          {partnerAnswers.length > 0 && (
            <span>· パートナー: {partnerAnswers.length}step{getPartnerStep(session, userId) === "completed" ? "（完了）" : ""}</span>
          )}
        </div>
      )}

      <button
        onClick={onPress}
        className={`w-full font-semibold py-2.5 rounded-xl text-sm ${buttonClass}`}
      >
        {buttonLabel}
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
    body: "けみーは、パートナーとの対話を深めるためのアプリにゃ。\nシナリオに答えながら、お互いの気持ちや価値観を発見できるにゃ🐾",
  },
  {
    emoji: "💬",
    title: "こんな流れで進むにゃ",
    body: "①シナリオを読む\n②自分の気持ち・考えを質問に答えながら整理する\n③パートナーの答えと比べてみる\n④けみーがふたりへのメッセージを届けるにゃ🐾",
  },
  {
    emoji: "🗂️",
    title: "ドメインでシナリオを切り替えにゃ",
    body: "「育児」「子の個性」「お金」「コミュニケーション」の4つのテーマがあるにゃ。\n最初は育児から3つ届くにゃ。1つ終えると全シナリオが一気に解放されるにゃ🐾",
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
  const [activeDomain,    setActiveDomain]    = useState("育児");

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

  // アクティブドメインのセッションだけ表示
  const filteredSessions = (sessions || []).filter(
    (s) => (s.scenario?.domain ?? "育児") === activeDomain
  );

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

      {/* ドメインタブ（横スクロール） */}
      <div className="bg-white border-b border-gray-100 px-4 overflow-x-auto">
        <div className="flex gap-1 min-w-max py-2">
          {DOMAINS.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveDomain(d.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors
                ${activeDomain === d.id
                  ? "bg-orange-400 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              <span>{d.emoji}</span>
              <span>{d.label}</span>
            </button>
          ))}
        </div>
      </div>

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
        ) : filteredSessions.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-16">
            {sessions.length === 0
              ? "シナリオの準備中にゃ…少し待ってにゃ🐾"
              : `「${activeDomain}」のシナリオはまだないにゃ🐾\n育児シナリオを1つ完了すると解放されるにゃ！`}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                userId={user?.id}
                onPress={() => navigate(`/session/${s.id}`)}
              />
            ))}
          </div>
        )}

        <ResetAccountButton />
      </div>
    </div>
  );
}

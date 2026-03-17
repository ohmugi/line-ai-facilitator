// src/pages/InviteAcceptPage.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAppStore } from "../stores/appStore";
import { api } from "../api/client";
import LoadingScreen from "../components/LoadingScreen";

export default function InviteAcceptPage({ inviteCode }) {
  const navigate    = useNavigate();
  const idToken     = useAppStore((s) => s.idToken);
  const setUser     = useAppStore((s) => s.setUser);
  const setHousehold = useAppStore((s) => s.setHousehold);
  const setPartner  = useAppStore((s) => s.setPartner);

  const [inviter,  setInviter]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [joining,  setJoining]  = useState(false);
  const [joined,   setJoined]   = useState(false);
  const [error,    setError]    = useState(null);

  const lineOaId     = import.meta.env.VITE_LINE_OA_ID;
  const addFriendUrl = lineOaId ? `https://line.me/R/ti/p/@${lineOaId}` : null;

  useEffect(() => {
    api.getInvite(inviteCode)
      .then(({ inviterName }) => setInviter(inviterName))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [inviteCode]);

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      const { user, household, partner } = await api.joinInvite(idToken, inviteCode);
      setUser(user);
      setHousehold(household);
      setPartner(partner);
      setJoined(true);
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  if (loading) return <LoadingScreen />;

  // 参加完了 → 友だち追加を促してからホームへ
  if (joined) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center min-h-screen px-6 gap-5"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="text-6xl">🎉</span>
        <h1 className="text-xl font-bold text-gray-800 text-center">
          {inviter ? `${inviter}さんと繋がったにゃ🐾` : "参加完了にゃ🐾"}
        </h1>

        {addFriendUrl ? (
          <>
            <div className="bg-yellow-50 rounded-2xl p-4 border border-yellow-100 text-sm text-yellow-800 text-center leading-relaxed">
              けみーをいつでも開けるよう、<br />LINE公式アカウントを友だち追加しておくにゃ🐾<br />
              <span className="text-xs text-yellow-600">（リッチメニューからアクセスできるようになるにゃ）</span>
            </div>
            <a href={addFriendUrl} className="w-full max-w-xs">
              <button className="w-full bg-green-500 text-white font-semibold py-4 rounded-2xl">
                友だち追加する
              </button>
            </a>
            <button
              onClick={() => navigate("/home")}
              className="text-xs text-gray-400 underline"
            >
              あとでやる → ホームへ
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate("/home")}
            className="w-full max-w-xs bg-green-500 text-white font-semibold py-4 rounded-2xl"
          >
            ホームへ →
          </button>
        )}
      </motion.div>
    );
  }

  if (!idToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-4">
        <span className="text-4xl">📱</span>
        <p className="text-gray-600 text-center text-sm">
          LINEアプリ内から招待リンクを開いてにゃ🐾
        </p>
      </div>
    );
  }

  if (error && !inviter) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-4">
        <span className="text-4xl">😿</span>
        <p className="text-gray-600 text-center">{error}</p>
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <span className="text-6xl mb-6">🐾</span>

      <h1 className="text-xl font-bold text-gray-800 mb-2 text-center">
        {inviter ? `${inviter}さんから招待されたにゃ🐾` : "招待されたにゃ🐾"}
      </h1>
      <p className="text-sm text-gray-500 mb-8 text-center">
        一緒に対話を始めるにゃ？
      </p>

      {error && (
        <p className="text-red-500 text-sm mb-4 text-center">{error}</p>
      )}

      <button
        onClick={handleJoin}
        disabled={joining}
        className="w-full max-w-xs bg-green-500 disabled:bg-gray-200 text-white font-semibold py-4 rounded-2xl transition-colors"
      >
        {joining ? "参加中にゃ…" : "参加する"}
      </button>
    </motion.div>
  );
}

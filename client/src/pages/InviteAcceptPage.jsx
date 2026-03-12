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

  const [inviter, setInviter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error,   setError]   = useState(null);

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
      navigate("/home");
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  if (loading) return <LoadingScreen />;

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

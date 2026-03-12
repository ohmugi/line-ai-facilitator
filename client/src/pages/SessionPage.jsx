// src/pages/SessionPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X, User, Users } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useAppStore } from "../stores/appStore";
import { useRealtimeSession } from "../hooks/useRealtimeSession";
import { api } from "../api/client";
import LoadingScreen from "../components/LoadingScreen";

const STEPS = ["step1", "step2", "step3", "step4"];

// ============================================================
// ドラッグ&ドロップアイテム (Step4)
// ============================================================
function SortableItem({ id, label, rank }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 border mb-2 cursor-grab
        ${isDragging ? "shadow-lg border-orange-300" : "border-gray-100 shadow-sm"}`}
    >
      <span className="text-lg font-bold text-orange-400 w-6">{rank}.</span>
      <span className="text-sm text-gray-700 flex-1">{label}</span>
      <span className="text-gray-300">⠿</span>
    </div>
  );
}

// ============================================================
// Step コンポーネント群
// ============================================================

/** Step1: 気持ち選択 + スライダー */
function Step1({ options, onChange, value }) {
  const [thought,   setThought]   = useState(value?.thought   || "");
  const [intensity, setIntensity] = useState(value?.intensity || 5);

  useEffect(() => {
    if (thought) onChange({ thought, intensity });
  }, [thought, intensity]);

  const intensityLabel = intensity <= 3 ? "少し" : intensity <= 6 ? "そこそこ" : "かなり";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {(options || []).map((opt) => (
          <label
            key={opt}
            className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
              ${thought === opt ? "border-orange-400 bg-orange-50" : "border-gray-100 bg-white"}`}
          >
            <input
              type="radio"
              className="accent-orange-400"
              checked={thought === opt}
              onChange={() => setThought(opt)}
            />
            <span className="text-sm text-gray-700">{opt}</span>
          </label>
        ))}
      </div>

      {thought && (
        <motion.div
          className="bg-white rounded-2xl p-5 border border-gray-100"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <p className="text-sm font-medium text-gray-600 mb-3">
            その気持ちの強さは？
          </p>
          <input
            type="range" min="1" max="10"
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="w-full accent-orange-400"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>少し</span><span>普通</span><span>かなり</span>
          </div>
          <p className="text-center text-sm text-orange-500 font-medium mt-2">
            {intensityLabel}（{intensity}/10）
          </p>
        </motion.div>
      )}
    </div>
  );
}

/** Step2: チェックボックス（複数選択） */
function Step2({ options, question, onChange, value }) {
  const [selected, setSelected] = useState(value?.values || []);

  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter((v) => v !== opt)
      : [...selected, opt];
    setSelected(next);
    onChange({ values: next });
  };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-green-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-green-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
            ${selected.includes(opt) ? "border-green-400 bg-green-50" : "border-gray-100 bg-white"}`}
        >
          <input
            type="checkbox"
            className="accent-green-500 w-4 h-4"
            checked={selected.includes(opt)}
            onChange={() => toggle(opt)}
          />
          <span className="text-sm text-gray-700">{opt}</span>
        </label>
      ))}
    </div>
  );
}

/** Step3: 原体験選択 */
function Step3({ options, question, onChange, value }) {
  const [background, setBackground] = useState(value?.background || "");

  const handleChange = (opt) => {
    setBackground(opt);
    onChange({ background: opt });
  };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-blue-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-blue-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
            ${background === opt ? "border-blue-400 bg-blue-50" : "border-gray-100 bg-white"}`}
        >
          <input
            type="radio"
            className="accent-blue-500"
            checked={background === opt}
            onChange={() => handleChange(opt)}
          />
          <span className="text-sm text-gray-700">{opt}</span>
        </label>
      ))}
    </div>
  );
}

/** Step4: ドラッグ&ドロップ優先順位 */
function Step4({ options, question, onChange, value }) {
  const [items, setItems] = useState(
    value?.priorities?.map((p) => p.value) || options || []
  );

  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    if (options && !value?.priorities) setItems(options);
  }, [options]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.indexOf(active.id);
    const newIdx = items.indexOf(over.id);
    const next   = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    onChange({
      priorities: next.map((v, i) => ({ rank: i + 1, value: v, importance: 10 - i * 2 })),
    });
  };

  return (
    <div>
      {question && (
        <div className="bg-purple-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-purple-700">{question}</p>
        </div>
      )}
      <p className="text-xs text-gray-400 mb-3">ドラッグして優先順位を変えてにゃ</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((item, idx) => (
            <SortableItem key={item} id={item} label={item} rank={idx + 1} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

// ============================================================
// パートナータブ
// ============================================================
function PartnerTab({ partnerAnswers, scenario }) {
  if (!partnerAnswers?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-4xl">⏳</span>
        <p className="text-sm text-gray-400 text-center">
          パートナーの回答待ちにゃ🐾
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {partnerAnswers.map((a) => (
        <div key={a.step} className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs font-medium text-gray-400 mb-2">
            {a.step === "step1" ? "Step1: 気持ち" :
             a.step === "step2" ? "Step2: 価値観" :
             a.step === "step3" ? "Step3: 原体験" : "Step4: 関わり方"}
          </p>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap">
            {JSON.stringify(a.answer, null, 2)
              .replace(/[{}"\[\]]/g, "")
              .replace(/,\n/g, "\n")
              .trim()}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// リフレクション
// ============================================================
function ReflectionView({ reflection, userId, user1Id, user1Name, user2Name, onHome }) {
  const myReflection      = reflection?.perUser?.[userId];
  const differenceSummary = reflection?.difference;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      {myReflection && (
        <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
          <p className="text-xs font-medium text-orange-400 mb-2">けみーより🐾</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {myReflection}
          </p>
        </div>
      )}

      {differenceSummary && (
        <div className="bg-green-50 rounded-2xl p-5 border border-green-100">
          <p className="text-xs font-medium text-green-500 mb-2">
            ふたりの違いと共通点 💡
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {differenceSummary}
          </p>
        </div>
      )}

      <button
        onClick={onHome}
        className="w-full bg-gray-800 text-white font-semibold py-4 rounded-2xl mt-4"
      >
        ホームに戻る
      </button>
    </motion.div>
  );
}

// ============================================================
// セッション画面メイン
// ============================================================

export default function SessionPage() {
  const { sessionId }  = useParams();
  const navigate       = useNavigate();
  const user           = useAppStore((s) => s.user);
  const partner        = useAppStore((s) => s.partner);
  const partnerAnswers = useAppStore((s) => s.partnerAnswers);
  const setPartnerAnswers = useAppStore((s) => s.setPartnerAnswers);
  const setCurrentAnswers = useAppStore((s) => s.setCurrentAnswers);

  const [session,    setSession]    = useState(null);
  const [myAnswers,  setMyAnswers]  = useState({});      // { step1: {}, step2: {}, ... }
  const [stepIndex,  setStepIndex]  = useState(0);      // 0〜3
  const [tab,        setTab]        = useState("me");   // "me" | "partner"
  const [options,    setOptions]    = useState(null);
  const [question,   setQuestion]   = useState(null);
  const [loadingOpts,setLoadingOpts]= useState(false);
  const [saving,     setSaving]     = useState(false);
  const [reflection, setReflection] = useState(null);
  const [showReflection, setShowReflection] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);

  useRealtimeSession(sessionId);

  // セッション読み込み
  useEffect(() => {
    api.getSession(sessionId).then(({ session, answers }) => {
      setSession(session);

      // 自分の回答を復元
      const mine = answers.filter((a) => a.user_id === user?.id);
      const map  = {};
      mine.forEach((a) => { map[a.step] = a.answer; });
      setMyAnswers(map);

      // パートナーの回答を復元
      const theirs = answers.filter((a) => a.user_id !== user?.id);
      setPartnerAnswers(theirs.map((a) => ({ step: a.step, answer: a.answer })));

      // 完了済みリフレクションを復元
      if (session.status === "completed" && session.reflection) {
        setReflection(session.reflection);
        setShowReflection(true);
      }

      // 自分の現在ステップを計算
      const completedSteps = mine.map((a) => a.step);
      const nextIdx = STEPS.findIndex((s) => !completedSteps.includes(s));
      setStepIndex(nextIdx === -1 ? 4 : nextIdx);

      setLoading(false);
    });
  }, [sessionId, user?.id]);

  // 選択肢を取得
  useEffect(() => {
    if (!session || stepIndex >= 4) return;
    const step = STEPS[stepIndex];
    if (myAnswers[step]) return; // 回答済みは再取得しない

    setLoadingOpts(true);
    api.getOptions(sessionId, step, user?.id)
      .then(({ options, question }) => {
        setOptions(options);
        setQuestion(question);
      })
      .finally(() => setLoadingOpts(false));
  }, [stepIndex, session?.id]);

  const currentStep    = STEPS[stepIndex];
  const currentAnswer  = myAnswers[currentStep];
  const isCompleted    = stepIndex >= 4;

  const handleAnswerChange = (answer) => {
    setMyAnswers((prev) => ({ ...prev, [currentStep]: answer }));
  };

  const handleNext = async () => {
    if (!currentAnswer) return;
    setSaving(true);
    try {
      await api.saveAnswer(sessionId, user.id, currentStep, currentAnswer);
      setMyAnswers((prev) => ({ ...prev, [currentStep]: currentAnswer }));

      if (stepIndex === 3) {
        // Step4完了 → リフレクション生成
        const { reflection } = await api.completeSession(sessionId, user.id);
        setReflection(reflection);
        setShowReflection(true);
        setStepIndex(4);
      } else {
        setOptions(null);
        setQuestion(null);
        setStepIndex((i) => i + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const scenarioText = session?.scenario?.scene_text || "";
  const stepLabel    = ["Step 1/4", "Step 2/4", "Step 3/4", "Step 4/4", "完了"][stepIndex];
  const partnerNew   = partnerAnswers.filter(
    (a) => !Object.keys(myAnswers).includes(a.step)
  ).length;

  // ============================================================
  // UI
  // ============================================================
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <button onClick={() => setConfirmExit(true)} className="p-1">
          <ArrowLeft size={22} className="text-gray-600" />
        </button>
        <span className="text-sm font-medium text-gray-600">
          {showReflection ? "リフレクション" : stepLabel}
        </span>
        <button onClick={() => setConfirmExit(true)} className="p-1">
          <X size={22} className="text-gray-400" />
        </button>
      </header>

      {/* シナリオ */}
      <div className="bg-white mx-4 mt-4 rounded-2xl p-4 border border-gray-100">
        <p className="text-xs text-gray-400 mb-1">シナリオ</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          {scenarioText.length > 80 ? scenarioText.slice(0, 80) + "…" : scenarioText}
        </p>
      </div>

      {/* タブ */}
      {!showReflection && (
        <div className="flex mx-4 mt-3 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab("me")}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === "me" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}
          >
            <User size={15} />
            自分
          </button>
          <button
            onClick={() => setTab("partner")}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors relative
              ${tab === "partner" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}
          >
            <Users size={15} />
            パートナー
            {partnerNew > 0 && (
              <span className="absolute top-1 right-3 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">
                {partnerNew}
              </span>
            )}
          </button>
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        <AnimatePresence mode="wait">
          {showReflection ? (
            <motion.div key="reflection"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            >
              <ReflectionView
                reflection={reflection}
                userId={user?.id}
                user1Id={session?.user1_id}
                user1Name={session?.user1?.display_name}
                user2Name={session?.user2?.display_name}
                onHome={() => navigate("/home")}
              />
            </motion.div>
          ) : tab === "partner" ? (
            <motion.div key="partner"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              <PartnerTab partnerAnswers={partnerAnswers} scenario={session?.scenario} />
            </motion.div>
          ) : loadingOpts ? (
            <motion.div key="loading"
              className="flex flex-col items-center py-16 gap-3"
            >
              <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400">けみーが考え中にゃ…</p>
            </motion.div>
          ) : (
            <motion.div key={currentStep}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            >
              {currentStep === "step1" && (
                <Step1
                  options={options}
                  value={currentAnswer}
                  onChange={handleAnswerChange}
                />
              )}
              {currentStep === "step2" && (
                <Step2
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={handleAnswerChange}
                />
              )}
              {currentStep === "step3" && (
                <Step3
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={handleAnswerChange}
                />
              )}
              {currentStep === "step4" && (
                <Step4
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={handleAnswerChange}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 次へボタン */}
      {!showReflection && tab === "me" && !loadingOpts && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-100 px-4 py-4">
          <button
            onClick={handleNext}
            disabled={!currentAnswer || saving}
            className="w-full bg-orange-400 disabled:bg-gray-200 text-white disabled:text-gray-400 font-semibold py-4 rounded-2xl transition-colors"
          >
            {saving
              ? "保存中にゃ…"
              : stepIndex === 3
              ? "完了してリフレクションを見る 🐾"
              : "次へ →"}
          </button>
        </div>
      )}

      {/* 離脱確認ダイアログ */}
      <AnimatePresence>
        {confirmExit && (
          <motion.div
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setConfirmExit(false)}
          >
            <motion.div
              className="bg-white w-full max-w-md rounded-t-3xl p-6"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-base font-semibold text-gray-800 mb-1">中断しますか？</p>
              <p className="text-sm text-gray-500 mb-6">
                回答は保存されているにゃ。後で続きからできるにゃ🐾
              </p>
              <button
                onClick={() => navigate("/home")}
                className="w-full bg-gray-800 text-white font-semibold py-3 rounded-2xl mb-3"
              >
                ホームに戻る
              </button>
              <button
                onClick={() => setConfirmExit(false)}
                className="w-full text-gray-500 py-2"
              >
                続ける
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// src/App.jsx
import { Component } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useLiff } from "./hooks/useLiff";
import { useAppStore } from "./stores/appStore";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "20px", color: "#333" }}>
          <h2>エラーが発生しました</h2>
          <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap" }}>
            {String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

import OnboardingPage     from "./pages/OnboardingPage";
import InviteGeneratePage from "./pages/InviteGeneratePage";
import InviteAcceptPage   from "./pages/InviteAcceptPage";
import HomePage           from "./pages/HomePage";
import SessionPage        from "./pages/SessionPage";
import LoadingScreen      from "./components/LoadingScreen";

function AppRoutes() {
  const liffReady = useAppStore((s) => s.liffReady);
  const user      = useAppStore((s) => s.user);
  const household = useAppStore((s) => s.household);

  if (!liffReady) return <LoadingScreen />;

  // 招待URL経由かどうかを URLパラメータで判断
  const params     = new URLSearchParams(window.location.search);
  const inviteCode = params.get("invite");

  if (inviteCode) {
    return (
      <Routes>
        <Route path="*" element={<InviteAcceptPage inviteCode={inviteCode} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/onboarding"      element={<OnboardingPage />} />
      <Route path="/invite-generate" element={
        household ? <InviteGeneratePage /> : <Navigate to="/onboarding" replace />
      } />
      <Route path="/home" element={
        user && household ? <HomePage /> : <Navigate to="/onboarding" replace />
      } />
      <Route path="/session/:sessionId" element={
        user ? <SessionPage /> : <Navigate to="/onboarding" replace />
      } />
      <Route path="*" element={
        user && household
          ? <Navigate to="/home" replace />
          : <Navigate to="/onboarding" replace />
      } />
    </Routes>
  );
}

export default function App() {
  useLiff();
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen max-w-md mx-auto">
          <AppRoutes />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

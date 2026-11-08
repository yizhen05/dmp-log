"use client";

import { useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const callback = () => `${window.location.origin}/auth/callback`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg("ログインできませんでした。メールアドレスとパスワードを確認してください。");
      else window.location.href = "/";
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callback() },
      });
      if (error) setMsg(`登録できませんでした：${error.message}`);
      else if (data.session) window.location.href = "/";
      else setMsg("確認メールを送りました。メールのリンクを開くと登録が完了します。");
    }
    setBusy(false);
  }

  async function oauth(provider: "google" | "x") {
    setBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: callback() },
    });
    if (error) {
      setMsg(`ログインできませんでした：${error.message}`);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>dmp-log</h1>
      <p className="muted">DMPランキングの戦績ノート</p>

      <div className="card">
        <button className="btn oauth" disabled={busy} onClick={() => oauth("google")}>
          Googleでログイン
        </button>
        <button className="btn oauth x" disabled={busy} onClick={() => oauth("x")}>
          X（Twitter）でログイン
        </button>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}>
            メールでログイン
          </button>
          <button className={mode === "up" ? "on" : ""} onClick={() => setMode("up")}>
            新規登録
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="f">
            <label>メールアドレス</label>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="f">
            <label>パスワード{mode === "up" ? "（6文字以上）" : ""}</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" style={{ width: "100%" }} disabled={busy}>
            {mode === "in" ? "ログイン" : "登録する"}
          </button>
        </form>
        {msg && <p className="muted" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>
    </main>
  );
}

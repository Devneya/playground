import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "./useAuth";

type Mode = "login" | "signup" | "recovery" | "reset";

export const AuthScreen = () => {
  const { login, signup, sendRecovery, updatePassword, signInWithOAuth, recovery } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (recovery) setMode("reset");
  }, [recovery]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "login") await login(email, password);
      else if (mode === "signup") {
        await signup(email, password);
        setMessage("Check your email to confirm your account.");
      } else if (mode === "recovery") {
        await sendRecovery(email);
        setMessage("If an account exists, a recovery link is on its way.");
      } else {
        await updatePassword(password);
        setMessage("Your password has been updated.");
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to complete that request.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-screen">
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Devneya Playground</p>
      <h1 id="auth-title">Build and compare model workflows.</h1>
      <p className="muted">Sign in to keep named flows in this browser and run them through your Devneya account.</p>
      <div className="auth-oauth">
        <button type="button" onClick={() => void signInWithOAuth("google")} disabled={busy}>Continue with Google</button>
        <button type="button" onClick={() => void signInWithOAuth("github")} disabled={busy}>Continue with GitHub</button>
      </div>
      <div className="auth-divider"><span>or</span></div>
      <form onSubmit={submit}>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
        {mode !== "recovery" && <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send recovery link"}</button>
      </form>
      <div className="auth-links">
        <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Already have an account? Sign in"}</button>
        <button type="button" onClick={() => setMode(mode === "recovery" ? "login" : "recovery")}>{mode === "recovery" ? "Back to sign in" : "Forgot password?"}</button>
      </div>
    </section>
  </main>;
};

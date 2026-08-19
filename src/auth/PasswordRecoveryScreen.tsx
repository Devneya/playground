import { useState, type FormEvent } from "react";
import { useAuth } from "./useAuth";

export const PasswordRecoveryScreen = () => {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      setMessage("Your password has been updated. You can continue to the playground.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to update your password.");
    } finally {
      setBusy(false);
    }
  };
  return <main className="auth-screen"><section className="auth-card" aria-labelledby="recovery-title">
    <p className="eyebrow">Devneya Playground</p>
    <h1 id="recovery-title">Set a new password.</h1>
    <p className="muted">This recovery session is ready. Choose a password to continue.</p>
    <form onSubmit={submit}>
      <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
    </form>
    <button className="text-button" type="button" onClick={() => void signOut()}>Sign out</button>
  </section></main>;
};

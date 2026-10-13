import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnectionSettings } from "./useConnectionSettings";

export const ConnectionSetup = ({ serviceError }: { serviceError?: string } = {}) => {
  const { connection, changing, chooseDevneya, connectOpenAI, cancelChange } = useConnectionSettings();
  const [enteringKey, setEnteringKey] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { controllerRef.current?.abort(); }, []);

  const devneya = () => {
    controllerRef.current?.abort();
    setBusy(false);
    try { chooseDevneya(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to choose this connection."); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    try { await connectOpenAI(key, controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to connect to OpenAI."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <main className="auth-screen connection-screen"><section className="auth-card connection-card" aria-labelledby="connection-title">
    <p className="eyebrow">Devneya Playground</p>
    <h1 id="connection-title">Choose your connection.</h1>
    <p className="muted">Choose OpenAI API key or continue with your Devneya account.</p>
    <div className="connection-options">
      <button type="button" className="connection-option" onClick={() => { setEnteringKey(true); setError(null); }} disabled={busy}>Use OpenAI API key</button>
      <button type="button" className="primary-button" onClick={devneya} disabled={busy}>Continue with Devneya</button>
    </div>
    {enteringKey && <form onSubmit={submit}>
      <label>OpenAI API key<input type="password" autoFocus autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} required disabled={busy} /></label>
      <p className="connection-hint"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get an API key from OpenAI</a></p>
      <p className="connection-hint">Saved in this browser. Used only with OpenAI. API usage is billed separately from your ChatGPT subscription.</p>
      <p className="connection-hint">Connecting checks your key and loads models. It does not send a prompt or spend inference tokens.</p>
      {busy ? <button type="button" className="text-button" onClick={() => { controllerRef.current?.abort(); setBusy(false); }}>Cancel key check</button> : <button type="submit" className="primary-button" disabled={!key.trim()}>Connect to OpenAI</button>}
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {serviceError && <p className="form-error" role="alert">{serviceError}</p>}
    {connection && changing && <button className="text-button connection-back" type="button" onClick={() => { controllerRef.current?.abort(); cancelChange(); }}>Back to {connection.provider === "openai" ? "OpenAI" : connection.provider === "devneya" ? "Devneya" : "Local Codex"}</button>}
  </section></main>;
};

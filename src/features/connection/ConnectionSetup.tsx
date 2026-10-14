import { useEffect, useRef, useState, type FormEvent } from "react";
import { API_KEY_PROVIDERS, providerLabel, type ApiKeyCandidate } from "../../api/apiKeyProviders";
import type { ApiKeyProviderId } from "../../domain/types";
import { useConnectionSettings } from "./useConnectionSettings";

const providerOptionLabel = (provider: ApiKeyProviderId) => providerLabel(provider);

export const ConnectionSetup = ({ serviceError }: { serviceError?: string } = {}) => {
  const { connection, changing, chooseDevneya, connectApiKeyProvider, cancelChange } = useConnectionSettings();
  const [enteringKey, setEnteringKey] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ApiKeyProviderId>("openai");
  const [key, setKey] = useState("");
  const [customBaseURL, setCustomBaseURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const selectedProviderRef = useRef<ApiKeyProviderId>("openai");
  useEffect(() => () => { controllerRef.current?.abort(); }, []);

  const cancelCheck = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
  };

  const chooseDevneyaConnection = () => {
    cancelCheck();
    setEnteringKey(false);
    setSelectedProvider("openai");
    selectedProviderRef.current = "openai";
    setKey("");
    setError(null);
    try { chooseDevneya(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to choose this connection."); }
  };

  const toggleApiKeySetup = () => {
    if (enteringKey) {
      cancelCheck();
      setEnteringKey(false);
      setKey("");
      setError(null);
      return;
    }
    setEnteringKey(true);
    setError(null);
  };

  const selectProvider = (nextProvider: ApiKeyProviderId) => {
    if (nextProvider === selectedProviderRef.current) return;
    selectedProviderRef.current = nextProvider;
    cancelCheck();
    setSelectedProvider(nextProvider);
    setKey("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const candidate: ApiKeyCandidate = selectedProvider === "custom"
      ? { provider: "custom", apiKey: key, baseURL: customBaseURL }
      : { provider: selectedProvider, apiKey: key };
    setBusy(true);
    setError(null);
    try {
      await connectApiKeyProvider(candidate, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted && selectedProviderRef.current === candidate.provider) {
        setError(failure instanceof Error ? failure.message : `Unable to connect to ${providerLabel(candidate.provider)}.`);
      }
    } finally {
      if (!controller.signal.aborted && selectedProviderRef.current === candidate.provider) setBusy(false);
    }
  };

  const selectedLabel = providerOptionLabel(selectedProvider);
  const keyLabel = selectedProvider === "custom" ? "API key" : `${selectedLabel} API key`;
  const connectLabel = selectedProvider === "custom" ? "Connect to custom endpoint" : `Connect to ${selectedLabel}`;

  return <main className="auth-screen connection-screen"><section className="auth-card connection-card" aria-labelledby="connection-title">
    <p className="eyebrow">Devneya Playground</p>
    <h1 id="connection-title">Choose your connection.</h1>
    <p className="muted">Continue with Devneya or connect an API key from a provider.</p>
    <div className="connection-options">
      <button type="button" className="primary-button" onClick={chooseDevneyaConnection}>Continue with Devneya</button>
      <button type="button" className="connection-option" onClick={toggleApiKeySetup} aria-expanded={enteringKey} aria-controls="api-key-setup">Use an API key</button>
    </div>
    {enteringKey && <form id="api-key-setup" onSubmit={submit}>
      <label>Provider<select aria-label="Provider" value={selectedProvider} onChange={event => selectProvider(event.currentTarget.value as ApiKeyProviderId)}>
        {API_KEY_PROVIDERS.map(provider => <option key={provider.id} value={provider.id}>{providerOptionLabel(provider.id)}</option>)}
      </select></label>
      {selectedProvider === "custom" && <>
        <label>API base URL<input type="url" autoComplete="url" spellCheck={false} placeholder="https://api.example.com/v1" value={customBaseURL} onChange={event => setCustomBaseURL(event.currentTarget.value)} required disabled={busy} /></label>
        <p className="connection-hint">Enter the API base URL, including any version path. Models must be available at /models.</p>
      </>}
      <label>{keyLabel}<input type="password" autoFocus autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.currentTarget.value)} required disabled={busy} /></label>
      {selectedProvider === "openai" && <p className="connection-hint"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get an API key from OpenAI</a></p>}
      <p className="connection-hint">Your API key is saved in this browser. Setup loads models without sending a prompt.{selectedProvider === "openai" ? " OpenAI API billing is separate from ChatGPT subscriptions." : ""}</p>
      <p className="connection-hint">Catalog access does not guarantee that the key can generate responses.</p>
      {busy ? <button type="button" className="text-button" onClick={cancelCheck}>Cancel key check</button> : <button type="submit" className="primary-button" disabled={!key.trim() || (selectedProvider === "custom" && !customBaseURL.trim())}>{connectLabel}</button>}
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {serviceError && <p className="form-error" role="alert">{serviceError}</p>}
    {connection && changing && <button className="text-button connection-back" type="button" onClick={() => { cancelCheck(); cancelChange(); }}>Back to {providerLabel(connection.provider)}</button>}
  </section></main>;
};

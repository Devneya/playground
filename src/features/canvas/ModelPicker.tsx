import { useEffect, useRef, useState } from "react";
import type { Model } from "../../domain/types";

export const MAX_MODELS = 4;

type ModelPickerProps = {
  title: string;
  modelIds: string[];
  models: Model[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onReload: () => void;
  onToggle: (modelId: string) => void;
};

// Pill-anchored model picker: the catalog lives in a popover instead of a
// permanently mounted list, so the Generation card stays compact. Checkbox
// labels keep the `${title} model ${id}` shape existing tests rely on.
export const ModelPicker = ({ title, modelIds, models, status, error, onReload, onToggle }: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    root?.closest(".flow-node")?.classList.toggle("popover-open", open);
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      root?.closest(".flow-node")?.classList.remove("popover-open");
    };
  }, [open ]);
  const selected = new Set(modelIds);
  const needle = query.trim().toLowerCase();
  const visible = needle ? models.filter((model) => model.id.toLowerCase().includes(needle)) : models;
  const pillLabel = modelIds.length === 0 ? "Select models" : modelIds.length === 1 ? modelIds[0] : `${modelIds[0]} +${modelIds.length - 1}`;
  return <div className="model-picker-root nodrag" ref={rootRef}>
    <button type="button" className="model-pill" aria-label={`${title} model picker`} aria-expanded={open} title={modelIds.join(", ") || "No models selected"} onClick={() => setOpen((value) => !value)}>
      <span className="model-pill-label">{pillLabel}</span>{" "}
      <span className="model-pill-count">({modelIds.length}/{MAX_MODELS})</span>
    </button>
    {status === "loading" && <span className="muted model-status-line">Loading live catalog…</span>}
    {status === "error" && <span className="form-error model-status-line">{error} <button type="button" className="small-button" onClick={onReload}>Retry</button></span>}
    {status === "ready" && models.length === 0 && <span className="muted model-status-line">No models are currently available.</span>}
    {open && <div className="model-popover" role="dialog" aria-label={`${title} models`}>
      <input className="model-search" aria-label={`${title} model search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" />
      {status === "loading" && <span className="muted">Loading live catalog…</span>}
      {status === "error" && <span className="form-error">{error} <button type="button" className="small-button" onClick={onReload}>Retry</button></span>}
      {status === "ready" && visible.map((model) => <label className="model-option" key={model.id}>
        <input type="checkbox" aria-label={`${title} model ${model.id}`} checked={selected.has(model.id)} onChange={() => onToggle(model.id)} disabled={!selected.has(model.id) && modelIds.length >= MAX_MODELS} />
        <span>{model.id}</span>
      </label>)}
      {status === "ready" && visible.length === 0 && <span className="muted">No models match.</span>}
      {status === "ready" && models.length === 0 && <span className="muted">No models are currently available.</span>}
    </div>}
  </div>;
};

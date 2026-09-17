import { useEffect, useRef, useState } from "react";
import { groupModels } from "../../domain/modelGroups";
import type { Model } from "../../domain/types";

type ModelPickerProps = {
  title: string;
  modelIds: string[];
  models: Model[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onReload: () => void;
  onSelect: (modelId: string) => void;
};

// Pill-anchored model picker: the catalog lives in a popover instead of a
// permanently mounted list, so the Generation card stays compact. Radio
// labels keep the `${title} model ${id}` shape existing tests rely on.
export const ModelPicker = ({ title, modelIds, models, status, error, onReload, onSelect }: ModelPickerProps) => {
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
  }, [open]);
  const selectedId = modelIds[0];
  const needle = query.trim().toLowerCase();
  const visible = needle ? models.filter((model) => model.id.toLowerCase().includes(needle)) : models;
  const groups = groupModels(visible);
  const pillLabel = selectedId || "Select model";
  return <div className="model-picker-root nodrag" ref={rootRef}>
    <button type="button" className="model-pill" aria-label={`${title} model picker`} aria-expanded={open} title={pillLabel} onClick={() => setOpen((value) => !value)}>
      <span className="model-pill-label">{pillLabel}</span>
    </button>
    {status === "loading" && <span className="muted model-status-line">Loading live catalog…</span>}
    {status === "error" && <span className="form-error model-status-line">{error} <button type="button" className="small-button" onClick={onReload}>Retry</button></span>}
    {status === "ready" && models.length === 0 && <span className="muted model-status-line">No models are currently available.</span>}
    {open && <div className="model-popover nowheel" role="dialog" aria-label={`${title} models`} onWheel={(event) => event.stopPropagation()}>
      <input className="model-search" aria-label={`${title} model search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" />
      {status === "ready" && groups.map((group) => <fieldset className="model-group" key={group.name}>
        <legend className="model-group-label">{group.name}</legend>
        {group.models.map((model) => <label className="model-option" key={model.id}>
          <input type="radio" name={`${title} model`} aria-label={`${title} model ${model.id}`} checked={selectedId === model.id} onChange={() => onSelect(model.id)} />
          <span>{model.id}</span>
        </label>)}
      </fieldset>)}
      {status === "ready" && visible.length === 0 && <span className="muted">No models match.</span>}
    </div>}
  </div>;
};

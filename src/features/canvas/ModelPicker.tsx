import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { groupModels } from "../../domain/modelGroups";
import type { Model } from "../../domain/types";
import { defaultEffort, type ReasoningEffort } from "../../domain/reasoning";
import { CardIcon } from "./CardIcon";

type ModelPickerProps = {
  title: string;
  modelIds: string[];
  models: Model[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onReload: () => void;
  onSelect: (modelId: string) => void;
  multiple?: boolean;
  modelEfforts?: Record<string, ReasoningEffort> | undefined;
  onEffort?: ((modelId: string, effort: ReasoningEffort) => void) | undefined;
  readOnly?: boolean;
};

// Pill-anchored model picker: the catalog lives in a popover instead of a
// permanently mounted list, so the Generation card stays compact. Radio
// labels keep the `${title} model ${id}` shape existing tests rely on.
export const ModelPicker = ({ title, modelIds, models, status, error, onReload, onSelect, multiple = false, modelEfforts, onEffort, readOnly = false }: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  useLayoutEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const width = Math.min(360, window.innerWidth - 24);
      const height = menu.getBoundingClientRect().height;
      const card = rootRef.current?.closest(".spatial-card")?.getBoundingClientRect() ?? anchor;
      const left = card.left - width - 12;
      const next = { width, left: Math.max(12, Math.min(left >= 12 ? left : card.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(left >= 12 ? card.top : anchor.bottom + 8, window.innerHeight - height - 12)) };
      setPosition(current => current.left === next.left && current.top === next.top && current.width === width ? current : next);
    };
    place();
    const resize = new ResizeObserver(place);
    if (menuRef.current) resize.observe(menuRef.current);
    if (rootRef.current) resize.observe(rootRef.current);
    const movement = new MutationObserver(place);
    const viewport = rootRef.current?.closest(".react-flow__viewport");
    if (viewport) movement.observe(viewport, { attributes: true, attributeFilter: ["style"] });
    const node = rootRef.current?.closest(".react-flow__node");
    if (node) movement.observe(node, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", place);
    return () => { resize.disconnect(); movement.disconnect(); window.removeEventListener("resize", place); };
  }, [open]);
  useEffect(() => {
    const root = rootRef.current;
    root?.closest(".flow-node")?.classList.toggle("popover-open", open);
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
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
  const pillLabel = (multiple ? modelIds.join(" · ") : selectedId) || "Select model";
  const selectedEffort = selectedId ? modelEfforts?.[selectedId] ?? defaultEffort(models.find(model => model.id === selectedId)) : undefined;
  return <div className="model-picker-root nodrag" ref={rootRef}>
    <button type="button" className="model-pill" aria-label={`${title} model picker`} aria-expanded={open} title={pillLabel} onClick={() => setOpen((value) => !value)}>
      <span className="model-pill-label">{pillLabel}</span>
      {selectedEffort && <span className="model-pill-effort">{selectedEffort}</span>}
      <CardIcon name="chevron" className="model-picker-arrow" size={13} />
    </button>
    {status === "loading" && <span className="muted model-status-line">Loading live catalog…</span>}
    {status === "error" && <span className="form-error model-status-line">{error} <button type="button" className="small-button" onClick={onReload}>Retry</button></span>}
    {status === "ready" && models.length === 0 && <span className="muted model-status-line">No models are currently available.</span>}
    {open && createPortal(<div className="spatial-card model-menu-layer nodrag nopan" style={position}>
      <div ref={menuRef} className="model-popover nowheel" role="dialog" aria-label={`${title} models`} onWheel={(event) => event.stopPropagation()}>
      <input ref={searchRef} className="model-search" aria-label={`${title} model search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" />
      {status === "ready" && groups.map((group) => <details className="model-group" role="group" aria-label={group.name} key={group.name} open>
        <summary className="model-group-label"><CardIcon name="chevron" size={12} />{group.name}</summary>
        {group.models.map((model) => <div className="model-row-wrap" key={model.id}><div className="model-row">
          <label className="model-option">
            <input type={multiple ? "checkbox" : "radio"} name={`${title} model`} aria-label={`${title} model ${model.id}`} checked={multiple ? modelIds.includes(model.id) : selectedId === model.id} disabled={readOnly} onChange={() => onSelect(model.id)} />
            <span>{model.id}</span>
          </label>
        </div>{modelIds.includes(model.id) && onEffort && !!model.supportedReasoningEfforts?.length && <div className="model-effort-options" role="radiogroup" aria-label={`${title} ${model.id} effort levels`}>
          {model.supportedReasoningEfforts?.map(effort => <label className="model-effort-choice" key={effort}><input type="radio" name={`${title}-${model.id}-effort`} aria-label={`${title} ${model.id} effort ${effort}`} checked={(modelEfforts?.[model.id] ?? defaultEffort(model)) === effort} disabled={readOnly} onChange={() => onEffort(model.id, effort)} /><span>{effort}</span></label>)}
        </div>}</div>)}
      </details>)}
      {status === "ready" && visible.length === 0 && <span className="muted">No models match.</span>}
      <div className="model-menu-footer">{readOnly && <span>Sent prompt · read only</span>}<button type="button" className="model-pill" onClick={() => setOpen(false)}>Done</button></div>
    </div></div>, document.body)}
  </div>;
};

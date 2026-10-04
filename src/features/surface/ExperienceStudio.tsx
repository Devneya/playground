import { useEffect, useMemo, useRef, useState } from "react";
import { appendExperience, currentExperience, emptyExperience, experienceLineage, experienceReplySchema, selectExperience, type Experience, type ExperienceRevision, type WorkState } from "../../domain/experience";
import { EXPERIENCE_PROMPT, experienceMessages } from "../../domain/experiencePrompt";
import { randomIdFactory } from "../../domain/ids";
import { streamCompletion } from "../../api/streamCompletion";
import { useWorkspace } from "../workspace/useWorkspace";
import { ModelPicker } from "../canvas/ModelPicker";
import { ExperienceFrame } from "./ExperienceFrame";
import { loadExperienceExample } from "./experienceExample";
import "./experience-studio.css";

// Preferences explicitly requested by the user, intersected with the live catalog.
const requestedModels = ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"];
type Run = { id: string; model: string; parent: string; status: "working" | "ready" | "failed"; intent: string; characters: number; revision?: string; error?: string };
type Queued = { instruction: string; parent: string; model: string };

export const ExperienceStudio = () => {
  const { workspace, activeFlow, dispatch, models, modelsStatus, modelsError, reloadModels, virtualKey } = useWorkspace();
  const experience = useMemo(() => activeFlow.experience ?? emptyExperience(), [activeFlow.experience]);
  const current = useRef(experience); current.current = experience;
  const expected = useRef({ head: experience.head, tail: experience.revisions.at(-1)?.id ?? null });
  const controllers = useRef(new Map<string, AbortController>());
  const timer = useRef<number | undefined>(undefined);
  const queued = useRef<Queued | null>(null);
  const editing = useRef(false);
  const epoch = useRef(0);
  const navigation = useRef(0);
  const pausedRef = useRef(false);
  const drain = useRef<() => void>(() => {});
  const [draft, setDraft] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[] | null>(null);
  const participants = selectedModels?.filter((id) => models.some((m) => m.id === id)) ?? requestedModels.filter((id) => models.some((m) => m.id === id));
  const [runs, setRuns] = useState<Run[]>([]);
  const [paused, setPaused] = useState(false);
  const [queueLabel, setQueueLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [showChange, setShowChange] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const historyElement = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const started = useRef(Date.now());
  const revision = currentExperience(experience);
  const lineage = useMemo(() => experienceLineage(experience), [experience]);
  const objective = lineage.find((r) => r.actor === "you")?.label ?? "";
  const selectedVersion = [...lineage].reverse().find((r) => r.actor === "model");
  const partner = selectedVersion?.model ?? participants[0] ?? "";
  const busy = runs.some((r) => r.status === "working");
  const versions = new Map<string, Run>();
  for (const saved of experience.revisions) if (saved.actor === "model") versions.set(saved.model, { id: saved.id, model: saved.model, parent: saved.parent ?? "", status: "ready", intent: saved.description, characters: saved.html.length, revision: saved.id });
  for (const run of runs) versions.set(run.model, run);
  const visibleVersions = [...versions.values()].sort((a, b) => requestedModels.indexOf(a.model) - requestedModels.indexOf(b.model));
  const pendingVersions = visibleVersions.filter((r) => r.status === "ready" && r.revision && r.revision !== selectedVersion?.id);
  const tail = experience.revisions.at(-1)?.id ?? null;

  const publish = (next: Experience) => {
    const base = current.current;
    current.current = next; expected.current = { head: next.head, tail: next.revisions.at(-1)?.id ?? null };
    dispatch({ type: "experience/set", flowId: activeFlow.id, baseHead: base.head, baseTail: base.revisions.at(-1)?.id ?? null, experience: next });
  };
  const updateRun = (id: string, changes: Partial<Run>) => setRuns((all) => all.map((run) => run.id === id ? { ...run, ...changes } : run));
  const cancel = () => {
    epoch.current++; controllers.current.forEach((controller) => controller.abort()); controllers.current.clear();
    window.clearTimeout(timer.current); queued.current = null; setQueueLabel("");
    setRuns((all) => all.map((run) => run.status === "working" ? { ...run, status: "failed", error: "Stopped" } : run));
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("studio-example") !== "1") return;
    let alive = true;
    void loadExperienceExample(workspace).then((flow) => {
      if (!alive) return;
      const url = new URL(window.location.href); url.searchParams.delete("studio-example"); window.history.replaceState(null, "", url);
      dispatch({ type: "flow/create", flow });
    }).catch(() => { if (alive) setNotice("The recorded example could not be loaded."); });
    return () => { alive = false; };
  }, [dispatch, workspace]);
  useEffect(() => { historyElement.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest" }); }, [experience.head]);
  useEffect(() => () => { controllers.current.forEach((controller) => controller.abort()); window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (experience.head !== expected.current.head || tail !== expected.current.tail) {
      epoch.current++; controllers.current.forEach((controller) => controller.abort()); controllers.current.clear();
      queued.current = null; setQueueLabel(""); window.clearTimeout(timer.current);
      expected.current = { head: experience.head, tail };
    }
  }, [experience.head, tail]);
  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [busy]);

  const generate = async (instruction: string, modelIds: string[], parent: ExperienceRevision) => {
    if (!virtualKey || !modelIds.length) return;
    const runEpoch = epoch.current, viewEpoch = navigation.current;
    const context = { ...current.current, head: parent.id };
    const history = experienceLineage(context);
    const goal = history.find((r) => r.actor === "you")?.label ?? instruction;
    const entries: Run[] = modelIds.map((model) => ({ id: randomIdFactory(), model, parent: parent.id, status: "working", intent: "Request sent", characters: 0 }));
    started.current = Date.now(); setElapsed(0); setNotice(""); setRuns(entries);
    await Promise.all(entries.map(async (entry) => {
      const controller = new AbortController(); controllers.current.set(entry.id, controller);
      let buffer = "", reply: ReturnType<typeof experienceReplySchema.parse> | undefined;
      const accept = (line: string) => {
        if (!line.trim()) return;
        const data = JSON.parse(line) as Record<string, unknown>;
        if (data.type === "intent" && typeof data.message === "string") { updateRun(entry.id, { intent: data.message.slice(0, 400) }); return; }
        if (data.type !== "experience") throw new Error("The model returned an unknown workspace event.");
        const content = { ...data }; delete content.type;
        if (reply) throw new Error("The model returned more than one workspace.");
        reply = experienceReplySchema.parse(content);
      };
      try {
        const area = stage.current?.getBoundingClientRect();
        const viewport = area ? { width: Math.round(area.width), height: Math.round(area.height) } : { width: Math.max(320, window.innerWidth - 380), height: Math.max(300, window.innerHeight - 360) };
        await streamCompletion(virtualKey, { model: entry.model, instructions: EXPERIENCE_PROMPT, messages: experienceMessages(instruction, goal, parent.html ? parent : undefined, history.filter((r) => r.actor === "you").map((r) => r.label), viewport), stream: false }, controller.signal, (delta) => {
          buffer += delta; const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; lines.forEach(accept);
        }, (progress) => updateRun(entry.id, { characters: progress.characters }));
        if (buffer.trim()) accept(buffer);
        if (controller.signal.aborted || runEpoch !== epoch.current) { updateRun(entry.id, { status: "failed", error: "Stopped" }); return; }
        if (!reply) throw new Error("The model returned no working interface.");
        if (!current.current.revisions.some((r) => r.id === parent.id)) throw new Error("The starting version is no longer in history.");
        const next: ExperienceRevision = { id: randomIdFactory(), parent: parent.id, actor: "model", label: reply.title, model: entry.model, at: new Date().toISOString(), ...reply };
        const activate = current.current.head === parent.id && !editing.current && navigation.current === viewEpoch;
        publish(appendExperience(current.current, next, activate));
        updateRun(entry.id, { status: "ready", revision: next.id });
        if (activate) { setRuntimeError(""); setNotice(reply.description); }
        else setNotice("Another version is ready. Your current work is still here.");
      } catch (failure) {
        updateRun(entry.id, { status: "failed", error: controller.signal.aborted ? "Stopped" : failure instanceof Error && failure.name !== "ZodError" ? failure.message : "This model returned an invalid workspace. Your work is kept." });
      } finally { controllers.current.delete(entry.id); }
    }));
    if (runEpoch === epoch.current) drain.current();
  };
  drain.current = () => {
    if (controllers.current.size || pausedRef.current || !queued.current) return;
    const next = queued.current; queued.current = null; setQueueLabel("");
    const parent = current.current.revisions.find((r) => r.id === next.parent);
    if (parent && current.current.head === parent.id) void generate(next.instruction, [next.model], parent);
  };
  const enqueue = (next: Queued) => {
    queued.current = next; setQueueLabel(next.instruction); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => drain.current(), 1100);
  };
  const recordHuman = (label: string, state?: WorkState) => {
    const base = currentExperience(current.current);
    const next: ExperienceRevision = { id: randomIdFactory(), parent: current.current.head, actor: "you", label, model: "", at: new Date().toISOString(), title: base?.title ?? label.slice(0, 100), description: base?.description ?? "", html: base?.html ?? "", state: state ?? base?.state ?? {} };
    publish(appendExperience(current.current, next)); return next;
  };
  const commit = (state: WorkState, description: string) => {
    const next = recordHuman(description, state);
    setNotice(`Your move: ${description}`);
    if (partner) enqueue({ instruction: `The person acted in the workspace: ${description}. Their actual current state is supplied. Develop the work from this action; you may transform its content, medium and interactions if useful.`, parent: next.id, model: partner });
  };
  const submit = () => {
    if (!draft.trim() || !virtualKey || !participants.length) return;
    const instruction = draft.trim(); setDraft("");
    const parent = recordHuman(instruction);
    if (controllers.current.size) enqueue({ instruction, parent: parent.id, model: partner || participants[0]! });
    else { pausedRef.current = false; setPaused(false); void generate(instruction, parent.html ? [partner || participants[0]!] : participants, parent); }
  };
  const visit = (id: string) => {
    const target = current.current.revisions.find((r) => r.id === id);
    if (!target) return;
    navigation.current++; window.clearTimeout(timer.current); queued.current = null; setQueueLabel("");
    // Completed sibling versions stay usable; pending work stays in history but
    // won't interrupt a deliberate visit to another version.
    publish(selectExperience(current.current, id)); setRuntimeError(""); editing.current = false;
    setNotice(target.html ? target.actor === "model" ? target.description : `Your move: ${target.label}` : ""); setShowChange(false);
  };
  const compare = () => {
    if (!revision || busy || !virtualKey || participants.length < 2) return;
    const parent = recordHuman("Develop different working approaches to this task. You may change the content, medium and interactions.");
    void generate(parent.label, participants, parent);
  };
  const togglePause = () => {
    if (pausedRef.current) { pausedRef.current = false; setPaused(false); drain.current(); }
    else { pausedRef.current = true; setPaused(true); cancel(); }
  };

  return <div className={`experience-studio ${historyOpen ? "show-history" : ""}`}>
    <aside ref={historyElement} className="experience-history" aria-label="Workspace history">
      <div className="experience-history-head"><span>THE WORK, SO FAR</span><button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-label={historyOpen ? "Hide workspace history" : "Show workspace history"}>{historyOpen ? "←" : "→"}</button></div>
      {historyOpen && <><p>Return to any moment.<br />Your next action opens a new path.</p><ol>{experience.revisions.map((entry, i) => <li key={entry.id} className={entry.actor}><button type="button" onClick={() => visit(entry.id)} aria-current={entry.id === experience.head ? "step" : undefined} aria-label={`Open version ${i + 1}: ${entry.label}`}><small>{String(i + 1).padStart(2, "0")} · {entry.actor === "you" ? "YOU" : entry.model}</small><span>{entry.label}</span>{entry.parent && experience.revisions[i - 1]?.id !== entry.parent && <em>from {experience.revisions.findIndex((r) => r.id === entry.parent) + 1}</em>}</button></li>)}</ol>{!experience.revisions.length && <span className="experience-history-empty">Your request and every change will stay here.</span>}</>}
    </aside>
    <section className="experience-main" aria-label="Evolving workspace">
      <header className="experience-toolbar"><div><span className="experience-overline">{activeFlow.name.startsWith("Recorded example") ? "DEVNEYA / RECORDED CODEX RUN · YOUR NEXT MOVE IS LIVE" : "DEVNEYA / AN OPEN WORKSPACE"}</span>{revision?.html && <h1>{revision.title}</h1>}</div><div className="experience-toolbar-actions"><a href="/?view=board">Earlier board ↗</a>{revision?.html && <button type="button" onClick={togglePause}>{paused ? "Resume model" : "Pause model"}</button>}</div></header>
      <div className="experience-partners"><ModelPicker multiple title="Collaborators" models={models} modelIds={participants} onSelect={(id) => setSelectedModels(participants.includes(id) ? participants.filter((m) => m !== id) : [...participants, id].slice(-3))} status={modelsStatus} error={modelsError} onReload={reloadModels} /><span>{participants.length} {participants.length === 1 ? "model" : "models"} · xhigh · Fast requested</span>{revision?.html && <button type="button" disabled={busy || participants.length < 2} onClick={compare}>Other approaches ↗</button>}</div>
      {!!visibleVersions.length && <nav className="experience-versions" aria-label="Model approaches">{visibleVersions.map((run) => <button type="button" key={run.id} className={run.status} aria-pressed={run.revision === selectedVersion?.id} disabled={!run.revision} onClick={() => run.revision && visit(run.revision)}><span>{run.model}</span><small>{run.status === "working" ? `${elapsed}s · ${run.characters ? `${run.characters.toLocaleString()} characters` : "working"}` : run.status === "ready" ? run.revision === selectedVersion?.id ? "Open" : "Open this version ↗" : run.error}</small></button>)}</nav>}
      {revision?.html ? <div ref={stage} className="experience-stage"><ExperienceFrame html={revision.html} state={revision.state} title={`Workspace: ${revision.title}`} onCommit={commit} onError={setRuntimeError} onEditing={(value) => { editing.current = value; }} /></div> : <div className="experience-arrival">
        <p className="experience-overline">{objective ? "YOUR REQUEST" : "A STARTING POINT, NOT A FORMAT"}</p><h1>{objective || "What shall we work on?"}</h1>
        {!objective && <><p>Bring a question, a decision, something to make.<br />Each model will build its own way to work with it.</p><a className="experience-example-link" href="/?studio-example=1">Try a recorded live run ↗</a></>}
        {busy && <div className="experience-intents" role="status">{runs.map((run) => <div key={run.id}><span>{run.model}</span><p>{run.intent}</p></div>)}</div>}
      </div>}
      {runtimeError && <div className="experience-error" role="alert"><span>This version has an interaction error: {runtimeError}</span><button type="button" disabled={busy || !revision || !partner || !virtualKey} onClick={() => { if (revision) void generate(`Repair this interaction error while retaining the user's work: ${runtimeError}`, [partner], revision); }}>Repair this version</button></div>}
      {notice && <div className="experience-notice"><span>{notice}</span>{revision?.description && <button type="button" onClick={() => setShowChange(!showChange)}>{showChange ? "Close" : "About this move"}</button>}</div>}
      {showChange && revision && <p className="experience-description">{revision.description}</p>}
      {pendingVersions.length > 0 && revision?.html && <div className="experience-ready">{pendingVersions.length} alternative {pendingVersions.length === 1 ? "version is" : "versions are"} available above.</div>}
      <form className="experience-direction" onSubmit={(event) => { event.preventDefault(); submit(); }}><label className="visually-hidden" htmlFor="experience-request">Direct the work</label><textarea id="experience-request" aria-label="Direct the work" rows={1} maxLength={8000} placeholder={revision?.html ? "Add a constraint, change direction…" : "Give this space a starting point…"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} /><button type="submit" disabled={!draft.trim() || !virtualKey || !participants.length}>{busy ? "Add next move ↗" : revision?.html ? "Change the work ↗" : "Begin ↗"}</button></form>
      <div className="experience-status" role="status"><span>{queueLabel ? paused ? "Your move is saved · model paused" : "Your latest move is saved · response queued" : busy ? "Models are working · you can keep working here" : paused ? "Model paused · your work is saved" : revision?.html ? "Use the workspace · the model responds to your actions" : "Each model develops a real working interface"}</span>{busy && <button type="button" onClick={() => { pausedRef.current = true; setPaused(true); cancel(); }}>Stop</button>}</div>
    </section>
  </div>;
};

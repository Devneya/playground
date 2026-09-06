import { randomIdFactory, systemClock, timestamp } from "./ids";
import type { Clock, FlowDocument, IdFactory, PlaygroundNode, WorkspaceDocument } from "./types";

const starterFlowName = "Untitled flow";

export const uniqueFlowName = (names: string[], requested = starterFlowName) => {
  const used = new Set(names);
  if (!used.has(requested)) return requested;
  let suffix = 2;
  while (used.has(`${requested} ${suffix}`)) suffix += 1;
  return `${requested} ${suffix}`;
};

export const createStarterFlow = (idFactory: IdFactory = randomIdFactory, clock: Clock = systemClock, name = starterFlowName): FlowDocument => {
  const now = timestamp(clock);
  const promptId = idFactory();
  const nodes: PlaygroundNode[] = [
    { id: promptId, position: { x: 80, y: 120 }, data: { kind: "prompt", title: "Prompt 1", prompt: "", modelIds: [] }, createdAt: now, updatedAt: now },
  ];
  return { id: idFactory(), name, nodes, edges: [], batches: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now };
};

export const createStarterWorkspace = (idFactory: IdFactory = randomIdFactory, clock: Clock = systemClock): WorkspaceDocument => {
  const now = timestamp(clock);
  const flow = createStarterFlow(idFactory, clock);
  return { schemaVersion: 2, activeFlowId: flow.id, flows: [flow], createdAt: now, updatedAt: now };
};

export const createBlankFlow = (workspace: WorkspaceDocument, idFactory: IdFactory = randomIdFactory, clock: Clock = systemClock, requestedName = starterFlowName) =>
  createStarterFlow(idFactory, clock, uniqueFlowName(workspace.flows.map((flow) => flow.name), requestedName));

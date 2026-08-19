import { randomIdFactory, systemClock, timestamp } from "./ids";
import type { Clock, FlowDocument, IdFactory, PlaygroundEdge, PlaygroundNode, WorkspaceDocument } from "./types";

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
  const textId = idFactory();
  const generationId = idFactory();
  const edgeId = idFactory();
  const nodes: PlaygroundNode[] = [
    { id: textId, position: { x: 80, y: 120 }, data: { kind: "text", origin: "manual", title: "Text 1", text: "" }, createdAt: now, updatedAt: now },
    { id: generationId, position: { x: 500, y: 120 }, data: { kind: "generation", title: "Generation 1", instruction: "", modelIds: [] }, createdAt: now, updatedAt: now },
  ];
  const edges: PlaygroundEdge[] = [{ id: edgeId, kind: "input", source: textId, target: generationId, order: 0 }];
  return { id: idFactory(), name, nodes, edges, batches: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now };
};

export const createStarterWorkspace = (idFactory: IdFactory = randomIdFactory, clock: Clock = systemClock): WorkspaceDocument => {
  const now = timestamp(clock);
  const flow = createStarterFlow(idFactory, clock);
  return { schemaVersion: 1, activeFlowId: flow.id, flows: [flow], createdAt: now, updatedAt: now };
};

export const createBlankFlow = (workspace: WorkspaceDocument, idFactory: IdFactory = randomIdFactory, clock: Clock = systemClock, requestedName = starterFlowName) =>
  createStarterFlow(idFactory, clock, uniqueFlowName(workspace.flows.map((flow) => flow.name), requestedName));

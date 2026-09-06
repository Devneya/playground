import { z } from "zod";
import type { FlowDocument, PlaygroundEdge, PlaygroundNode, WorkspaceDocument } from "./types";

// Best-effort v1 (Text/Generation) to v2 (Prompt/Content) migration.
// ID-preserving so edges, batches, and executions keep pointing at the same
// nodes: manual texts become imported contents, generations become prompts
// (instruction becomes the prompt text), generated texts become generated
// contents, and each prompt keeps only its first input edge (ordered).
const manualTextSchema = z.object({ kind: z.literal("text"), origin: z.literal("manual"), title: z.string(), text: z.string() }).strict();
const generatedTextSchema = z.object({ kind: z.literal("text"), origin: z.literal("generated"), title: z.string(), text: z.string(), batchId: z.string(), executionId: z.string() }).strict();
const generationSchema = z.object({ kind: z.literal("generation"), title: z.string(), instruction: z.string(), modelIds: z.array(z.string()) }).strict();
const nodeSchema = z.object({ id: z.string(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), data: z.union([manualTextSchema, generatedTextSchema, generationSchema]), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
const edgeSchema = z.object({ id: z.string(), kind: z.enum(["input", "result"]), source: z.string(), target: z.string(), order: z.number().int().nonnegative().optional() }).strict();
const batchSchema = z.object({ id: z.string(), generationNodeId: z.string(), startedAt: z.string(), completedAt: z.string().optional(), promptFormatVersion: z.literal(1), instruction: z.string(), inputs: z.array(z.object({ nodeId: z.string(), title: z.string(), text: z.string() })), executions: z.array(z.object({ id: z.string(), modelId: z.string(), status: z.enum(["pending", "success", "failed", "cancelled"]), startedAt: z.string(), completedAt: z.string().optional(), durationMs: z.number().optional(), usage: z.unknown().optional(), outputNodeId: z.string().optional(), error: z.unknown().optional() })) }).strict();
const flowSchema = z.object({ id: z.string(), name: z.string(), nodes: z.array(nodeSchema), edges: z.array(edgeSchema), batches: z.array(batchSchema), viewport: z.unknown(), createdAt: z.string(), updatedAt: z.string() }).strict();
const workspaceSchemaV1 = z.object({ schemaVersion: z.literal(1), activeFlowId: z.string(), flows: z.array(flowSchema), createdAt: z.string(), updatedAt: z.string() }).strict();

type V1Flow = z.infer<typeof flowSchema>;

const migrateFlow = (flow: V1Flow): FlowDocument => {
  const nodes: PlaygroundNode[] = flow.nodes.map((node) => {
    if (node.data.kind === "generation") {
      return { ...node, data: { kind: "prompt", title: node.data.title, prompt: node.data.instruction, modelIds: node.data.modelIds } };
    }
    if (node.data.kind === "text" && node.data.origin === "generated") {
      return { ...node, data: { kind: "content", title: node.data.title, text: node.data.text, origin: "generated", modelId: node.data.title, batchId: node.data.batchId, executionId: node.data.executionId } };
    }
    return { ...node, data: { kind: "content", title: node.data.title, text: node.data.text, origin: "imported" } };
  });
  const keptInputs = new Set<string>();
  const edges: PlaygroundEdge[] = [];
  for (const edge of [...flow.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (edge.kind === "input") {
      if (keptInputs.has(edge.target)) continue;
      keptInputs.add(edge.target);
      edges.push({ id: edge.id, kind: "input", source: edge.source, target: edge.target, order: 0 });
      continue;
    }
    edges.push({ id: edge.id, kind: "result", source: edge.source, target: edge.target });
  }
  const batches = flow.batches.map((batch) => ({ ...batch, promptNodeId: batch.generationNodeId }));
  return { ...flow, nodes, edges, batches } as FlowDocument;
};

export const migrateV1Workspace = (value: unknown): WorkspaceDocument => {
  const parsed = workspaceSchemaV1.parse(value);
  return { ...parsed, schemaVersion: 2, flows: parsed.flows.map(migrateFlow) } as WorkspaceDocument;
};

export const isV1Workspace = (value: unknown): boolean => workspaceSchemaV1.safeParse(value).success;

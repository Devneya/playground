import { z } from "zod";
import { normalizeInputOrder } from "./graph";
import type { ExecutionBatch, FlowDocument, PlaygroundEdge, PlaygroundNode, Viewport, WorkspaceDocument } from "./types";

// Migration forward to the v3 (Text/Generation) vocabulary.
// - v1 documents already use Text/Generation vocabulary, so they only need a
//   schema version bump and a renumber of input edges.
// - v2 documents used Prompt/Content vocabulary and are remapped:
//   prompt -> generation (prompt field -> instruction),
//   content -> text (imported -> manual, generated keeps batchId/executionId),
//   and batch.promptNodeId -> batch.generationNodeId.
// Documents already at v3 are parsed directly by schemas.ts and never reach
// this module.

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const v1ManualSchema = z.object({ kind: z.literal("text"), origin: z.literal("manual"), title: z.string(), text: z.string() }).strict();
const v1GeneratedSchema = z.object({ kind: z.literal("text"), origin: z.literal("generated"), title: z.string(), text: z.string(), batchId: z.string(), executionId: z.string() }).strict();
const v1GenerationSchema = z.object({ kind: z.literal("generation"), title: z.string(), instruction: z.string(), modelIds: z.array(z.string()) }).strict();
const v1NodeSchema = z.object({ id: z.string(), position: positionSchema, data: z.union([v1ManualSchema, v1GeneratedSchema, v1GenerationSchema]), createdAt: z.string(), updatedAt: z.string() });

const v2ManualSchema = z.object({ kind: z.literal("content"), origin: z.literal("imported"), title: z.string(), text: z.string() }).strict();
const v2GeneratedSchema = z.object({ kind: z.literal("content"), origin: z.literal("generated"), title: z.string(), text: z.string(), modelId: z.string().optional(), batchId: z.string().optional(), executionId: z.string().optional() }).strict();
const v2PromptSchema = z.object({ kind: z.literal("prompt"), title: z.string(), prompt: z.string(), modelIds: z.array(z.string()) }).strict();
const v2NodeSchema = z.object({ id: z.string(), position: positionSchema, data: z.union([v2ManualSchema, v2GeneratedSchema, v2PromptSchema]), createdAt: z.string(), updatedAt: z.string() });

const edgeSchema = z.object({ id: z.string(), kind: z.enum(["input", "result"]), source: z.string(), target: z.string(), order: z.number().int().nonnegative().optional() }).strict();
const executionSchema = z.object({ id: z.string(), modelId: z.string(), status: z.enum(["pending", "success", "failed", "cancelled"]), startedAt: z.string(), completedAt: z.string().optional(), durationMs: z.number().optional(), usage: z.unknown().optional(), outputNodeId: z.string().optional(), error: z.unknown().optional() });
const batchV1Schema = z.object({ id: z.string(), generationNodeId: z.string(), startedAt: z.string(), completedAt: z.string().optional(), promptFormatVersion: z.literal(1), instruction: z.string(), inputs: z.array(z.object({ nodeId: z.string(), title: z.string(), text: z.string() })), executions: z.array(executionSchema) }).strict();
const batchV2Schema = z.object({ id: z.string(), promptNodeId: z.string(), startedAt: z.string(), completedAt: z.string().optional(), promptFormatVersion: z.literal(1), instruction: z.string(), inputs: z.array(z.object({ nodeId: z.string(), title: z.string(), text: z.string() })), executions: z.array(executionSchema) }).strict();
const flowV1Schema = z.object({ id: z.string(), name: z.string(), nodes: z.array(v1NodeSchema), edges: z.array(edgeSchema), batches: z.array(batchV1Schema), viewport: z.unknown(), createdAt: z.string(), updatedAt: z.string() }).strict();
const flowV2Schema = z.object({ id: z.string(), name: z.string(), nodes: z.array(v2NodeSchema), edges: z.array(edgeSchema), batches: z.array(batchV2Schema), viewport: z.unknown(), createdAt: z.string(), updatedAt: z.string() }).strict();
const workspaceV1Schema = z.object({ schemaVersion: z.literal(1), activeFlowId: z.string(), flows: z.array(flowV1Schema), createdAt: z.string(), updatedAt: z.string() }).strict();
const workspaceV2Schema = z.object({ schemaVersion: z.literal(2), activeFlowId: z.string(), flows: z.array(flowV2Schema), createdAt: z.string(), updatedAt: z.string() }).strict();

const migrateV1Flow = (value: unknown): FlowDocument => {
  const flow = value as z.infer<typeof flowV1Schema>;
  return {
    ...flow,
    viewport: flow.viewport as Viewport,
    nodes: flow.nodes.map((node) => node as unknown as PlaygroundNode),
    edges: normalizeInputOrder(flow.edges as unknown as PlaygroundEdge[]),
    batches: flow.batches.map((batch) => batch as unknown as ExecutionBatch),
  };
};

const migrateV2Flow = (value: unknown): FlowDocument => {
  const flow = value as z.infer<typeof flowV2Schema>;
  const nodes: PlaygroundNode[] = flow.nodes.map((node) => {
    if (node.data.kind === "prompt") {
      return { ...node, data: { kind: "generation", title: node.data.title, instruction: node.data.prompt, modelIds: node.data.modelIds } } as unknown as PlaygroundNode;
    }
    if (node.data.kind === "content" && node.data.origin === "generated") {
      return {
        ...node,
        data: { kind: "text", origin: "generated", title: node.data.title, text: node.data.text, batchId: node.data.batchId ?? "", executionId: node.data.executionId ?? "" },
      } as unknown as PlaygroundNode;
    }
    return { ...node, data: { kind: "text", origin: "manual", title: node.data.title, text: node.data.text } } as unknown as PlaygroundNode;
  });
  const edges = normalizeInputOrder(flow.edges as unknown as PlaygroundEdge[]);
  const batches = flow.batches.map((batch) => {
    const { promptNodeId, ...rest } = batch;
    return { ...rest, generationNodeId: promptNodeId } as unknown as ExecutionBatch;
  });
  return { ...flow, viewport: flow.viewport as Viewport, nodes, edges, batches };
};

const toV3 = (value: unknown, migrateFlow: (flow: unknown) => FlowDocument): WorkspaceDocument => {
  const document = value as unknown as { flows: unknown[] } & Record<string, unknown>;
  return {
    ...(document as unknown as WorkspaceDocument),
    schemaVersion: 3,
    flows: document.flows.map((flow) => migrateFlow(flow)),
  };
};

export const migrateWorkspace = (value: unknown): WorkspaceDocument => {
  const v1 = workspaceV1Schema.safeParse(value);
  if (v1.success) return toV3(v1.data, migrateV1Flow);
  const v2 = workspaceV2Schema.safeParse(value);
  if (v2.success) return toV3(v2.data, migrateV2Flow);
  throw new Error("This workspace document is in an unsupported format.");
};

export const isV1Workspace = (value: unknown): boolean => workspaceV1Schema.safeParse(value).success;
export const isV2Workspace = (value: unknown): boolean => workspaceV2Schema.safeParse(value).success;

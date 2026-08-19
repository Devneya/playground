import { z } from "zod";
import type { WorkspaceDocument } from "./types";

const usageSchema = z.object({ promptTokens: z.number().finite().nonnegative().optional(), completionTokens: z.number().finite().nonnegative().optional(), totalTokens: z.number().finite().nonnegative().optional() }).strict();
const executionErrorSchema = z.object({ kind: z.enum(["cancelled", "network", "http", "invalid_response", "interrupted"]), status: z.number().int().optional(), code: z.string().optional(), message: z.string() }).strict();
const manualTextSchema = z.object({ kind: z.literal("text"), origin: z.literal("manual"), title: z.string(), text: z.string() }).strict();
const generatedTextSchema = z.object({ kind: z.literal("text"), origin: z.literal("generated"), title: z.string(), text: z.string(), batchId: z.string(), executionId: z.string() }).strict();
const generationSchema = z.object({ kind: z.literal("generation"), title: z.string(), instruction: z.string(), modelIds: z.array(z.string()) }).strict();
const nodeSchema = z.object({ id: z.string(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), data: z.union([manualTextSchema, generatedTextSchema, generationSchema]), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
const inputEdgeSchema = z.object({ id: z.string(), kind: z.literal("input"), source: z.string(), target: z.string(), order: z.number().int().nonnegative() }).strict();
const resultEdgeSchema = z.object({ id: z.string(), kind: z.literal("result"), source: z.string(), target: z.string() }).strict();
const executionSchema = z.object({ id: z.string(), modelId: z.string(), status: z.enum(["pending", "success", "failed", "cancelled"]), startedAt: z.string().datetime(), completedAt: z.string().datetime().optional(), durationMs: z.number().finite().nonnegative().optional(), usage: usageSchema.optional(), outputNodeId: z.string().optional(), error: executionErrorSchema.optional() }).strict();
const batchSchema = z.object({ id: z.string(), generationNodeId: z.string(), startedAt: z.string().datetime(), completedAt: z.string().datetime().optional(), promptFormatVersion: z.literal(1), instruction: z.string(), inputs: z.array(z.object({ nodeId: z.string(), title: z.string(), text: z.string() }).strict()), executions: z.array(executionSchema) }).strict();
const flowSchema = z.object({ id: z.string(), name: z.string(), nodes: z.array(nodeSchema), edges: z.array(z.union([inputEdgeSchema, resultEdgeSchema])), batches: z.array(batchSchema), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }).strict(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export const workspaceSchema = z.object({ schemaVersion: z.literal(1), activeFlowId: z.string(), flows: z.array(flowSchema), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export const exportSchema = z.object({ format: z.literal("devneya-flow-v1"), exportedAt: z.string().datetime(), workspace: workspaceSchema }).strict();
export const modelListSchema = z.object({ object: z.literal("list"), data: z.array(z.object({ id: z.string().min(1), object: z.literal("model"), created: z.number(), owned_by: z.literal("devneya") }).strict()) }).strict();
export const parseWorkspace = (value: unknown): WorkspaceDocument => workspaceSchema.parse(value) as WorkspaceDocument;
export const parseExport = (value: unknown) => exportSchema.parse(value);

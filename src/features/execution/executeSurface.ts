import { randomIdFactory } from "../../domain/ids";
import { createChatCompletion } from "../../api/completions";
import type { CompletionCredential } from "../../api/credentials";
import { ApiError } from "../../api/errors";
import { LIMITS, utf8ByteLength } from "../../domain/limits";
import { surfaceReplySchema, type Surface } from "../../domain/surface";
import { SURFACE_SYSTEM_PROMPT, surfaceMessages } from "../../domain/surfacePrompt";
import type { WorkspaceAction } from "../../domain/workspaceReducer";
import type { GenerationRun } from "./executeGeneration";

export const startSurfaceRun = (options: { id: string; flowId: string; surface: Surface; instruction: string; selectedIds: string[]; model: string; credential: CompletionCredential; dispatch(action: WorkspaceAction): void; canDispatch(): boolean }): GenerationRun => {
  if (!options.instruction.trim() || options.instruction.length > 8000) throw new Error("Write a request of up to 8,000 characters.");
  const base = structuredClone(options.surface);
  const messages = surfaceMessages(base, options.instruction, options.selectedIds);
  if (utf8ByteLength(JSON.stringify(messages)) + utf8ByteLength(SURFACE_SYSTEM_PROMPT) > LIMITS.maxPromptBytes) throw new Error("This workspace is too large to send. Use a smaller flow.");
  const controller = new AbortController();
  const completed = (async () => {
    const result = await createChatCompletion(options.credential, { model: options.model, messages, instructions: SURFACE_SYSTEM_PROMPT, stream: false }, controller.signal);
    if (controller.signal.aborted || !options.canDispatch()) return;
    if (utf8ByteLength(result.content) > LIMITS.maxGeneratedBytes) throw new Error("The proposed change was too large. Your workspace has been kept.");
    let value: unknown;
    try { value = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")); }
    catch { throw new ApiError("invalid_response", "The model did not return a usable workspace change. Your work has been kept."); }
    const reply = surfaceReplySchema.safeParse(value);
    if (!reply.success) throw new ApiError("invalid_response", "The model proposed an unsupported change. Your work has been kept.");
    options.dispatch({ type: "surface/acted", flowId: options.flowId, base, reply: reply.data, instruction: options.instruction, model: options.model, turnId: randomIdFactory() });
  })();
  return { batchId: options.id, cancel: () => controller.abort(), completed };
};

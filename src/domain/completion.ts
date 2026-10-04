import type { CompletionMessage, InputSnapshot } from "./types";

export const buildCompletionMessagesV1 = (inputs: InputSnapshot[], instruction: string): CompletionMessage[] => {
  const files = inputs.flatMap(input => input.files ?? []);
  const attachments = files.length ? { files } : {};
  const instructionIsBlank = instruction.trim().length === 0;
  if (inputs.length === 1 && instructionIsBlank && inputs[0]) return [{ role: "user", content: inputs[0].text, ...attachments }];
  if (inputs.length === 0 && !instructionIsBlank) return [{ role: "user", content: instruction }];

  const sections = inputs.map((input, index) => `### Input ${index + 1}: ${input.title}\n${input.text}`);
  if (!instructionIsBlank) sections.push(`### Instruction\n${instruction}`);
  return [{ role: "user", content: sections.join("\n\n"), ...attachments }];
};

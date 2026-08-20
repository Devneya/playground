export type MockScenarioName =
  | "default"
  | "four-models"
  | "partial-failure"
  | "slow"
  | "catalog-error"
  | "key-error"
  | "completion-401"
  | "completion-402"
  | "completion-403"
  | "completion-invalid"
  | "offline";

export type MockScenario = {
  name: MockScenarioName;
  models: string[];
  catalogStatus?: number;
  keyStatus?: number;
  completionStatus?: number;
  invalidCompletion?: boolean;
  delayMs: number;
  delays: Record<string, number>;
  failModels: string[];
};

const base = (name: MockScenarioName): MockScenario => ({
  name,
  models: ["model-a"],
  delayMs: 0,
  delays: {},
  failModels: [],
});

const createScenario = (name: MockScenarioName): MockScenario => {
  if (name === "four-models") return { ...base(name), models: ["model-a", "model-b", "model-c", "model-d"] };
  if (name === "partial-failure") return { ...base(name), models: ["model-a", "model-b", "model-c", "model-d"], failModels: ["model-b"], delays: { "model-a": 30, "model-b": 80, "model-c": 10, "model-d": 50 } };
  if (name === "slow") return { ...base(name), delayMs: 4_000 };
  if (name === "catalog-error") return { ...base(name), catalogStatus: 503 };
  if (name === "key-error") return { ...base(name), keyStatus: 403 };
  if (name === "completion-401") return { ...base(name), completionStatus: 401 };
  if (name === "completion-402") return { ...base(name), completionStatus: 402 };
  if (name === "completion-403") return { ...base(name), completionStatus: 403 };
  if (name === "completion-invalid") return { ...base(name), invalidCompletion: true };
  if (name === "offline") return { ...base(name), completionStatus: 503 };
  return base(name);
};

const storedScenario = typeof globalThis.sessionStorage !== "undefined" ? globalThis.sessionStorage.getItem("devneya-mock-scenario") : null;
let activeScenario = storedScenario ? createScenario(storedScenario as MockScenarioName) : createScenario("default");
let completionCount = 0;

export const getMockScenario = (): MockScenario => activeScenario;

export const resetMockScenario = (): void => {
  globalThis.sessionStorage?.removeItem("devneya-mock-scenario");
  activeScenario = createScenario("default");
  completionCount = 0;
};

export const setMockScenario = (value: MockScenarioName | Partial<MockScenario>): void => {
  if (typeof value === "string") {
    globalThis.sessionStorage?.setItem("devneya-mock-scenario", value);
    activeScenario = createScenario(value);
  } else {
    activeScenario = { ...activeScenario, ...value };
  }
  completionCount = 0;
};

export const nextCompletionNumber = (): number => {
  completionCount += 1;
  return completionCount;
};

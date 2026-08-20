import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { resetMockScenario, setMockScenario, type MockScenario, type MockScenarioName } from "./scenario";

export const worker = setupWorker(...handlers);

export const installMockControls = (): void => {
  window.addEventListener("devneya-mock-scenario", (event) => {
    const detail = (event as CustomEvent<MockScenarioName | Partial<MockScenario>>).detail;
    if (detail) setMockScenario(detail);
    else resetMockScenario();
  });
  window.addEventListener("devneya-mock-reset", resetMockScenario);
};

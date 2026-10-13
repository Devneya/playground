import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chromium, type BrowserContextOptions, type BrowserType, type Page } from "playwright";
import { expect, test } from "@playwright/test";
import {
  collectBrowserCors,
  type CorsTarget,
} from "../../src/api/openai-live.node.mjs";

type Scenario = {
  failModelsPreflight?: boolean;
  omitActualOrigin?: boolean;
  redirectActual?: boolean;
  hangActual?: boolean;
};

type Harness = {
  origin: string;
  navigationUrl: string;
  targets: CorsTarget[];
  arrivals: Map<string, number>;
  close(): Promise<void>;
};

const listen = (server: Server): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject);
    const address = server.address();
    if (!address || typeof address === "string") reject(new Error("Expected an ephemeral TCP port"));
    else resolve(address.port);
  });
});

const closeServer = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

const countArrival = (arrivals: Map<string, number>, request: IncomingMessage) => {
  const key = `${request.method ?? ""} ${new URL(request.url ?? "/", "http://localhost").pathname}`;
  arrivals.set(key, (arrivals.get(key) ?? 0) + 1);
};

const sendJson = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

async function startHarness(scenario: Scenario = {}): Promise<Harness> {
  const pageServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>CORS origin</title></head><body>local origin</body></html>");
  });
  const originPort = await listen(pageServer);
  const origin = `http://127.0.0.1:${originPort}`;
  const arrivals = new Map<string, number>();
  const apiServer = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    countArrival(arrivals, request);
    if (request.method === "OPTIONS") {
      const requestedMethod = String(request.headers["access-control-request-method"] ?? "");
      const requestedHeaders = String(request.headers["access-control-request-headers"] ?? "");
      const disallowed = scenario.failModelsPreflight && path === "/v1/models";
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": disallowed ? "POST" : requestedMethod,
        "Access-Control-Allow-Headers": disallowed ? "x-unexpected" : requestedHeaders,
        "Access-Control-Max-Age": "0",
      });
      response.end();
      return;
    }
    if (scenario.hangActual) return;
    if (scenario.redirectActual) {
      response.writeHead(302, { "Access-Control-Allow-Origin": origin, Location: "/redirect-target" });
      response.end();
      return;
    }
    sendJson(response, 401, { error: { message: "invalid synthetic key" } }, scenario.omitActualOrigin ? {} : { "Access-Control-Allow-Origin": origin });
  });
  const apiPort = await listen(apiServer);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;

  return {
    origin,
    navigationUrl: `${origin}/`,
    targets: [
      { endpoint: "models", url: `${apiOrigin}/v1/models`, method: "GET" },
      { endpoint: "chat/completions", url: `${apiOrigin}/v1/chat/completions`, method: "POST" },
    ],
    arrivals,
    async close() {
      await Promise.all([closeServer(pageServer), closeServer(apiServer)]);
    },
  };
}

const collect = (harness: Harness, timeoutMs = 2_000, browserType: BrowserType = chromium) => collectBrowserCors({
  chromium: browserType,
  origin: harness.origin,
  navigationUrl: harness.navigationUrl,
  targets: harness.targets,
  timeoutMs,
  env: {},
});

const browserTypeWithoutCorsEvents = (): BrowserType => ({
  launch: async (options) => {
    const browser = await chromium.launch(options);
    return new Proxy(browser, {
      get(target, property) {
        if (property === "newContext") return async (contextOptions: BrowserContextOptions) => {
          const context = await target.newContext(contextOptions);
          return new Proxy(context, {
            get(contextTarget, contextProperty) {
              if (contextProperty === "newCDPSession") return async (page: Page) => {
                const session = await contextTarget.newCDPSession(page);
                return { send: session.send.bind(session), on: () => {} };
              };
              const value = Reflect.get(contextTarget, contextProperty, contextTarget);
              return typeof value === "function" ? value.bind(contextTarget) : value;
            },
          });
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as Awaited<ReturnType<BrowserType["launch"]>>;
  },
} as BrowserType);

const browserTypeWithContextCloseFailure = (): BrowserType => ({
  launch: async (options) => {
    const browser = await chromium.launch(options);
    return new Proxy(browser, {
      get(target, property) {
        if (property === "newContext") return async (contextOptions: BrowserContextOptions) => {
          const context = await target.newContext(contextOptions);
          return new Proxy(context, {
            get(contextTarget, contextProperty) {
              if (contextProperty === "close") return async () => {
                await contextTarget.close();
                throw new Error("synthetic close failure after real context close");
              };
              const value = Reflect.get(contextTarget, contextProperty, contextTarget);
              return typeof value === "function" ? value.bind(contextTarget) : value;
            },
          });
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as Awaited<ReturnType<BrowserType["launch"]>>;
  },
} as BrowserType);

const arrivalsFor = (harness: Harness, method: string, pathname: string) => harness.arrivals.get(`${method} ${pathname}`) ?? 0;

test.describe("genuine browser CORS preflights", () => {
  test("reads the synthetic 401 after successful OPTIONS for both endpoint types", async () => {
    const harness = await startHarness();
    try {
      const result = await collect(harness);
      expect(result.failure).toBeNull();
      expect(result.navigationStatus).toBe(200);
      expect(result.originMatched).toBe(true);
      expect(result.cleanup).toEqual({ contextClosed: true, browserClosed: true });
      expect(result.endpoints).toHaveLength(2);
      expect(result.endpoints.map(({ endpoint }) => endpoint)).toEqual(["models", "chat/completions"]);
      for (const endpoint of result.endpoints) {
        expect(endpoint.preflight).toMatchObject({ observed: true, status: 204, matches: true });
        expect(endpoint.response).toEqual({ readable: true, status: 401 });
      }
      expect(arrivalsFor(harness, "OPTIONS", "/v1/models")).toBe(1);
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(1);
      expect(arrivalsFor(harness, "OPTIONS", "/v1/chat/completions")).toBe(1);
      expect(arrivalsFor(harness, "POST", "/v1/chat/completions")).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test("does not send the actual request when the real browser preflight fails", async () => {
    const harness = await startHarness({ failModelsPreflight: true });
    try {
      const result = await collect(harness);
      expect(result.failure).toBe("cors_preflight");
      expect(arrivalsFor(harness, "OPTIONS", "/v1/models")).toBe(1);
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(0);
      // The other endpoint still proves this harness can carry a successful CORS exchange.
      expect(arrivalsFor(harness, "OPTIONS", "/v1/chat/completions")).toBe(1);
      expect(arrivalsFor(harness, "POST", "/v1/chat/completions")).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test("reports an unreadable 401 when only the actual response omits the allowed origin", async () => {
    const harness = await startHarness({ omitActualOrigin: true });
    try {
      const result = await collect(harness);
      expect(result.failure).toBe("cors_response");
      expect(result.endpoints[0]?.preflight).toMatchObject({ status: 204, matches: true });
      expect(result.endpoints[0]?.response).toEqual({ readable: false, status: 401 });
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test("rejects a real browser context when CDP evidence is unavailable", async () => {
    const harness = await startHarness();
    try {
      const result = await collect(harness, 2_000, browserTypeWithoutCorsEvents());
      expect(result.failure).toBe("cors_evidence");
      expect(result.cleanup).toEqual({ contextClosed: true, browserClosed: true });
      expect(arrivalsFor(harness, "OPTIONS", "/v1/models")).toBe(1);
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test("fails a redirect without requesting its destination", async () => {
    const harness = await startHarness({ redirectActual: true });
    try {
      const result = await collect(harness);
      expect(result.failure).toBe("cors_redirect");
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(1);
      expect(arrivalsFor(harness, "GET", "/redirect-target")).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("records a timed out actual request and closes its isolated browser", async () => {
    const harness = await startHarness({ hangActual: true });
    try {
      const result = await collect(harness, 750);
      expect(result.failure).toBe("cors_timeout");
      expect(arrivalsFor(harness, "GET", "/v1/models")).toBe(1);
      expect(result.cleanup).toEqual({ contextClosed: true, browserClosed: true });
    } finally {
      await harness.close();
    }
  });

  test("reports a context cleanup failure after closing the real Chromium context", async () => {
    const harness = await startHarness();
    try {
      const result = await collect(harness, 2_000, browserTypeWithContextCloseFailure());
      expect(result.failure).toBe("cleanup");
      expect(result.cleanup).toEqual({ contextClosed: false, browserClosed: true });
      expect(result.endpoints.map(({ response }) => response)).toEqual([
        { readable: true, status: 401 },
        { readable: true, status: 401 },
      ]);
    } finally {
      await harness.close();
    }
  });
});

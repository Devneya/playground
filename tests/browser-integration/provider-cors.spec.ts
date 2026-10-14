import { createServer, type Server } from "node:http";
import { chromium, expect, test } from "@playwright/test";

const listen = (server: Server) => new Promise<number>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject);
    const address = server.address();
    if (address && typeof address !== "string") resolve(address.port);
    else reject(new Error("No server address"));
  });
});
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};
const cases: Array<{ name: string; path: string; headers: Record<string, string> }> = [
  { name: "Anthropic native", path: "/v1/messages", headers: { "x-api-key": "synthetic-cors-key", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", "content-type": "application/json" } },
  { name: "Gemini native", path: "/v1beta/models/synthetic-model:generateContent", headers: { "x-goog-api-key": "synthetic-cors-key", "content-type": "application/json" } },
  { name: "custom base path", path: "/custom/api/v1/chat/completions", headers: { authorization: "Bearer synthetic-cors-key", "content-type": "application/json" } },
];

for (const provider of cases) {
  for (const failure of ["none", "preflight", "response"] as const) {
    test(`${provider.name}: actual unrouted CORS ${failure}`, async () => {
      const pageServer = createServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>CORS</title>"); });
      const origin = `http://127.0.0.1:${await listen(pageServer)}`;
      const arrivals: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined> }> = [];
      const apiServer = createServer((request, response) => {
        arrivals.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers });
        if (request.method === "OPTIONS") {
          response.writeHead(204, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": failure === "preflight" ? "x-unexpected" : String(request.headers["access-control-request-headers"]), "Access-Control-Max-Age": "0" });
          response.end();
        } else {
          response.writeHead(401, { "Content-Type": "application/json", ...(failure === "response" ? {} : { "Access-Control-Allow-Origin": origin }) });
          response.end('{"error":"synthetic invalid key"}');
        }
      });
      const apiOrigin = `http://127.0.0.1:${await listen(apiServer)}`;
      const browser = await chromium.launch({ env: {} });
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        await page.goto(origin);
        const result = await page.evaluate(async ({ url, headers }) => {
          try {
            const response = await fetch(url, { method: "POST", headers, body: "{}", mode: "cors", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(2000) });
            await response.json();
            return { readable: true, status: response.status };
          } catch { return { readable: false, status: null }; }
        }, { url: `${apiOrigin}${provider.path}`, headers: provider.headers });
        expect(result).toEqual(failure === "none" ? { readable: true, status: 401 } : { readable: false, status: null });
        const preflight = arrivals.find(arrival => arrival.method === "OPTIONS");
        expect(preflight?.path).toBe(provider.path);
        expect(preflight?.headers["access-control-request-method"]).toBe("POST");
        expect(String(preflight?.headers["access-control-request-headers"]).split(",").map(value => value.trim()).sort()).toEqual(Object.keys(provider.headers).sort());
        const actual = arrivals.find(arrival => arrival.method === "POST");
        if (failure === "preflight") expect(actual).toBeUndefined();
        else {
          expect(actual?.path).toBe(provider.path);
          for (const [name, value] of Object.entries(provider.headers)) expect(actual?.headers[name]).toBe(value);
          expect(actual?.headers.cookie).toBeUndefined();
        }
      } finally {
        await context.close();
        await browser.close();
        await Promise.all([close(pageServer), close(apiServer)]);
      }
      expect(browser.isConnected()).toBe(false);
    });
  }
}

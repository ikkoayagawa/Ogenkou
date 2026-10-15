import {createServer, type Server} from "node:http";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

/** A private, static runtime origin. No manuscript or filesystem-read API. */
export class RuntimeServer {
  #server?: Server;
  url = "";
  constructor(private readonly directory: string) {}
  async start(): Promise<void> {
    const token = randomBytes(24).toString("hex"), prefix = "/" + token + "/";
    const server = createServer(async (request, response) => {
      const name = new URL(request.url ?? "/", "http://localhost").pathname;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      // The token is the capability shared only with this preview's Webview.
      response.setHeader("Access-Control-Allow-Origin", "*");
      if (request.method !== "GET" || !name.startsWith(prefix)) {response.writeHead(404);response.end();return;}
      const relative = name.slice(prefix.length);
      if (relative === "cw") {
        const nonce = randomBytes(16).toString("hex");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' blob: data:; connect-src 'self' blob: data:; img-src blob: data:; font-src 'self' blob: data:`);
        response.end(`<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}#viewport{width:1100px;height:850px}</style></head><body><div id="viewport"></div><script src="core.js"></script><script nonce="${nonce}" type="module">import {startCW} from './browser.mjs';startCW(${JSON.stringify(this.url)});</script></body></html>`);return;
      }
      if (!(["core.js", "browser.mjs", "ui.mjs", "layout-geometry.js", "paper-size.js", "page-margin.js"].includes(relative) || relative.startsWith("resources/"))) {response.writeHead(404);response.end();return;}
      let candidate: string;
      try {candidate = path.resolve(this.directory, decodeURIComponent(relative));}
      catch {response.writeHead(404);response.end();return;}
      if (!candidate.startsWith(path.resolve(this.directory) + path.sep)) {response.writeHead(404);response.end();return;}
      try {
        const bytes = await readFile(candidate);
        const type = candidate.endsWith(".css") ? "text/css" : candidate.endsWith(".xml") ? "application/xml" : /\.(?:js|mjs)$/u.test(candidate) ? "text/javascript" : "application/octet-stream";
        response.setHeader("Content-Type", type);response.end(bytes);
      } catch {response.writeHead(404);response.end();}
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {server.once("error", reject);server.listen(0, "127.0.0.1", resolve);});
    const address = server.address();if (!address || typeof address === "string") throw Error("Preview runtime did not listen");
    this.url = `http://127.0.0.1:${address.port}${prefix}`;
  }
  async close(): Promise<void> {
    const server = this.#server;this.#server = undefined;
    if (server) {server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));}
  }
}

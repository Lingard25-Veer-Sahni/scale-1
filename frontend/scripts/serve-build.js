#!/usr/bin/env node
/**
 * Local verification server that behaves like a Render Static Site, so the
 * routing and status codes can be checked before anything is deployed.
 *
 *   node scripts/serve-build.js [port]     (default 4173)
 *
 * Rules, in the same order Render applies them:
 *   1. exact file match            -> 200 with that file
 *   2. directory index            -> 200 with <path>/index.html
 *   3. a route rule from render.yaml -> 200 with the rewrite destination
 *   4. nothing matched            -> 404 with build/404.html
 *
 * It is a development aid only. Nothing in the app imports it and it is never
 * part of a deploy.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const BUILD_DIR = path.resolve(__dirname, "..", "build");
const PORT = Number(process.argv[2] || 4173);

// Must mirror the `routes:` block in /render.yaml.
const REWRITES = [
  { pattern: /^\/events\/[^/]+\/scholarship\/?$/, to: "/app-noindex.html" },
  { pattern: /^\/events\/[^/]+\/registered\/?$/, to: "/app-noindex.html" },
  { pattern: /^\/payment\/[^/]+\/?$/, to: "/app-noindex.html" },
  { pattern: /^\/p\/.+$/, to: "/app-noindex.html" },
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const full = path.join(BUILD_DIR, path.normalize(decoded));
  return full.startsWith(BUILD_DIR) ? full : null;
}

function send(res, status, file) {
  const body = fs.readFileSync(file);
  res.writeHead(status, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
  });
  res.end(body);
}

http
  .createServer((req, res) => {
    const urlPath = req.url.split("?")[0];
    const resolved = safeJoin(urlPath);

    if (resolved) {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return send(res, 200, resolved);
      }
      const asIndex = path.join(resolved, "index.html");
      if (fs.existsSync(asIndex)) return send(res, 200, asIndex);
    }

    for (const rule of REWRITES) {
      if (rule.pattern.test(urlPath)) {
        const dest = path.join(BUILD_DIR, rule.to);
        if (fs.existsSync(dest)) return send(res, 200, dest);
      }
    }

    const notFound = path.join(BUILD_DIR, "404.html");
    if (fs.existsSync(notFound)) return send(res, 404, notFound);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found\n");
  })
  .listen(PORT, () => {
    console.log(`serving ${BUILD_DIR} like a Render static site on http://localhost:${PORT}`);
  });

// Zero-dependency static dev server for the standalone hero build.
// Serves THIS folder as the site root (the page uses root-absolute
// paths like /styles.css and /assets/…). Start with: npm run dev
import http from "http";
import { createReadStream, existsSync, statSync } from "fs";
import { join, extname, normalize } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    let path = decodeURIComponent(req.url.split("?")[0]);
    if (path === "/") path = "/index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 " + path);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store", // always fresh while iterating
    });
    createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    console.log(`Goldsmith & Co hero → http://localhost:${PORT}/`);
  });

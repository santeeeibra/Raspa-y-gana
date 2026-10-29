// Servidor local sin cuenta Cloudflare:  node worker/dev/servidor-local.mjs
// Usa el mismo Worker de producción con una base SQLite local (worker/.local/) y sirve la carpeta asesor/.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { crearHash } from "../src/auth.js";
import { crearD1 } from "./d1-shim.mjs";
import { sembrarDemo } from "./sembrar-demo.mjs";

const raiz = fileURLToPath(new URL("../../asesor/", import.meta.url));
const local = fileURLToPath(new URL("../.local/", import.meta.url));
mkdirSync(join(local, "r2"), { recursive: true });
const PASS = process.env.LV_ADMIN_PASSWORD || "las-vegas-dev";
const env = {
  DB: crearD1(join(local, "dev.sqlite")), DEV: "1", ADMIN_NOMBRE: "admin-local",
  ADMIN_PASSWORD_HASH: await crearHash(PASS), SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  IMAGENES: { // R2 simulado en disco
    async put(k, v) { const p = join(local, "r2", k.replaceAll("/", "__")); writeFileSync(p, v); },
    async get(k) { const p = join(local, "r2", k.replaceAll("/", "__")); return existsSync(p) ? { body: readFileSync(p), httpMetadata: { contentType: "image/" + (k.endsWith("png") ? "png" : k.endsWith("webp") ? "webp" : "jpeg") } } : null; },
    async delete(k) { try { unlinkSync(join(local, "r2", k.replaceAll("/", "__"))); } catch {} },
  },
};
if (process.env.LV_DEMO === "1") console.log(await sembrarDemo(env.DB) ? "Datos de DEMOSTRACIÓN cargados (investigación [DEMO])" : "Datos de demostración ya cargados");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".ttf": "font/ttf" };
const CABECERAS = Object.fromEntries(readFileSync(join(raiz, "_headers"), "utf8").split("\n").filter(l => /^\s+\S+:/.test(l)).map(l => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const puerto = +process.env.PORT || 8787;

createServer(async (rq, rs) => {
  const url = new URL(rq.url, `http://localhost:${puerto}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: rq.method, headers: rq.headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : body, duplex: "half" }), env);
    const headers = {}; r.headers.forEach((v, k) => headers[k] = v);
    const sc = r.headers.getSetCookie?.(); if (sc?.length) headers["set-cookie"] = sc;
    rs.writeHead(r.status, headers); return rs.end(Buffer.from(await r.arrayBuffer()));
  }
  let ruta = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  const archivo = join(raiz, ruta);
  if (!archivo.startsWith(raiz) || !existsSync(archivo)) { rs.writeHead(404); return rs.end("No encontrado"); }
  rs.writeHead(200, { ...CABECERAS, "Content-Type": TIPOS[extname(archivo)] || "application/octet-stream" }); rs.end(readFileSync(archivo));
}).listen(puerto, () => console.log(`Asesor:  http://localhost:${puerto}/\nGestor:  http://localhost:${puerto}/gestor.html  (contraseña local: ${PASS})`));

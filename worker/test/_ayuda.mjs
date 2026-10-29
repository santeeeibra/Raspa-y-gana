import worker from "../src/index.js";
import { crearHash } from "../src/auth.js";
import { crearD1 } from "../dev/d1-shim.mjs";

export const PASS = "contraseña-de-prueba-123", PASS_REV = "otra-contraseña-revisor-456";
export const nuevoEnv = async (extra = {}) => ({ DB: crearD1(), DEV: "1", GESTOR_HABILITADO: "1", ADMIN_PASSWORD_HASH: await crearHash(PASS, 1000), SESSION_SECRET: "x".repeat(40), ...extra });
export const cliente = (e) => {
  const c = { cookie: "", csrf: "" };
  c.call = async (m, p, b, extra = {}) => {
    const h = { ...(c.cookie ? { cookie: c.cookie } : {}), ...extra }; let body;
    if (m !== "GET" && c.csrf && !c.sinCsrf) h["x-csrf-token"] = c.csrf;
    if (b !== undefined && m !== "GET") { body = typeof b === "string" ? b : JSON.stringify(b); h["content-type"] ??= "application/json"; }
    const r = await worker.fetch(new Request("http://x.test" + p, { method: m, headers: h, body }), e);
    const sc = r.headers.get("set-cookie"); if (sc && p.endsWith("login")) c.cookie = sc.split(";")[0];
    const data = await r.json().catch(() => null);
    if (p.endsWith("login") && data?.csrf) c.csrf = data.csrf;
    return { status: r.status, data };
  };
  c.login = pw => c.call("POST", "/api/admin/login", { password: pw });
  return c;
};
/** Entorno con dos roles y un cliente por rol. */
export async function dosRoles(extra = {}) {
  const env = await nuevoEnv({ REVISOR_PASSWORD_HASH: await crearHash(PASS_REV, 1000), ...extra });
  const ed = cliente(env), rev = cliente(env); await ed.login(PASS); await rev.login(PASS_REV);
  return { env, ed, rev };
}
export const html = (cuerpo) => new Response(`<html><head><style>x{}</style></head><body><script>alert(1)</script>${cuerpo}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

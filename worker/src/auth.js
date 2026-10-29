// Autenticación del gestor: contraseña con PBKDF2 + cookie de sesión firmada (HMAC) + token CSRF atado a la sesión.
// Sin localStorage ni PIN. La cookie es HttpOnly y, en producción, usa el prefijo __Host- (obliga Secure, Path=/ y sin Domain).
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
export const SESION_SEGUNDOS = 8 * 3600;
export const ITERACIONES = 100000; // máximo que permite Cloudflare Workers
export const ROLES = ["editor", "revisor"];

async function pbkdf2(password, salt, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256);
}
export function iguales(a, b) { // comparación en tiempo constante
  if (a.length !== b.length) return false; let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}
/** Formato del secreto:  pbkdf2$iteraciones$sal$hash */
export async function crearHash(password, iter = ITERACIONES) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iter}$${b64(salt)}$${b64(await pbkdf2(password, salt, iter))}`;
}
export async function verificarPassword(password, guardado) {
  const [tipo, iter, sal, hash] = String(guardado || "").split("$");
  if (tipo !== "pbkdf2" || !iter || !sal || !hash) return false;
  const calc = new Uint8Array(await pbkdf2(String(password), unb64(sal), +iter));
  return iguales(calc, unb64(hash));
}
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const csrfDe = async (secret, cuerpo) => b64(await hmac(secret, "csrf:" + cuerpo));

/** Devuelve { token, csrf }. El rol queda firmado dentro de la sesión. */
export async function crearSesion(secret, rol) {
  const cuerpo = b64(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESION_SEGUNDOS, rol, n: b64(crypto.getRandomValues(new Uint8Array(8))) })));
  return { token: `${cuerpo}.${b64(await hmac(secret, cuerpo))}`, csrf: await csrfDe(secret, cuerpo) };
}
/** Devuelve { rol, csrf } o null. */
export async function leerSesion(token, secret) {
  if (!token || !secret || secret.length < 16) return null;
  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return null;
  try {
    if (!iguales(await hmac(secret, cuerpo), unb64(firma))) return null;
    const d = JSON.parse(new TextDecoder().decode(unb64(cuerpo)));
    if (!(d.exp > Date.now() / 1000) || !ROLES.includes(d.rol)) return null;
    return { rol: d.rol, csrf: await csrfDe(secret, cuerpo) };
  } catch { return null; }
}
export const csrfValido = (enviado, esperado) => typeof enviado === "string" && iguales(enc.encode(enviado), enc.encode(esperado));
export const nombreCookie = env => (env.DEV === "1" ? "lv_sesion" : "__Host-lv_sesion");
export const cookie = (valor, env, maxAge) =>
  `${nombreCookie(env)}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${env.DEV === "1" ? "" : "; Secure"}`;
export const leerCookie = (req, env) =>
  (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${nombreCookie(env)}=([^;]+)`))?.[1];

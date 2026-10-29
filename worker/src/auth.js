// Autenticación del gestor: contraseña con PBKDF2 + cookie de sesión firmada (HMAC). Sin localStorage ni PIN.
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
export const SESION_SEGUNDOS = 8 * 3600;
export const ITERACIONES = 100000; // máximo que permite Cloudflare Workers

async function pbkdf2(password, salt, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256);
}
function iguales(a, b) { // comparación en tiempo constante
  if (a.length !== b.length) return false; let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}
/** Formato guardado en el secreto ADMIN_PASSWORD_HASH:  pbkdf2$iteraciones$sal$hash */
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
export async function crearSesion(secret) {
  const cuerpo = b64(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESION_SEGUNDOS, n: b64(crypto.getRandomValues(new Uint8Array(8))) })));
  return `${cuerpo}.${b64(await hmac(secret, cuerpo))}`;
}
export async function leerSesion(token, secret) {
  if (!token || !secret || secret.length < 16) return false;
  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return false;
  try {
    if (!iguales(await hmac(secret, cuerpo), unb64(firma))) return false;
    return JSON.parse(new TextDecoder().decode(unb64(cuerpo))).exp > Date.now() / 1000;
  } catch { return false; }
}
export const cookie = (valor, req, env, maxAge) =>
  `lv_sesion=${valor}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${env.DEV === "1" ? "" : "; Secure"}`;
export const leerCookie = req => (req.headers.get("Cookie") || "").match(/(?:^|;\s*)lv_sesion=([^;]+)/)?.[1];

// Carga los secretos del gestor en Cloudflare SIN mostrarlos ni guardarlos en archivos.
//   Uso (desde tu computadora, ya logueado con `npx wrangler login`):
//     node scripts/configurar-secretos.mjs lasvegas-asesor-demo
// Pide la contraseña del gestor oculta, genera SESSION_SECRET al azar y los manda a Wrangler por entrada estándar.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { crearHash } from "../src/auth.js";

export const generarSecreto = () => randomBytes(48).toString("base64url");

function pedirOculto(pregunta) {
  return new Promise(res => {
    process.stdout.write(pregunta); const { stdin } = process; let s = "";
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    const f = c => { for (const ch of c) { if (ch === "\r" || ch === "\n") { stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", f); process.stdout.write("\n"); return res(s); } if (ch === "\u0003") process.exit(1); if (ch === "\u007f") s = s.slice(0, -1); else s += ch; } };
    stdin.on("data", f);
  });
}
function poner(nombre, valor, worker) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", nombre, "--name", worker], { input: valor, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`No se pudo guardar ${nombre}. Revisá que hayas hecho "npx wrangler login" y que el Worker exista.`); process.exit(1); }
  console.log(`✓ ${nombre} guardado (valor oculto)`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const worker = process.argv[2]; if (!worker) { console.error("Indicá el nombre del Worker."); process.exit(1); }
  const pass = await pedirOculto("Contraseña del gestor (mínimo 12 caracteres): ");
  if (pass.length < 12) { console.error("Muy corta."); process.exit(1); }
  poner("ADMIN_PASSWORD_HASH", await crearHash(pass), worker);
  poner("SESSION_SECRET", generarSecreto(), worker);
}

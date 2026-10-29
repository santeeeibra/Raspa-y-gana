// Arma la carpeta pública de la DEMO (worker/dist-demo) con una lista BLANCA de archivos.
// Nunca se copian: gestor.html, gestor.js, investigacion.js (el gestor no existe en la demo).
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const origen = fileURLToPath(new URL("../../asesor/", import.meta.url));
export const ARCHIVOS_DEMO = ["index.html", "app.js", "engine.js", "vista.js", "asesor.css", "demo.json", "_headers", "assets"];

export function construir(destino = fileURLToPath(new URL("../dist-demo/", import.meta.url))) {
  rmSync(destino, { recursive: true, force: true }); mkdirSync(destino, { recursive: true });
  for (const f of ARCHIVOS_DEMO) { if (!existsSync(join(origen, f))) throw new Error("Falta " + f); cpSync(join(origen, f), join(destino, f), { recursive: true }); }
  // Hace que la página abra directamente en modo DEMO (cartel rojo y contenido de prueba separado).
  writeFileSync(join(destino, "config.json"), JSON.stringify({ demo: true }) + "\n");
  return destino;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log("Demo construida en", construir());

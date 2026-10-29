// Genera el valor del secreto ADMIN_PASSWORD_HASH:  node worker/dev/hash-password.mjs "tu contraseña larga"
import { crearHash } from "../src/auth.js";
const p = process.argv[2];
if (!p || p.length < 12) { console.error("Usá una contraseña de al menos 12 caracteres."); process.exit(1); }
console.log(await crearHash(p));

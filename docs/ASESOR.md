# Asesor de Imagen · LAS VEGAS (primera versión)

Todo lo nuevo está en `asesor/` (web) y `worker/` (API Cloudflare). **No toca** el Raspá y Ganá, Supabase ni GH3 Web.

## Probar en local (sin cuenta Cloudflare)
```bash
node worker/dev/servidor-local.mjs
```
- Asesor público: http://localhost:8787/  (con datos de demostración: `?demo=1`)
- Gestor privado: http://localhost:8787/gestor.html — contraseña local: `las-vegas-dev` (solo desarrollo)
- Pruebas automáticas: `cd worker && npm test`
- Requiere Node 22.5+ (usa `node:sqlite` solo para imitar D1 en local).

## Cómo funciona
- **Cuestionario** (`asesor/engine.js`): 10 preguntas; altura y transición del degradado solo aparecen si no elegiste «tijera». Las técnicas tienen «No sé, recomendame».
- **Motor**: puntaje explicable por criterios (pelo, largo, estilo, entradas, densidad, volumen, laterales, altura, transición, tiempo). «No sé» no suma ni resta; un dato que la ficha no trae no se inventa. No usa forma de rostro ni IA.
- **Regla de verificación**: solo se recomienda una ficha `verificado` + `publicado` + con fuentes https. Se exige en el motor, en la API y con triggers en la base. Los 16 cortes entran como `borrador` (solo nombre; el texto viejo de `guia.html` queda en notas internas, sin mostrarse).
- **Gestor**: crear/editar fichas, variantes, fuentes, fotos; enviar a revisión, aprobar, publicar/retirar. Editar una ficha verificada la devuelve a «pendiente».
- **Seguridad**: contraseña con PBKDF2 + cookie de sesión HttpOnly/Strict firmada (8 h), bloqueo tras 5 intentos, chequeo de origen, validación de listas, fotos con tipo real y tope 2 MB, derechos obligatorios y bloqueo de fotos de clientes. Sin PIN en localStorage.

## Para pasar a Cloudflare (pendiente, requiere autorización)
1. `npx wrangler d1 create las-vegas-asesor` y poner el `database_id` en `worker/wrangler.toml`.
2. `npx wrangler d1 migrations apply las-vegas-asesor --remote`
3. (Opcional) crear el bucket R2 y descomentar su bloque en `wrangler.toml`.
4. Secretos: `node worker/dev/hash-password.mjs "contraseña larga"` → `wrangler secret put ADMIN_PASSWORD_HASH`; y `SESSION_SECRET` aleatorio.
5. `npx wrangler deploy` (sirve la web y la API desde el mismo dominio).

## Pendiente
Chat con biblioteca verificada y límites anti-abuso, varios usuarios en el gestor (o Cloudflare Access), vincular fotos a variantes desde el gestor, migrar las fotos actuales de Supabase a R2 y enlazar desde `guia.html`.

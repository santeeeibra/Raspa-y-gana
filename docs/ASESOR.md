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

## Seguridad (fase 2)
- **CSRF**: cada sesión tiene un token (`X-CSRF-Token`) obligatorio en TODA operación que modifica algo, aunque no llegue `Origin`. Además se rechazan `Sec-Fetch-Site` cruzado y `Origin` ajeno. El gestor nunca responde CORS.
- **Cookie**: `__Host-lv_sesion` (HttpOnly, Secure, SameSite=Strict, Path=/, sin Domain). **Vercel + Cloudflare**: el gestor debe servirse desde el mismo dominio que la API (el Worker). La web pública puede estar en Vercel y leer `/api/cortes` y `/api/recomendar` entre sitios si se agrega su dominio a `PUBLIC_ORIGINS` (solo lectura, sin cookies).
- **Roles**: `editor` (carga y edita) y `revisor` (revisa fuentes, verifica y publica). Con una sola contraseña (`ADMIN_PASSWORD_HASH`) la persona tiene ambos roles; con `REVISOR_PASSWORD_HASH` se separan.
- **Tres pasos**: fuente revisada → ficha verificada → ficha publicada. La base lo exige con triggers. Si una ficha verificada se edita, vuelve a pendiente y se retira sola.
- **Abuso**: bloqueo de login por IP (5) y global (30) cada 10 min; límites en memoria para API pública (30 recomendaciones/min, 120 lecturas/min) y gestor (240/min). Eso es un freno básico por instancia: **al desplegar, agregar Reglas de limitación de Cloudflare** delante del Worker.
- **Cargas**: JSON máx. 64 KB; fotos máx. 2 MB, `Content-Length` obligatorio y comprobado antes de leer, tipo real por firma (JPG/PNG/WebP), máx. 12 fotos por corte.
- **Información interna**: la vista pública usa lista blanca; notas internas, quién verificó, derechos de fotos, ids y claves de R2 no salen nunca.

## Fotos de las preguntas (opcional)
Si querés fotos en las opciones técnicas, copiá las imágenes (propias o con permiso) a `asesor/assets/opciones/` y creá `manifest.json`:
`{"altura:bajo": {"src": "assets/opciones/altura-bajo.jpg", "alt": "…", "derechos": "Foto propia de Las Vegas"}}`.
Sin `derechos` la foto se ignora. Sin manifiesto se usan esquemas ilustrativos (dibujos). Imagen de inicio: `asesor/assets/hero.jpg` (si no existe, se usa el logo).

## Para pasar a Cloudflare (pendiente, requiere autorización)
1. `npx wrangler d1 create las-vegas-asesor` y poner el `database_id` en `worker/wrangler.toml`.
2. `npx wrangler d1 migrations apply las-vegas-asesor --remote`
3. (Opcional) crear el bucket R2 y descomentar su bloque en `wrangler.toml`.
4. Secretos: `node worker/dev/hash-password.mjs "contraseña larga"` → `wrangler secret put ADMIN_PASSWORD_HASH` (y `REVISOR_PASSWORD_HASH` si habrá dos personas); `SESSION_SECRET` aleatorio. Variables: `PUBLIC_ORIGINS` (dominio de Vercel).
5. `npx wrangler deploy` (sirve la web y la API desde el mismo dominio).

## Pendiente
Reglas de limitación de Cloudflare, fotos reales autorizadas para las preguntas y el inicio, Chat con biblioteca verificada y límites anti-abuso, varios usuarios en el gestor (o Cloudflare Access), vincular fotos a variantes desde el gestor, migrar las fotos actuales de Supabase a R2 y enlazar desde `guia.html`.

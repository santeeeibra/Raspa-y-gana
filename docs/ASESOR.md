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

## Investigación asistida (fase 3)
Gestor → pestaña **Investigación asistida**. Pantallas: Biblioteca de cortes → Nueva investigación → (1) Fuentes encontradas → (2) Revisión de afirmaciones → (3) Vista previa → (4) Aprobar y publicar.
- **Estados**: pendiente → investigando → propuesta preparada → en revisión → aprobada / rechazada.
- **Fuentes**: *encontrada* (apareció) → *leída* (una persona la leyó o se guardó su texto) → *validada* (un revisor la aceptó). Solo las leídas respaldan afirmaciones; solo las validadas permiten aprobar.
- **Afirmaciones**: cada una lleva fuente, URL y fragmento/referencia. Se aceptan, editan (queda el valor original) o rechazan. La base exige evidencia de una fuente leída para aceptar. Si la fuente tiene texto guardado, la cita debe aparecer literalmente en él.
- **Aprobar ≠ verificar ≠ publicar**: aprobar aplica solo lo aceptado a la ficha (guarda una versión anterior, deja la ficha en «pendiente»); verificar y publicar siguen siendo pasos aparte con confirmación. La IA no puede ejecutar ninguno (los endpoints exigen sesión + CSRF + rol revisor).
- **Historial**: tabla `revisiones` (quién, cuándo, antes/después) y `versiones_ficha`. Responsable = `ADMIN_NOMBRE` o el rol. Identidad individual real queda pendiente (varios usuarios / Cloudflare Access).
- **Proveedores** (`worker/src/proveedores.js`): interfaz `Buscador` y `Redactor`. Workers AI se activa con el binding `AI`; el buscador (adaptador Brave, **no probado con el servicio real**) con `SEARCH_PROVIDER=brave` + secreto `SEARCH_API_KEY`. Sin ellos: «Investigación automática no disponible» y se trabaja a mano. Si un proveedor falla o se agotan los créditos, el contenido en revisión se conserva.
- **Defensas**: las páginas externas son datos no confiables (se pasan a la IA delimitadas, se descarta toda propuesta cuyo campo/valor no sea válido o cuya cita no aparezca literal en el documento); lector solo https público (sin IPs, puertos ni redirecciones inseguras), máx. 200 KB de texto y 3 documentos por propuesta; topes diarios (`LIMITE_INVESTIGACIONES_DIARIAS`=10, `LIMITE_BUSQUEDAS_DIARIAS`=5, `LIMITE_PROPUESTAS_DIARIAS`=5).
- **Demostración**: `LV_DEMO=1 node worker/dev/servidor-local.mjs` carga una investigación `[DEMO]` (datos inventados, URLs `.invalid`); la API se niega a aplicarla a una ficha.
- El motor de recomendaciones no cambió ni usa IA: solo lee fichas verificadas y publicadas.

## Fotos de las preguntas (opcional)
Si querés fotos en las opciones técnicas, copiá las imágenes (propias o con permiso) a `asesor/assets/opciones/` y creá `manifest.json`:
`{"altura:bajo": {"src": "assets/opciones/altura-bajo.jpg", "alt": "…", "derechos": "Foto propia de Las Vegas"}}`.
Sin `derechos` la foto se ignora. Sin manifiesto se usan esquemas ilustrativos (dibujos). Imagen de inicio: `asesor/assets/hero.jpg` (si no existe, se usa el logo).

## Cloudflare: demo pública (fase 4)
**Estado**: configurado y probado en local con Wrangler real (workerd + D1 local). **Nada fue desplegado ni migrado en remoto** (no hay credenciales en el entorno de desarrollo).
- Worker: `lasvegas-asesor-demo` · D1: `lasvegas-asesor-demo` (`ea9dc45d-6a44-400d-9407-7ea9d1b5e095`, única base configurada) · sin dominios, rutas, R2 ni Workers AI.
- La demo pública (`worker/dist-demo`, armada por `npm run build:demo` con lista blanca) **no incluye** gestor ni investigación, abre directo en modo DEMO (`config.json`) con contenido ficticio de `demo.json` y no llama a la API. Con `GESTOR_HABILITADO="0"` toda `/api/admin/*` responde 404.
- Tickets, premios y Supabase no se usan en nada de esto.

### Comandos para tu computadora (en este orden)
```bash
git fetch origin && git checkout claude/fervent-ride-fxt7gx && git pull
cd worker && npm install
npx wrangler login
npx wrangler whoami
npx wrangler d1 migrations list lasvegas-asesor-demo --remote
npx wrangler d1 migrations apply lasvegas-asesor-demo --remote
```
`whoami` debe mostrar TU cuenta. `migrations apply` lista las 4 migraciones y pide confirmar: ninguna borra ni reemplaza datos. Resultado esperado: 13 tablas y 16 cortes en borrador.

### Primer despliegue (esperar confirmación)
```bash
npx wrangler deploy
```
URL prevista: `https://lasvegas-asesor-demo.<tu-subdominio>.workers.dev`. Consume el plan gratuito de Workers (solicitudes) y D1 (lecturas/escrituras); sin método de pago, sin R2 ni IA. Verificar límites vigentes en el panel de Cloudflare.

### Gestor privado (más adelante, entorno aparte)
No se habilita en la demo. Para usarlo: crear un Worker privado (otro nombre), `GESTOR_HABILITADO="1"`, cargar secretos con `node scripts/configurar-secretos.mjs <nombre-del-worker>` (pide la contraseña oculta; no imprime nada) y construir con `asesor/` completo. Riesgo a confirmar: el hash de contraseña usa PBKDF2 de 100.000 iteraciones y el plan gratuito tiene un tope de CPU muy bajo por solicitud; si el login falla por CPU, hace falta el plan de pago o bajar iteraciones.

## Pendiente
Reglas de limitación de Cloudflare, fotos reales autorizadas para las preguntas y el inicio, Chat con biblioteca verificada y límites anti-abuso, varios usuarios en el gestor (o Cloudflare Access), vincular fotos a variantes desde el gestor, migrar las fotos actuales de Supabase a R2 y enlazar desde `guia.html`.

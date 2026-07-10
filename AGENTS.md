# AGENTS.md — Manual de operación del agente

Este proyecto opera bajo una **arquitectura de 3 capas** que separa responsabilidades
para maximizar confiabilidad. Los LLMs son probabilísticos; la lógica de negocio es
determinista. Este sistema resuelve esa incompatibilidad empujando la complejidad al
código determinista y dejando al agente solo la toma de decisiones.

## Las 3 capas

**Capa 1 — Directiva (Qué hacer)** · `directives/`
SOPs en Markdown: objetivos, entradas, herramientas a usar, salidas y casos extremos.
Instrucciones en lenguaje natural. Documentos vivos: se mejoran, no se descartan.

**Capa 2 — Orquestación (Decidir)** · el agente (tú)
Enrutamiento inteligente: leer la directiva, llamar la ejecución en el orden correcto,
manejar errores, pedir aclaraciones, y registrar aprendizajes. Puente entre intención y
ejecución. No hagas el trabajo pesado a mano: delega en la Capa 3.

**Capa 3 — Ejecución (Hacer)** · `src/` (y `execution/` para utilidades offline)
Código determinista, testeable, rápido. En ESTE proyecto la ejecución es **TypeScript**
(`src/`), porque el producto es un servidor Node de webhooks en vivo. `execution/` queda
reservado para scripts standalone (p. ej. Python) de tareas offline puntuales.
> Desviación consciente respecto a la plantilla original (que asume Python). Ver aprendizaje 2026-07-09.

**Por qué funciona:** 90% de precisión por paso = 59% de éxito en 5 pasos. Empujar la
complejidad a código determinista sube la confiabilidad. El agente solo decide.

## Principios de operación

1. **Revisa primero si ya existe la herramienta.** Antes de escribir código nuevo, mira
   `src/` (y `execution/`) según la directiva. Crea algo nuevo solo si no existe.
2. **Auto-corrección al fallar.** Lee error + stack. Corrige y re-prueba (si gasta
   créditos/tokens de pago, consulta antes). Actualiza la directiva con lo aprendido.
3. **Actualiza las directivas al aprender.** Restricciones de API, mejores enfoques,
   gotchas, tiempos. No crees ni sobreescribas directivas sin preguntar, salvo indicación
   explícita.

## Ciclo de auto-corrección
1. Corrige el problema → 2. Actualiza la herramienta → 3. Pruébala (typecheck + tests) →
4. Actualiza la directiva → 5. El sistema queda más robusto.

## Organización de archivos
- `directives/` — SOPs en Markdown (instrucciones).
- `src/` — ejecución determinista (TypeScript). Es el producto.
- `execution/` — utilidades offline standalone (opcional).
- `.tmp/` — intermedios (dossiers, scraps, exports). Nunca al repo; siempre regenerables.
- `.env` — variables y claves. Nunca al repo.

**Principio clave:** los intermedios viven en `.tmp/` y son borrables. Toda salida debe ser
reproducible re-ejecutando el flujo, nunca editada a mano.

Sé pragmático. Sé confiable. Auto-corrígete.

---

## Aprendizajes del Agente (Mejora Continua)

> **INSTRUCCIÓN CRÍTICA:** Esta sección es memoria persistente. **Con cada ciclo de
> ejecución** (tarea completada, error resuelto, patrón descubierto, flujo ajustado) **y con
> cada actualización de Markdown** (directivas, este archivo, READMEs), **agrega un
> aprendizaje** si surgió algo no trivial.
>
> **Registrar:** restricciones de API, rate limits reales, patrones que funcionan, errores
> recurrentes, decisiones de diseño con el usuario, supuestos falsos, atajos, gotchas del entorno.
> **No registrar:** detalles efímeros de una tarea, cosas ya en la directiva, trivialidades
> derivables del código.
>
> **Formato:**
> ```
> - **YYYY-MM-DD — [Tema corto]:** Descripción en 1-3 líneas. **Por qué importa:** consecuencia práctica.
> ```
>
> **Higiene:** actualiza o borra lo obsoleto; no acumules ruido. Orden por fecha (recientes
> arriba). Si superas ~25 entradas, consolida las viejas o promuévelas a la directiva.

### Registro de aprendizajes

<!-- Agrega nuevas entradas arriba de esta línea. -->

- **2026-07-09 — Host correcto: graph.instagram.com (no graph.facebook.com):** Los tokens de Instagram Login (`IGAA…`) solo son válidos contra `graph.instagram.com`. Llamarlos en `graph.facebook.com` da `OAuthException 190 "Cannot parse access token"`. **Por qué importa:** todas las llamadas (send, isFollower, caption, timestamp) deben usar ese host.

- **2026-07-09 — Ventana 24h: usar hora de recepción:** Meta manda el `timestamp` del webhook en **segundos**; compararlo contra `Date.now()` (ms) hace creer que pasaron años → falso "fuera de ventana", bloquea todo. Fix: `lastUserInteractionAt = Date.now()` al recibir. **Por qué importa:** sin esto ningún envío sale.

- **2026-07-09 — private_reply funciona, DMs de seguimiento no (regla Meta):** Un comentario permite UNA respuesta privada (`private_reply`, ventana ~7 días) que SÍ se envía. Pero DMs adicionales vía `/messages` dan `error 10 / 2534022 "outside allowed window"` hasta que el usuario ESCRIBA de vuelta (abre ventana 24h). **Por qué importa:** el flujo comment-to-DM debe entregar el valor en la respuesta privada o pedir "responde para recibir" y continuar cuando el usuario contesta (patrón ManyChat). Rediseño pendiente.

- **2026-07-09 — Modo Desarrollo no entrega webhooks reales:** En modo Desarrollo solo llegan los eventos del botón "Probar" y de cuentas con rol (tester). Para eventos reales hay que pasar la app a **Activo** (requiere URL de política de privacidad válida). Para mensajear a CUALQUIER usuario (no solo testers) se necesita **Acceso Avanzado** a `instagram_business_manage_messages` vía App Review. **Por qué importa:** define qué se puede probar sin trámite y qué necesita App Review.

- **2026-07-09 — cloudflared vs Norton:** Norton intercepta TLS (rompe `--protocol http2`: "certificate signed by unknown authority") y corta conexiones. El túnel QUIC por defecto (UDP) sí funciona pero puede flappear; medir estabilidad antes de dar la URL a Meta. URLs trycloudflare son **efímeras** (cambian al reiniciar) → para producción, deploy o túnel con nombre. **Por qué importa:** en esta máquina el túnel es frágil; el deploy es la solución real.

- **2026-07-09 — Entrega Drive por fecha del post:** Service Account + carpeta con nombre que contiene `YYYY-MM-DD` + link compartible en el DM. El `mediaId` se guarda en el estado para resolver la fecha aunque el usuario llegue por el postback "ya te sigo". Probado end-to-end en dry-run. **Por qué importa:** el creador solo organiza Drive por fecha; el sistema entrega el PDF correcto sin mapear nada por post.

- **2026-07-09 — Conflicto de tipos google-auth-library:** `@googleapis/drive` trae su propia copia anidada de `google-auth-library`; pasar el `GoogleAuth` del paquete top-level rompe el tipo (`#private`). Fix: cast `auth as unknown as never` (misma clase en runtime). **Por qué importa:** evita romper el typecheck sin degradar funcionalidad; no perder tiempo buscando otra causa.

- **2026-07-09 — Modo DRY_RUN para probar sin Meta:** `DRY_RUN=true` simula send/isFollower/getMediaCaption (loguea) y relaja la validación de credenciales. `execution/simulate_webhook.mjs` firma con HMAC y postea webhooks falsos. **Por qué importa:** valida la lógica completa (match, gate, entrega, dedupe) en local sin App Review ni tokens; probado OK follower/no-follower.

- **2026-07-09 — Windows: carpeta bloqueada al mover:** `Move-Item` del proyecto falla ("está en uso") si el shell tiene su cwd dentro. Solución: `Set-Location` al padre antes de mover. **Por qué importa:** mover/renombrar el repo requiere salir del directorio primero.

- **2026-07-09 — Proyectos en Documents:** todos los proyectos de Leonardo viven en `C:\Users\Lonardo Antonilez\Documents\`. **Por qué importa:** crear repos nuevos ahí, no en el home.

- **2026-07-09 — Follow-gate vía is_user_follow_business:** Meta expone `is_user_follow_business` al consultar el perfil del usuario dentro de una conversación abierta. Es el único modo fiable de saber si te sigue (no hay endpoint de lista de seguidores por privacidad). **Por qué importa:** el gate solo funciona una vez que hay ventana abierta (el usuario ya comentó/escribió); no se puede pre-chequear en frío.

- **2026-07-09 — Ventana de 24h y no-DM-masivo:** Meta solo permite mensajear dentro de 24h desde la última interacción del usuario, ~200 msg/h. DM masivo en frío = ban. **Por qué importa:** el diseño se limita a flujos disparados por el usuario (comment-to-DM, DM, story reply) + broadcast solo a ventanas abiertas. LinkedIn/YouTube no tienen API de DM; Twitter/X es tier pago.

- **2026-07-09 — Keyword derivada del copy (modo caption):** Campañas con `trigger.mode:'caption'` derivan la keyword del caption del post en runtime (`keywordExtractor.ts`, regex determinista, sin costo). Se cachea por mediaId. **Por qué importa:** el creador no registra keyword por post; publica normal («comenta X») y el sistema dispara solo. Si el copy es ambiguo, ahí se enchufaría un fallback LLM.

- **2026-07-09 — Ejecución en TS, no Python:** La plantilla de 3 capas asume Python en `execution/`, pero el producto es un server Node de webhooks. La Capa 3 se mantiene en TS (`src/`) y `execution/` queda para utilidades offline. **Por qué importa:** evita dos runtimes y un rewrite no pedido; decisión consciente, no descuido.

- **2026-07-09 — Firma de webhook con body crudo:** La firma `X-Hub-Signature-256` de Meta se calcula sobre los BYTES crudos del body, no sobre el JSON re-serializado. `server/app.ts` guarda `req.rawBody` vía `express.json({ verify })`. **Por qué importa:** si validas contra `JSON.stringify(req.body)` la firma nunca coincide y todos los webhooks se rechazan.

- **2026-07-09 — Entorno Windows (tsx/esbuild):** `npm` no corre el postinstall de esbuild por política `allow-scripts`; hay que aprobarlo (`npm approve-builds esbuild`) para que `tsx` funcione. El flag `--loader tsx` está deprecado en Node 24 → usar `--import tsx`. **Por qué importa:** sin esto los tests no arrancan en esta máquina.

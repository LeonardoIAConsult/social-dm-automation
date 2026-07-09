# social-dm-automation

Motor de automatización de DMs para redes sociales, conectado **directo a la API de Meta** (Instagram) sin intermediarios tipo ManyChat. Flujos disparados por el usuario (comentario con palabra clave, DM entrante, respuesta a story) con **follow-gate**: el recurso de valor (PDF, link, etc.) se entrega **solo a quienes te siguen**.

Arquitectura de **adaptadores** → hoy Instagram; extensible a Facebook y otras redes sin tocar la lógica de negocio.

> ⚠️ **Lee [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) antes de usar.** Este sistema opera dentro de las políticas de Meta. El DM masivo en frío **no** es posible sin arriesgar un ban: Meta solo permite mensajear dentro de una ventana de 24h que **el usuario** abre al interactuar contigo.

## Qué hace
- Recibe webhooks de Instagram (mensajes, comentarios, postbacks, story replies).
- Valida la firma `X-Hub-Signature-256` de cada webhook.
- Hace match de **campañas** por palabra clave.
- Aplica el **follow-gate** con el campo oficial `is_user_follow_business`.
- Si la persona te sigue → entrega el valor. Si no → le pide seguirte y reintenta con un botón.
- Respeta la ventana de 24h y evita reenvíos duplicados.

## Qué NO hace (a propósito)
- DM masivo en frío a desconocidos (prohibido por Meta).
- LinkedIn / YouTube DMs (sus APIs no lo permiten).

## Stack
Node.js + TypeScript · Express · Zod · Pino. Sin base de datos en el MVP (estado en memoria, cambiable a Redis/Postgres).

## Arranque rápido
```bash
npm install
cp .env.example .env      # rellena los valores (ver docs/SETUP_META.md)
npm run dev               # servidor en http://localhost:3000
npm test                  # tests del parser y matcher
npm run typecheck         # chequeo de tipos
```
Expón el puerto con `ngrok http 3000` y usa esa URL https como Callback URL del webhook en el panel de Meta.

## Definir tus campañas
Edita [`src/core/campaigns.ts`](src/core/campaigns.ts). Es lo único que la mayoría necesita tocar: palabra clave, si exige seguir, textos y el contenido a entregar.

Dos modos de disparo:
- **`keywords`** — tú fijas las palabras clave.
- **`caption`** — el sistema **deriva la keyword del copy del post/carrusel/story** en tiempo real (ej. publicas «Comenta "PLANTILLA" y te la mando» → dispara solo, sin registrar nada por post). Ver [`directives/caption_driven_keywords.md`](directives/caption_driven_keywords.md).

## Marco de operación (3 capas + aprendizajes)
El repo sigue una arquitectura de 3 capas (Directiva → Orquestación → Ejecución) con un
registro de aprendizajes que se actualiza en cada ciclo. Ver [`AGENTS.md`](AGENTS.md) y [`directives/`](directives/).

## Documentación
- [`AGENTS.md`](AGENTS.md) — manual de operación del agente + registro de aprendizajes.
- [`directives/`](directives/) — SOPs (crear campaña, keyword desde el copy).
- [`docs/SETUP_META.md`](docs/SETUP_META.md) — crear la app Meta, permisos, App Review, webhook.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — cómo está armado y cómo sumar otra red.
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) — reglas de Meta que el sistema respeta.

## Estado
MVP funcional para Instagram. Roadmap: adaptador Facebook, persistencia en DB, broadcast a ventanas abiertas.

## Licencia
MIT — ver [`LICENSE`](LICENSE).

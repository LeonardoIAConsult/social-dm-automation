<p align="center">
  <img src="docs/assets/banner.png" alt="InboxPilot" width="100%">
</p>

<h1 align="center">InboxPilot</h1>

<p align="center">
  <a href="https://github.com/LeonardoIAConsult/social-dm-automation/actions/workflows/ci.yml"><img src="https://github.com/LeonardoIAConsult/social-dm-automation/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict">
</p>

<p align="center">
  <b>Automatiza tus DMs de Instagram, conectado directo a la API de Meta.</b><br>
  Alguien comenta una palabra clave en tu post → recibe un DM con un botón → al tocarlo,
  le entregas el recurso (PDF, artículo o video). Con <b>follow-gate</b> y dentro de las
  reglas de Meta. Sin intermediarios tipo ManyChat.
</p>

---

## ¿Qué hace?

Convierte comentarios en conversaciones y leads, automático:

1. Publicas un post cuyo copy dice *"Comenta AUTOMATIZA y te lo envío"*.
2. Alguien comenta **AUTOMATIZA** (o `guía`, `ver más`… lo que definas).
3. InboxPilot le manda un DM: *"¡Hola! Toca abajo para recibirlo"* + botón **[Obtener el enlace]**.
4. La persona toca el botón → se verifica que **te siga** → recibe el link/documento.

Las palabras y los links salen de una **Google Sheet** que tú manejas — sin tocar código.

<p align="center">
  <img src="docs/assets/como-funciona.png" alt="Cómo funciona InboxPilot" width="90%">
</p>

## Por qué es potente

Cada capacidad, por el beneficio que te da:

- 🔌 **No pagas intermediarios** — habla directo a la API de Meta (Instagram). Sin la mensualidad de ManyChat ni depender de nadie.
- 💬 **Convierte comentarios en leads solo** — comment-to-DM con botón (patrón ManyChat), siempre dentro de las ventanas que Meta permite.
- 🔒 **Hace crecer tus seguidores** — el follow-gate (`is_user_follow_business`) entrega el recurso solo a quien te sigue: para recibir, primero te sigue.
- 📄 **Cambias campañas en ~1 minuto, sin programador** — palabra → link desde tu Google Sheet (PDF de Drive, web o YouTube). Editas la hoja y ya.
- 🧠 **No pierdes un lead por un typo** — el match ignora tildes, mayúsculas, signos y palabras extra (`guía` = `GUIA` = `Guia!`).
- 🛡️ **Nadie falsifica tus webhooks** — valida la firma `X-Hub-Signature-256` de cada evento y descarta reenvíos duplicados.
- 🚦 **Protegido contra baneos** — rate-limit por cuenta (ventana deslizante) que respeta el tope de Meta.
- 🔁 **No se te cae un envío** — cola con reintentos (backoff + requeue por rate-limit), worker in-process.
- 🏢 **Manejas varias cuentas/marcas a la vez** — estado aislado por tenant (`accountId`).
- 🧩 **Crece contigo** — arquitectura de adaptadores (hoy Instagram, mañana Facebook) y persistencia intercambiable (memoria, JSON o **Postgres**) tras una misma interfaz, sin tocar el motor.
- 🧪 **Pruebas todo sin arriesgar nada** — modo DRY_RUN corre el flujo completo sin credenciales.
- ✅ **Confiable de base** — TypeScript estricto + tests (`node:test`), typecheck limpio.

## Qué NO hace (a propósito)

- ❌ DM masivo en frío a desconocidos (prohibido por Meta = ban).
- ❌ LinkedIn / YouTube DMs (sus APIs no lo permiten).

> ⚠️ Lee [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md). Meta solo permite mensajear dentro de una
> ventana de 24h que **el usuario** abre al interactuar. InboxPilot opera dentro de esas reglas.

## Cómo configuras tus campañas

Todo vive en tu **Google Sheet** de planeación (guía: [`docs/RESOURCES_SHEET.md`](docs/RESOURCES_SHEET.md)):

| CTA (columna) | Recurso_DM (columna) |
|---|---|
| Comenta **AUTOMATIZA** → DM | `https://tu-sitio.com/tu-articulo` |
| Comenta **GUIA** → DM | `https://drive.google.com/…/tu-guia.pdf` |

> ⚠️ Los enlaces de la tabla son **ejemplos del formato** — no son reales y por eso no
> abren nada. Reemplázalos por tus propios links en tu Google Sheet.

El sistema saca la **palabra** del CTA y el **link** de `Recurso_DM`. Agregas filas = agregas campañas.

## Stack

Node.js + TypeScript · Express · Zod · Pino · Google Sheets (CSV) · Postgres opcional (`pg`). Deploy en Render (Docker).

## Arranque rápido

```bash
npm install
cp .env.example .env      # rellena los valores (ver docs/SETUP_META.md)
npm run dev               # servidor en http://localhost:3000
npm test                  # tests
npm run typecheck
```

### Probar sin credenciales (DRY_RUN)

Con `DRY_RUN=true`, el server simula la API de Meta (loguea en vez de llamar):

```bash
node execution/simulate_webhook.mjs comment "quiero AUTOMATIZA"   # comment-to-DM
node execution/simulate_webhook.mjs follow-check default          # botón "ya te sigo"
```

## Documentación

- [`docs/SETUP_META.md`](docs/SETUP_META.md) — crear la app Meta, token, webhook.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy a Render (URL fija).
- [`docs/RESOURCES_SHEET.md`](docs/RESOURCES_SHEET.md) — la Google Sheet de recursos.
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md) — estado de cada integración.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md)

## Roadmap

Adaptador Facebook · broadcast a ventanas abiertas · dashboard de gestión.

## Licencia

MIT — ver [`LICENSE`](LICENSE).

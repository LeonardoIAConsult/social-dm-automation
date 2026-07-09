# Setup Meta / Instagram — paso a paso

Objetivo: conectar tu Instagram directo a la API de Meta para que este sistema reciba webhooks y envíe DMs. Sin intermediarios (ManyChat, etc.).

## Requisitos previos
1. **Cuenta de Instagram profesional** (Business o Creator). En la app: Configuración → Cuenta → Cambiar a cuenta profesional.
2. Cuenta de desarrollador en https://developers.facebook.com.
3. Un servidor con **URL pública HTTPS** para el webhook (en desarrollo, usa `ngrok`, `cloudflared` o similar).

## Paso 1 — Crear la app
1. https://developers.facebook.com/apps → **Crear app**.
2. Tipo de app: **Business**.
3. En el panel de la app, agrega el producto **Instagram** → **Instagram API con Instagram Login** (o "Messaging API").

## Paso 2 — Obtener los valores del `.env`
Copia `.env.example` a `.env` y rellena:

| Variable | Dónde sacarla |
|---|---|
| `META_APP_SECRET` | App Settings → Basic → **App Secret** |
| `META_WEBHOOK_VERIFY_TOKEN` | Lo **inventas tú** (cadena secreta larga). Debe coincidir con el que pongas en el panel al configurar el webhook. |
| `IG_ACCESS_TOKEN` | Token de acceso de larga duración de la cuenta IG con permiso `instagram_business_manage_messages`. Se genera en el flujo de Instagram Login / Graph API Explorer. |
| `IG_BUSINESS_ACCOUNT_ID` | ID de tu cuenta profesional de Instagram. |

## Paso 3 — Configurar el webhook
1. En la app → **Webhooks** (o dentro del producto Instagram → Configuration).
2. **Callback URL**: `https://TU-DOMINIO/webhooks/instagram`
3. **Verify Token**: el mismo valor de `META_WEBHOOK_VERIFY_TOKEN`.
4. Meta hará un GET de verificación; el server responde el `hub.challenge` automáticamente.
5. **Suscríbete a los campos**: `messages`, `messaging_postbacks`, `comments` (y `message_reactions` si quieres).

## Paso 4 — Permisos y App Review
Para operar con usuarios reales (no solo testers) necesitas **Advanced Access** al permiso:
- `instagram_business_manage_messages`

Esto pasa por **App Review** de Meta (puede tardar días). Mientras tanto, agrega tu propia cuenta como **tester** (App Roles → Roles) para probar en modo desarrollo.

## Paso 5 — Probar
```bash
npm install
cp .env.example .env   # y rellena valores
npm run dev
```
Expón el puerto con ngrok:
```bash
ngrok http 3000
```
Usa la URL https de ngrok como Callback URL. Comenta la keyword de tu campaña en un post de prueba y observa los logs.

## Notas
- El campo `is_user_follow_business` (follow-gate) llega al consultar el perfil del usuario dentro de una conversación. Verifica su disponibilidad exacta en las docs oficiales según tu versión de API.
- Guarda el `IG_ACCESS_TOKEN` de larga duración y renuévalo antes de que expire.

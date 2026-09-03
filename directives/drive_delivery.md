# Directiva: Entrega de documentos desde Google Drive por fecha del post

## Objetivo
Enviar en el DM el documento (PDF, etc.) que corresponde al post donde comentó la persona,
sacándolo de una carpeta de Google Drive marcada con la fecha de ese post.

## Cómo funciona (runtime)
1. Llega un comentario en un post → se guarda su `mediaId` en el estado de la conversación.
2. Al pasar el follow-gate y entregar, si la campaña tiene `driveDelivery.enabled`:
   - Se obtiene la fecha de publicación del post (`getMediaTimestamp` → `YYYY-MM-DD`).
   - Se busca en Drive la subcarpeta cuyo nombre contiene esa fecha.
   - Se toma el archivo más reciente de esa subcarpeta.
   - Se asegura permiso "cualquiera con el link (lector)" y se envía el link en el DM.

## Herramientas (Capa 3)
- `src/integrations/googleDrive.ts` → `resolveLinkByDate(date)`, `toDateFolderName(epoch)`.
- `src/platforms/instagram/client.ts` → `getMediaTimestamp(mediaId)`.
- Campaña con `driveDelivery: { enabled: true, prependText? }` en `campaigns.ts`.

## Convención de Drive (lo que TÚ mantienes)
- Una carpeta raíz (`GDRIVE_ROOT_FOLDER_ID`) con una subcarpeta por post/fecha.
- El nombre de cada subcarpeta debe **contener la fecha en formato YYYY-MM-DD**.
  Ej: `2026-07-09 - Carrusel Guía`. Dentro va el PDF.
- Comparte la carpeta raíz con el **email de la cuenta de servicio** (permiso lector).

## Setup de credenciales (una vez)
1. Google Cloud Console → crea proyecto → habilita **Google Drive API**.
2. Crea una **cuenta de servicio** → genera clave JSON → guárdala como `credentials.json`
   en la raíz del proyecto (está en `.gitignore`).
3. Copia el email de la cuenta de servicio y **comparte** con él tu carpeta raíz de Drive.
4. En `.env`: `GDRIVE_ENABLED=true`, `GDRIVE_ROOT_FOLDER_ID=<id de la carpeta raíz>`,
   `GOOGLE_APPLICATION_CREDENTIALS=credentials.json`.

## Prueba sin credenciales
Con `DRY_RUN=true`, `resolveLinkByDate` devuelve `SIM_DRIVE_LINK` y puedes ver todo el flujo
con `execution/simulate_webhook.mjs`.

## Casos extremos / gotchas
- Si no existe carpeta para la fecha, o está vacía → se omite la entrega Drive (se loguea) y
  se envían igual los mensajes `deliver` normales de la campaña.
- El `mediaId` solo viene en comentarios; por eso se guarda en el estado para que la entrega
  funcione aunque el usuario continúe por el botón "ya te sigo" (postback sin mediaId).
- La fecha usa la zona horaria del server. Si tu Drive usa otra fecha, ajusta `toDateFolderName`.

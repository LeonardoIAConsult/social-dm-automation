# Hoja de recursos (Google Sheet → palabra → link)

Aquí defines, **sin tocar código ni redeploy**, qué link/documento envía el sistema
por cada palabra. Editas la hoja en el navegador y el sistema la relee sola (~1 min).

## 1. Crea la hoja
Nueva Google Sheet con **3 columnas** (fila de encabezado exactamente así):

| palabra | link | mensaje |
|---|---|---|
| GUIA | https://drive.google.com/....../guia.pdf | ¡Listo! Aquí tienes tu guía 🎁 |
| AUTOMATIZA | https://tusitio.com/articulo | Aquí está el artículo 👇 |
| VER MAS | https://youtu.be/xxxx | Míralo aquí 🎥 |

- **palabra**: lo que la gente comenta (y lo que pones en el copy del post como CTA).
  Puedes tener **muchas** filas. No importan tildes/mayúsculas: "guía", "GUIA", "Guia" = igual.
- **link**: cualquier URL — PDF de Drive, artículo de tu web, video de YouTube.
  (Para Drive: botón Compartir → "Cualquiera con el enlace" → copia el link.)
- **mensaje** (opcional): texto que acompaña al link.

## 2. Publica la hoja como CSV
1. En la hoja: **Archivo → Compartir → Publicar en la web**.
2. Pestaña **Enlace** → elige la **hoja** (no "documento completo" si tienes varias) →
   formato **valores separados por comas (.csv)**.
3. **Publicar** → copia la URL (termina en `output=csv`).

## 3. Conéctala al sistema
En **Render** → tu servicio → **Environment** → agrega:
```
RESOURCES_SHEET_CSV_URL = (la URL que copiaste)
```
Guarda. Render reinicia y ya lee tu hoja.

## Cómo funciona
- Alguien comenta una palabra que está en la hoja (en cualquier post) → el sistema le
  manda el DM con el botón → al tocarlo, verifica follow y entrega **ese** link.
- Agregas/editas filas en la hoja → cambios activos en ~1 minuto, sin redeploy.

## Notas
- La hoja publicada es accesible por su URL (rara/obscura). Los links solo se envían por DM.
  Si quieres privacidad total, se puede leer con cuenta de servicio (ver equipo).
- Si una palabra comentada no está en la hoja, no se entrega nada (se ignora).
- El match es por palabra completa: "guía" dispara, "guiado" no.

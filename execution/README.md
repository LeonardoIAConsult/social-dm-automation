# execution/ — Capa 3 (utilidades offline)

En este proyecto la **ejecución determinista del producto vive en `src/`** (TypeScript),
porque es un servidor Node de webhooks en vivo. Ver `AGENTS.md`.

Esta carpeta queda reservada para **utilidades standalone offline** (p. ej. scripts Python
puntuales: generación de dossiers, migraciones de datos, análisis one-off). Hoy está vacía.

Regla: cualquier salida debe ser reproducible re-ejecutando el script; los intermedios van a
`.tmp/`, nunca al repo.

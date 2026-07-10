import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalize, matchesKeyword } from './textMatch.js';

/**
 * Recursos a entregar por palabra clave.
 *
 * Fuente: una Google Sheet publicada como CSV (env RESOURCES_SHEET_CSV_URL).
 * Columnas esperadas (por nombre en la fila de encabezado, en cualquier orden):
 *   - palabra | keyword | clave     -> la palabra que activa el envio
 *   - link | url | enlace           -> el recurso (Drive, web, YouTube, lo que sea)
 *   - mensaje | message | texto     -> texto opcional que acompana al link
 *
 * Editas la hoja en el navegador y el sistema la relee sola (cache corto). No
 * hace falta tocar codigo ni redeploy. Si no hay URL configurada, usa la tabla
 * de respaldo de abajo.
 */
export interface ResourceItem {
  text?: string;
  url: string;
}

/** Respaldo local si no hay hoja configurada (edita o deja como ejemplo). */
const fallbackTable: Record<string, ResourceItem> = {
  guia: { text: '¡Listo! Aquí tienes tu guía 🎁', url: 'https://tu-dominio.com/guia.pdf' },
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { at: number; map: Record<string, ResourceItem> } | null = null;

/** Busca el recurso mapeado a una palabra clave (tolerante a tildes/mayusculas). */
export async function getResource(keyword: string | null | undefined): Promise<ResourceItem | undefined> {
  if (!keyword) return undefined;
  const map = await loadMap();
  return map[normalize(keyword)];
}

/**
 * Devuelve la palabra de la hoja que hace match con el texto (comentario/DM),
 * tolerante a tildes/mayus/signos. undefined si ninguna palabra de la hoja aparece.
 */
export async function findMatchingKeyword(
  text: string | null | undefined,
): Promise<string | undefined> {
  if (!text) return undefined;
  const map = await loadMap();
  return Object.keys(map).find((key) => matchesKeyword(text, key));
}

async function loadMap(): Promise<Record<string, ResourceItem>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.map;

  if (!env.RESOURCES_SHEET_CSV_URL) {
    cache = { at: now, map: fallbackTable };
    return fallbackTable;
  }

  try {
    const res = await fetch(env.RESOURCES_SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = parseSheet(await res.text());
    cache = { at: now, map };
    logger.info({ entries: Object.keys(map).length }, 'Hoja de recursos cargada');
    return map;
  } catch (err) {
    logger.error({ err }, 'No se pudo leer la hoja de recursos; uso respaldo/cache');
    // Si ya habia cache, seguimos con ella; si no, respaldo local.
    return cache?.map ?? fallbackTable;
  }
}

/** Convierte el CSV de la hoja en el mapa normalizado palabra -> recurso. */
function parseSheet(csv: string): Record<string, ResourceItem> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return {};

  const header = rows[0]!.map((h) => normalize(h));
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  let kw = idx(['palabra', 'keyword', 'clave', 'palabra clave']);
  let url = idx(['link', 'url', 'enlace']);
  let txt = idx(['mensaje', 'message', 'texto', 'text']);
  // Si no hay encabezados reconocibles, asume orden palabra, link, mensaje.
  if (kw === -1) kw = 0;
  if (url === -1) url = 1;

  const map: Record<string, ResourceItem> = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const key = normalize(row[kw] ?? '');
    const link = (row[url] ?? '').trim();
    if (!key || !link) continue;
    const message = txt >= 0 ? (row[txt] ?? '').trim() : '';
    map[key] = { url: link, ...(message ? { text: message } : {}) };
  }
  return map;
}

/** Parser CSV minimo (RFC4180: comillas, comas y saltos dentro de comillas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

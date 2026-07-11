import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalize, matchesKeyword } from './textMatch.js';
import { extractKeywordFromCaption } from './keywordExtractor.js';

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

/** Resultado de parsear la hoja: mapa palabra->recurso + recurso por defecto de DM. */
interface ParsedSheet {
  map: Record<string, ResourceItem>;
  /** Recurso para DMs sin palabra clave (fila con CTA "Escríbeme por DM"). */
  dmDefault?: ResourceItem;
}

/** Respaldo local si no hay hoja configurada (edita o deja como ejemplo). */
const fallback: ParsedSheet = {
  map: { guia: { text: '¡Listo! Aquí tienes tu guía 🎁', url: 'https://tu-dominio.com/guia.pdf' } },
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { at: number; data: ParsedSheet } | null = null;

/** Busca el recurso mapeado a una palabra clave (tolerante a tildes/mayusculas). */
export async function getResource(keyword: string | null | undefined): Promise<ResourceItem | undefined> {
  if (!keyword) return undefined;
  const { map } = await load();
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
  const { map } = await load();
  return Object.keys(map).find((key) => matchesKeyword(text, key));
}

/** Recurso por defecto para un DM sin palabra clave (ej. link de agenda/Calendar). */
export async function getDmDefault(): Promise<ResourceItem | undefined> {
  return (await load()).dmDefault;
}

async function load(): Promise<ParsedSheet> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;

  if (!env.RESOURCES_SHEET_CSV_URL) {
    cache = { at: now, data: fallback };
    return fallback;
  }

  try {
    const res = await fetch(env.RESOURCES_SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseSheet(await res.text());
    cache = { at: now, data };
    logger.info(
      { entries: Object.keys(data.map).length, dmDefault: Boolean(data.dmDefault) },
      'Hoja de recursos cargada',
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'No se pudo leer la hoja de recursos; uso respaldo/cache');
    return cache?.data ?? fallback;
  }
}

/**
 * Convierte el CSV de la hoja en el mapa palabra -> recurso.
 *
 * Soporta dos esquemas:
 *  A) Hoja simple:      columnas palabra | link | mensaje.
 *  B) Hoja de planeacion: columna CTA (ej. "Comenta AUTOMATIZA -> DM") de donde
 *     se EXTRAE la palabra, y una columna de link (Link_Asset_Drive / link).
 * Asi puedes usar tu misma hoja de contenido sin columnas extra.
 */
/** True si el CTA es un llamado a escribir por DM (sin palabra a comentar). */
function isDmCta(cta: string): boolean {
  return /\b(por dm|por mensaje|escribeme|escribime|mandame un dm|mandame dm)\b/.test(normalize(cta));
}

function parseSheet(csv: string): ParsedSheet {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { map: {} };

  const header = rows[0]!.map((h) => normalize(h));
  const findExact = (names: string[]) => header.findIndex((h) => names.includes(h));
  const findIncludes = (needle: string, exclude?: string) =>
    header.findIndex((h) => h.includes(needle) && (!exclude || !h.includes(exclude)));

  // Columna de palabra: limpia ('palabra'...) o CTA (frase de la que se extrae).
  const cleanKw = findExact(['palabra', 'keyword', 'clave', 'palabra clave']);
  const ctaKw = cleanKw === -1 ? findIncludes('cta') : -1;
  const kwCol = cleanKw !== -1 ? cleanKw : ctaKw;
  const kwIsPhrase = cleanKw === -1; // si viene de CTA, hay que extraer la palabra

  // Columna de link: prioriza 'Recurso_DM' (la que define Leonardo para el DM),
  // luego asset/drive, luego link/url/enlace (nunca 'Link_Publicado').
  let urlCol = findIncludes('recurso');
  if (urlCol === -1) urlCol = findIncludes('asset');
  if (urlCol === -1) urlCol = findIncludes('drive');
  if (urlCol === -1) urlCol = header.findIndex((h) => ['link', 'url', 'enlace'].includes(h));
  if (urlCol === -1) urlCol = findIncludes('link', 'publicado');

  const txtCol = findExact(['mensaje', 'message', 'texto', 'text']);

  // Respaldo: si no se reconoce nada, asume orden palabra, link, mensaje.
  const kw = kwCol !== -1 ? kwCol : 0;
  const url = urlCol !== -1 ? urlCol : 1;

  const map: Record<string, ResourceItem> = {};
  let dmDefault: ResourceItem | undefined;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rawKw = (row[kw] ?? '').trim();
    const link = (row[url] ?? '').trim();
    if (!rawKw || !link || !/^https?:\/\//i.test(link)) continue;

    const message = txtCol >= 0 ? (row[txtCol] ?? '').trim() : '';
    const item: ResourceItem = { url: link, ...(message ? { text: message } : {}) };

    const keyword = kwIsPhrase ? extractKeywordFromCaption(rawKw) : rawKw;
    const key = normalize(keyword ?? '');
    if (key) {
      map[key] = item;
    } else if (kwIsPhrase && !dmDefault && isDmCta(rawKw)) {
      // CTA "Escríbeme por DM" sin palabra -> recurso por defecto de los DMs.
      dmDefault = item;
    }
  }
  return { map, dmDefault };
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

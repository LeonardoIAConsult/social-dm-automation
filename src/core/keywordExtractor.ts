/**
 * Deriva la palabra clave de disparo a partir del copy de un post/carrusel/story.
 *
 * Convencion que asumimos (la mas usada en IG): el creador escribe algo como
 *   «Comenta "GUIA" y te la envío»  /  «escribe LIBRO en los comentarios»
 * La keyword suele ir entre comillas o en MAYÚSCULAS junto a un verbo de accion.
 *
 * Es un extractor determinista (regex), sin costo de API ni LLM. Si algun dia
 * el copy es ambiguo, aqui es donde se enchufaria un fallback con LLM.
 */

const ACTION_VERBS =
  '(?:comenta(?:me)?|comentá|escribe|escribí|escribeme|responde|manda|mandá|comment|type|reply|dm|write)';

// Palabras que nunca deben tomarse como keyword aunque vengan en mayúsculas.
const STOPWORDS = new Set([
  'LA', 'EL', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'EN', 'Y', 'O', 'PALABRA', 'ABAJO',
  'AQUI', 'AQUÍ', 'THE', 'WORD', 'BELOW', 'DM', 'LINK', 'BIO',
]);

function clean(token: string): string {
  return token.trim().toUpperCase().replace(/[.,!¡¿?"'«»“”:；;]+$/g, '');
}

/**
 * Extrae la keyword del caption. Devuelve la palabra en MAYÚSCULAS, o null.
 * Estrategia por prioridad:
 *   1. Token entre comillas cerca de un verbo de accion.
 *   2. Token en MAYÚSCULAS inmediatamente despues de un verbo de accion.
 *   3. Fallback: primer token en MAYÚSCULAS (>=3) que no sea stopword.
 */
export function extractKeywordFromCaption(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const text = caption.replace(/\s+/g, ' ');

  // 1. Verbo + token entrecomillado: comenta "GUIA"
  const quotedNearVerb = new RegExp(
    `${ACTION_VERBS}\\s+(?:la\\s+palabra\\s+|the\\s+word\\s+)?["'«“]\\s*([\\p{L}\\p{N}]{2,20})\\s*["'»”]`,
    'iu',
  );
  const m1 = quotedNearVerb.exec(text);
  if (m1?.[1]) {
    const kw = clean(m1[1]);
    if (!STOPWORDS.has(kw)) return kw;
  }

  // 2. Verbo + token en MAYÚSCULAS: escribe LIBRO
  const upperNearVerb = new RegExp(
    `${ACTION_VERBS}\\s+(?:la\\s+palabra\\s+|the\\s+word\\s+)?([\\p{Lu}\\p{N}]{2,20})\\b`,
    'u',
  );
  const m2 = upperNearVerb.exec(text);
  if (m2?.[1]) {
    const kw = clean(m2[1]);
    if (!STOPWORDS.has(kw)) return kw;
  }

  // 3. Fallback: cualquier palabra en MAYÚSCULAS relevante.
  const allCaps = text.match(/\b[\p{Lu}][\p{Lu}\p{N}]{2,19}\b/gu) ?? [];
  for (const raw of allCaps) {
    const kw = clean(raw);
    if (!STOPWORDS.has(kw)) return kw;
  }

  return null;
}

/**
 * Normalizacion y match robusto de texto para disparar campanas.
 *
 * Objetivo: que "GUIA", "guía", "Guia!", "quiero la guía porfa" o "ver mas 👀"
 * disparen igual. Ignora mayus/minus, tildes/diacriticos, signos y emojis, y
 * permite palabras extra alrededor.
 */

/** Baja a minusculas, quita tildes/diacriticos, deja solo letras/numeros/espacios. */
export function normalize(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD') // separa letra + diacritico
    .replace(/[̀-ͯ]/g, '') // elimina diacriticos (tildes, dieresis)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // signos/emojis -> espacio
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True si `text` contiene la `keyword` como palabra(s) completa(s), tolerante a
 * tildes, mayusculas, signos y palabras extra. Soporta keywords de varias
 * palabras (ej. "ver mas").
 */
export function matchesKeyword(text: string | null | undefined, keyword: string): boolean {
  const k = normalize(keyword);
  if (!k) return false;
  const t = normalize(text);
  if (!t) return false;
  // Limite de palabra sobre el texto normalizado para no matchear "guiado" con "guia".
  const re = new RegExp(`(^|\\s)${escapeRegExp(k)}(\\s|$)`);
  return re.test(t);
}

/** True si el texto contiene alguna de las keywords. */
export function matchesAnyKeyword(text: string | null | undefined, keywords: string[]): boolean {
  return keywords.some((k) => matchesKeyword(text, k));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { normalize } from './textMatch.js';

/**
 * Mapa palabra clave -> recurso a entregar.
 *
 * Esto es lo que editas para cada campana: la palabra que pones en el copy del
 * post/carrusel/reel, y el link/documento que el sistema envia cuando alguien
 * comenta esa palabra. Las claves se normalizan (sin tildes, minusculas), asi
 * que "GUIA", "guía" o "Guia" caen todas en la misma entrada.
 */
export interface ResourceItem {
  /** Mensaje que acompana al link (opcional). */
  text?: string;
  /** URL del recurso (link, PDF, formulario, etc.). */
  url: string;
}

const table: Record<string, ResourceItem> = {
  guia: {
    text: '¡Listo! Aquí tienes tu guía 🎁',
    url: 'https://tu-dominio.com/guia.pdf',
  },
  automatiza: {
    text: 'Aquí está tu recurso de automatización 🤖',
    url: 'https://tu-dominio.com/automatiza',
  },
  'ver mas': {
    text: 'Aquí tienes más info 👇',
    url: 'https://tu-dominio.com/ver-mas',
  },
};

/** Busca el recurso mapeado a una palabra clave (tolerante a tildes/mayusculas). */
export function getResource(keyword: string | null | undefined): ResourceItem | undefined {
  if (!keyword) return undefined;
  return table[normalize(keyword)];
}

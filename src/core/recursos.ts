import { getDmDefault, getResource, findMatchingKeyword } from './resources.js';
import { matchesKeyword } from './textMatch.js';
import type { PanelStore } from '../store/panelStore.js';

/**
 * De donde salen la palabra clave y el recurso que se entrega.
 *
 * Hay dos fuentes y conviven a proposito:
 *
 * - **El panel** (lo que el cliente edita desde su telefono).
 * - **La Google Sheet** (como funciona hoy, y sigue funcionando).
 *
 * Regla: si la cuenta tiene campanas en el panel, mandan las del panel. Si no
 * tiene ninguna, se lee la hoja exactamente como siempre. Nadie tiene que migrar
 * nada, y el dia que el cliente guarda su primera campana desde el panel, el
 * panel pasa a ser la fuente sin que se rompa el envio.
 */

/** Lo que hace falta para entregar: que palabra fue, que se manda y si exige seguir. */
export interface RecursoResuelto {
  /** Palabra tal como quedo registrada (para mostrarla y para el dedup). */
  palabra: string;
  url: string;
  texto?: string;
  /**
   * Si esta campana exige que la persona siga la cuenta. `undefined` = no opina,
   * y decide la campana del codigo (compat con lo de hoy).
   */
  exigirSeguir?: boolean;
}

export interface FuenteDeRecursos {
  /** Busca que palabra de esta cuenta aparece en el texto. */
  buscar(accountId: string, texto: string): Promise<RecursoResuelto | undefined>;
  /** Trae el recurso de una palabra ya detectada. */
  porPalabra(accountId: string, palabra: string): Promise<RecursoResuelto | undefined>;
  /** Recurso para un DM sin palabra clave (ej. link de agenda). */
  porDefecto(accountId: string): Promise<RecursoResuelto | undefined>;
  /** Que fuente esta mandando hoy para esta cuenta. Se muestra en el panel. */
  origen(accountId: string): Promise<'panel' | 'hoja'>;
}

/** La hoja de siempre, envuelta en la interfaz. Es el comportamiento actual. */
export class FuenteHoja implements FuenteDeRecursos {
  async buscar(_accountId: string, texto: string): Promise<RecursoResuelto | undefined> {
    const palabra = await findMatchingKeyword(texto);
    return palabra ? await this.porPalabra(_accountId, palabra) : undefined;
  }

  async porPalabra(_accountId: string, palabra: string): Promise<RecursoResuelto | undefined> {
    const res = await getResource(palabra);
    return res ? { palabra, url: res.url, texto: res.text } : undefined;
  }

  async porDefecto(_accountId: string): Promise<RecursoResuelto | undefined> {
    const res = await getDmDefault();
    return res ? { palabra: '__dm_default__', url: res.url, texto: res.text } : undefined;
  }

  async origen(): Promise<'panel' | 'hoja'> {
    return 'hoja';
  }
}

/**
 * El panel primero, la hoja de respaldo.
 *
 * Ojo con el orden: se pregunta al panel y SOLO si esa cuenta no tiene ninguna
 * campana se cae a la hoja. No se mezclan: si el cliente ya edito su campana en
 * el panel, una palabra vieja que quedo en la hoja no puede seguir respondiendo,
 * porque el cliente creeria que la borro y seguiria entregando.
 */
export class FuentePanelPrimero implements FuenteDeRecursos {
  constructor(
    private readonly panel: PanelStore,
    private readonly hoja: FuenteDeRecursos = new FuenteHoja(),
  ) {}

  private async mandaElPanel(accountId: string): Promise<boolean> {
    const suyas = await this.panel.campaignsOf(accountId);
    return suyas.length > 0;
  }

  async buscar(accountId: string, texto: string): Promise<RecursoResuelto | undefined> {
    if (!(await this.mandaElPanel(accountId))) return this.hoja.buscar(accountId, texto);
    for (const c of await this.panel.campaignsOf(accountId)) {
      if (contiene(texto, c.keywordNormalized)) {
        return {
          palabra: c.keyword,
          url: c.url,
          texto: c.message,
          exigirSeguir: c.requireFollow,
        };
      }
    }
    return undefined;
  }

  async porPalabra(accountId: string, palabra: string): Promise<RecursoResuelto | undefined> {
    if (!(await this.mandaElPanel(accountId))) return this.hoja.porPalabra(accountId, palabra);
    const c = await this.panel.campaignByKeyword(accountId, palabra);
    return c
      ? { palabra: c.keyword, url: c.url, texto: c.message, exigirSeguir: c.requireFollow }
      : undefined;
  }

  async porDefecto(accountId: string): Promise<RecursoResuelto | undefined> {
    // El recurso por defecto para DMs sin palabra vive solo en la hoja por ahora.
    return this.hoja.porDefecto(accountId);
  }

  async origen(accountId: string): Promise<'panel' | 'hoja'> {
    return (await this.mandaElPanel(accountId)) ? 'panel' : 'hoja';
  }
}

/**
 * ¿Aparece la palabra en el texto? Se apoya en la misma normalizacion que usa la
 * hoja, para que "guía", "GUIA" y "Guia!" sigan siendo la misma palabra.
 */
function contiene(texto: string, palabraNormalizada: string): boolean {
  return matchesKeyword(texto, palabraNormalizada);
}

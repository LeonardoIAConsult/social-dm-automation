import { logger } from '../utils/logger.js';

/**
 * Avisar al operador cuando la cuenta de un cliente deja de responder.
 *
 * Por que existe: el cliente no puede reconectar su Instagram solo. Si el
 * permiso se cierra, alguien tiene que enterarse HOY, no cuando el cliente note
 * que dejaron de llegarle mensajes. Ese "alguien" es Leonardo.
 *
 * Hoy el aviso queda en el log del servidor, que es lo unico honesto que se
 * puede prometer sin credenciales de correo configuradas. La interfaz existe
 * para que enchufar un correo real sea cambiar la implementacion, no el codigo
 * que avisa.
 */

export interface Aviso {
  accountId: string;
  asunto: string;
  detalle: string;
}

export interface Avisador {
  avisar(aviso: Aviso): Promise<void>;
}

/** Deja el aviso en el log, con nivel alto para que se vea. */
export class AvisadorPorLog implements Avisador {
  async avisar(aviso: Aviso): Promise<void> {
    logger.error(
      { account: aviso.accountId, asunto: aviso.asunto },
      `AVISO AL OPERADOR: ${aviso.detalle}`,
    );
  }
}

/**
 * Envuelve a otro avisador y no deja que el mismo aviso salga mas de una vez al
 * dia por cuenta. Sin esto, una cuenta caida escribe un aviso por cada visita al
 * panel y el que importa se pierde entre el ruido.
 */
export class AvisadorUnaVezAlDia implements Avisador {
  private readonly vistos = new Map<string, string>();

  constructor(private readonly interno: Avisador) {}

  async avisar(aviso: Aviso): Promise<void> {
    const hoy = new Date().toISOString().slice(0, 10);
    const clave = `${aviso.accountId}:${aviso.asunto}`;
    if (this.vistos.get(clave) === hoy) return;
    this.vistos.set(clave, hoy);
    await this.interno.avisar(aviso);
  }
}

/** No avisa. Es el default cuando nadie configuro nada. */
export const avisadorMudo: Avisador = {
  async avisar() {
    // Intencionalmente vacio.
  },
};

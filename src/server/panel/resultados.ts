import type { FunnelEventType, PanelStore } from '../../store/panelStore.js';

/**
 * Los numeros que lee el cliente y los pasos de la prueba en vivo.
 *
 * Regla de honestidad: se cuentan PERSONAS, no eventos. Si alguien comenta tres
 * veces sigue siendo una persona interesada, y decirle al cliente "3 comentaron"
 * cuando fue una sola le hace tomar malas decisiones sobre su negocio.
 */

export interface Resumen {
  comentaron: number;
  recibieron: number;
  noSeguian: number;
}

const DIA_MS = 24 * 60 * 60 * 1000;

async function personasPorTipo(
  panel: PanelStore,
  accountId: string,
  desde: number,
): Promise<Map<FunnelEventType, Set<string>>> {
  const porTipo = new Map<FunnelEventType, Set<string>>();
  for (const e of await panel.eventsSince(accountId, desde)) {
    const yaVistas = porTipo.get(e.type) ?? new Set<string>();
    yaVistas.add(e.platformUserId);
    porTipo.set(e.type, yaVistas);
  }
  return porTipo;
}

export async function resumenDe(
  panel: PanelStore,
  accountId: string,
  dias: number,
  ahora = Date.now(),
): Promise<Resumen> {
  const porTipo = await personasPorTipo(panel, accountId, ahora - dias * DIA_MS);
  const cuantas = (tipo: FunnelEventType) => porTipo.get(tipo)?.size ?? 0;
  return {
    comentaron: cuantas('comment_detected'),
    recibieron: cuantas('resource_delivered'),
    noSeguian: cuantas('blocked_not_following'),
  };
}

// ── Prueba en vivo ─────────────────────────────────────────────────────────

/** Cuanto dura la ventana de prueba. Suficiente para ir al otro telefono y volver. */
export const DURACION_DE_LA_PRUEBA_MS = 10 * 60 * 1000;

export interface PasoDeLaPrueba {
  nombre: string;
  hecho: boolean;
  hora?: Date;
}

/** El orden real del flujo. Es lo que el cliente ve pintarse. */
const PASOS: Array<{ tipo: FunnelEventType; nombre: string }> = [
  { tipo: 'comment_detected', nombre: 'Detectamos tu comentario' },
  { tipo: 'dm_sent', nombre: 'Le enviamos el mensaje' },
  { tipo: 'button_tapped', nombre: 'Tocó el botón' },
  { tipo: 'follow_verified', nombre: 'Verificamos que te sigue' },
  { tipo: 'resource_delivered', nombre: 'Recibió tu recurso' },
];

export interface EstadoDeLaPrueba {
  pasos: PasoDeLaPrueba[];
  /** Se acabo el tiempo sin que pasara nada. */
  vencida: boolean;
  /** Llego hasta el final. */
  completa: boolean;
  /** Alguien no seguia la cuenta y por eso se freno. */
  frenadaPorSeguir: boolean;
  segundosRestantes: number;
}

export async function estadoDeLaPrueba(
  panel: PanelStore,
  accountId: string,
  desde: number,
  ahora = Date.now(),
): Promise<EstadoDeLaPrueba> {
  const eventos = await panel.eventsSince(accountId, desde);
  const primeroDe = (tipo: FunnelEventType) => eventos.find((e) => e.type === tipo);

  const pasos = PASOS.map(({ tipo, nombre }) => {
    const e = primeroDe(tipo);
    return { nombre, hecho: Boolean(e), hora: e ? new Date(e.at) : undefined };
  });

  const restante = Math.max(0, desde + DURACION_DE_LA_PRUEBA_MS - ahora);
  const huboAlgo = pasos.some((p) => p.hecho);
  return {
    pasos,
    vencida: restante === 0 && !huboAlgo,
    completa: Boolean(primeroDe('resource_delivered')),
    frenadaPorSeguir: Boolean(primeroDe('blocked_not_following')),
    segundosRestantes: Math.ceil(restante / 1000),
  };
}

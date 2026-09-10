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

  // Quien se freno por no seguir y DESPUES siguio y recibio, no es una perdida:
  // es una conversion. Contarlo como perdido le haria creer al cliente que dejo
  // ir gente que en realidad atendio.
  const recibieron = porTipo.get('resource_delivered') ?? new Set<string>();
  const frenados = porTipo.get('blocked_not_following') ?? new Set<string>();
  let siguenEsperando = 0;
  for (const persona of frenados) {
    if (!recibieron.has(persona)) siguenEsperando++;
  }

  return {
    comentaron: cuantas('comment_detected'),
    recibieron: recibieron.size,
    noSeguian: siguenEsperando,
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
  /** Se acabo el tiempo. */
  vencida: boolean;
  /** Hubo actividad, pero se acabo el tiempo antes de terminar. */
  incompleta: boolean;
  /**
   * La persona de la prueba ya habia recibido el recurso antes, asi que el motor
   * no se lo vuelve a mandar. No es un fallo: es la proteccion anti-spam.
   */
  yaLoTenia: boolean;
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
  const todos = await panel.eventsSince(accountId, desde);

  // La prueba sigue a UNA persona: la primera que comento dentro de la ventana.
  // Sin esto, un seguidor real que comente mientras el cliente prueba encenderia
  // los pasos y la pantalla diria "funciono" aunque al telefono del cliente no
  // le haya llegado nada.
  const primerComentario = todos.find((e) => e.type === 'comment_detected');
  const laPersona = primerComentario?.platformUserId;
  const eventos = laPersona ? todos.filter((e) => e.platformUserId === laPersona) : todos;

  const primeroDe = (tipo: FunnelEventType) => eventos.find((e) => e.type === tipo);
  const pasos = PASOS.map(({ tipo, nombre }) => {
    const e = primeroDe(tipo);
    return { nombre, hecho: Boolean(e), hora: e ? new Date(e.at) : undefined };
  });

  // Ventana FIJA: empieza en `desde` y dura lo que dura. Antes se recalculaba
  // contra "ahora", asi que se deslizaba y los pasos ya encendidos se apagaban
  // solos, y la pantalla acababa negando un comentario que el cliente vio.
  const restante = Math.max(0, desde + DURACION_DE_LA_PRUEBA_MS - ahora);
  const completa = Boolean(primeroDe('resource_delivered'));
  const huboAlgo = pasos.some((p) => p.hecho);

  // Comento y le mandamos el DM, toco el boton... y no hubo entrega ni bloqueo.
  // Casi siempre es que esa misma persona ya lo habia recibido antes.
  const yaLoTenia =
    Boolean(primeroDe('button_tapped')) && !completa && !primeroDe('blocked_not_following');

  return {
    pasos,
    vencida: restante === 0 && !completa,
    incompleta: restante === 0 && huboAlgo && !completa,
    yaLoTenia,
    completa,
    frenadaPorSeguir: Boolean(primeroDe('blocked_not_following')),
    segundosRestantes: Math.ceil(restante / 1000),
  };
}

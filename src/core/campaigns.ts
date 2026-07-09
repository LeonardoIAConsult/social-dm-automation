import type { IncomingEventType, OutgoingMessage } from './types.js';

/**
 * Una campana = un disparador + un follow-gate opcional + el valor a entregar.
 *
 * Editar este archivo es como el usuario define su automatizacion. No hace
 * falta tocar el engine. Ejemplo tipico: "comenta LIBRO en mi reel y te mando
 * el PDF, pero solo si me sigues".
 */
export interface Campaign {
  /** Identificador unico y estable de la campana. */
  name: string;

  /** Como se dispara. */
  trigger: {
    /** Palabras clave (case-insensitive, match por inclusion). Vacio = cualquiera. */
    keywords: string[];
    /** Tipos de evento que la activan. */
    eventTypes: IncomingEventType[];
    /** Si se fija, la campana solo aplica a comentarios de este media/post. */
    mediaId?: string;
  };

  /** Si true, exige seguir la cuenta antes de entregar el valor. */
  requireFollow: boolean;

  /** Textos y contenido de la campana. */
  copy: {
    /** Respuesta publica al comentario (opcional). No revela el valor. */
    publicReply?: string;
    /** Primer DM al abrir el flujo. */
    welcome?: string;
    /** DM cuando la persona NO sigue todavia. */
    askToFollow: string;
    /** Texto del boton para reintentar tras seguir. */
    followedButtonTitle: string;
    /** DM si la persona pulsa "ya te sigo" pero aun no sigue. */
    stillNotFollowing: string;
  };

  /** Lo que se entrega cuando el gate pasa (link, PDF, texto, etc.). */
  deliver: OutgoingMessage[];
}

/**
 * Campanas activas. Edita/agrega las tuyas aqui.
 * Este arreglo es lo unico que la mayoria de usuarios necesita tocar.
 */
export const campaigns: Campaign[] = [
  {
    name: 'freebie-guia',
    trigger: {
      keywords: ['GUIA', 'GUÍA', 'QUIERO'],
      eventTypes: ['comment', 'message'],
    },
    requireFollow: true,
    copy: {
      publicReply: '¡Te lo mando por DM! 📩',
      welcome: '¡Hola! Vi que quieres la guía 🙌',
      askToFollow:
        'Para enviártela solo necesito que me sigas (así apoyas el contenido gratis). ' +
        'Cuando ya me sigas, toca el botón de abajo 👇',
      followedButtonTitle: 'Ya te sigo ✅',
      stillNotFollowing:
        'Todavía no veo que me sigas 🤔. Dale seguir y vuelve a tocar el botón, ¡y te la mando al instante!',
    },
    deliver: [
      { kind: 'text', text: '¡Listo! Aquí está tu guía 🎁' },
      { kind: 'text', text: 'https://tu-dominio.com/guia.pdf' },
    ],
  },
];

/** Devuelve la campana que hace match con el texto del evento, o undefined. */
export function matchCampaign(
  eventType: IncomingEventType,
  text: string | undefined,
  mediaId: string | undefined,
): Campaign | undefined {
  const haystack = (text ?? '').toUpperCase();
  return campaigns.find((c) => {
    if (!c.trigger.eventTypes.includes(eventType)) return false;
    if (c.trigger.mediaId && c.trigger.mediaId !== mediaId) return false;
    if (c.trigger.keywords.length === 0) return true;
    return c.trigger.keywords.some((k) => haystack.includes(k.toUpperCase()));
  });
}

export function getCampaign(name: string): Campaign | undefined {
  return campaigns.find((c) => c.name === name);
}

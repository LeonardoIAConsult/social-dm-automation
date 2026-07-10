import type { IncomingEventType, OutgoingMessage } from './types.js';
import { matchesAnyKeyword } from './textMatch.js';

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
    /**
     * Modo de la keyword:
     *  - 'keywords': usas la lista `keywords` de abajo (control manual).
     *  - 'caption' : el sistema deriva la keyword del copy del post/story en
     *                tiempo real (ver keywordExtractor). No hace falta registrar
     *                nada por post; funciona en cualquier publicacion.
     * Default: 'keywords'.
     */
    mode?: 'keywords' | 'caption';
    /** Palabras clave (case-insensitive, match por inclusion). Solo en modo 'keywords'. */
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
    /** Primer DM al abrir el flujo (se envia junto al boton "Obtener el enlace"). */
    welcome?: string;
    /** Texto del boton que la persona toca para recibir el valor (abre la ventana). */
    getLinkButtonTitle: string;
    /** DM cuando la persona NO sigue todavia. */
    askToFollow: string;
    /** Texto del boton para reintentar tras seguir. */
    followedButtonTitle: string;
    /** DM si la persona pulsa "ya te sigo" pero aun no sigue. */
    stillNotFollowing: string;
  };

  /** Lo que se entrega cuando el gate pasa (link, PDF, texto, etc.). */
  deliver: OutgoingMessage[];

  /**
   * Entrega adicional desde Google Drive, resuelta por la FECHA del post donde
   * comentaron: manda el link del documento de la carpeta con esa fecha.
   * Requiere GDRIVE_ENABLED y un evento con mediaId (comentario). Ver
   * directives/drive_delivery.md.
   */
  driveDelivery?: {
    enabled: boolean;
    /** Texto opcional que precede al link del documento. */
    prependText?: string;
  };
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
      welcome:
        '¡Hola! Estoy muy feliz de que estés aquí, muchas gracias por tu interés 😊\n\n' +
        'Haz clic abajo y te enviaré el enlace en un momento ✨',
      getLinkButtonTitle: 'Obtener el enlace',
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

  // Campana auto-copy: NO registras keyword por post. El sistema lee el caption
  // del reel/carrusel donde comentaron (ej. «Comenta "PLANTILLA" y te la mando»)
  // y dispara si el comentario contiene esa palabra derivada del copy.
  {
    name: 'auto-copy',
    trigger: {
      mode: 'caption',
      keywords: [], // se ignoran en modo caption; se derivan del post
      eventTypes: ['comment'],
    },
    requireFollow: true,
    copy: {
      publicReply: '¡Te lo mando por DM! 📩',
      welcome:
        '¡Hola! Estoy muy feliz de que estés aquí, muchas gracias por tu interés 😊\n\n' +
        'Haz clic abajo y te enviaré el enlace en un momento ✨',
      getLinkButtonTitle: 'Obtener el enlace',
      askToFollow:
        'Para enviártelo solo necesito que me sigas. Cuando ya me sigas, toca el botón 👇',
      followedButtonTitle: 'Ya te sigo ✅',
      stillNotFollowing:
        'Aún no veo que me sigas 🤔. Dale seguir y vuelve a tocar el botón.',
    },
    // El documento se resuelve desde Drive por la fecha del post (no link fijo).
    deliver: [],
    driveDelivery: {
      enabled: true,
      prependText: '¡Listo! Aquí tienes el material del post 🎁',
    },
  },
];

/**
 * Devuelve la campana en modo 'keywords' que hace match con el texto, o undefined.
 * Las campanas en modo 'caption' NO se resuelven aqui (necesitan el caption del
 * post en runtime); las maneja el FlowEngine.
 */
export function matchCampaign(
  eventType: IncomingEventType,
  text: string | undefined,
  mediaId: string | undefined,
): Campaign | undefined {
  return campaigns.find((c) => {
    if ((c.trigger.mode ?? 'keywords') === 'caption') return false;
    if (!c.trigger.eventTypes.includes(eventType)) return false;
    if (c.trigger.mediaId && c.trigger.mediaId !== mediaId) return false;
    if (c.trigger.keywords.length === 0) return true;
    return matchesAnyKeyword(text, c.trigger.keywords);
  });
}

/** Campanas en modo 'caption' aplicables a un tipo de evento. */
export function captionCampaigns(
  eventType: IncomingEventType,
  mediaId: string | undefined,
): Campaign[] {
  return campaigns.filter((c) => {
    if (c.trigger.mode !== 'caption') return false;
    if (!c.trigger.eventTypes.includes(eventType)) return false;
    if (c.trigger.mediaId && c.trigger.mediaId !== mediaId) return false;
    return true;
  });
}

export function getCampaign(name: string): Campaign | undefined {
  return campaigns.find((c) => c.name === name);
}

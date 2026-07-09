/**
 * Tipos agnosticos de plataforma.
 *
 * Cada adaptador (Instagram, Facebook, ...) traduce los webhooks crudos de su
 * red a estos eventos normalizados, y el engine trabaja SOLO con estos tipos.
 * Asi el nucleo no sabe nada de la forma especifica de la API de Meta.
 */

export type Platform = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';

/** Un usuario tal como lo identifica la plataforma dentro de una conversacion. */
export interface PlatformUser {
  /** ID scoped a la conversacion (IGSID en Instagram). */
  id: string;
  username?: string;
}

/** Tipos de disparadores que abren o continuan un flujo. */
export type IncomingEventType =
  | 'message' // DM entrante (texto)
  | 'comment' // comentario en un post/reel
  | 'story_reply' // respuesta a una story
  | 'postback'; // click en un boton/CTA con payload

export interface IncomingEvent {
  platform: Platform;
  type: IncomingEventType;
  /** Quien disparo el evento. */
  user: PlatformUser;
  /** Texto del mensaje/comentario, si aplica. */
  text?: string;
  /** Payload de un postback/quick-reply, si aplica. */
  payload?: string;
  /** ID del comentario (para poder responder al comentario en si). */
  commentId?: string;
  /** ID del media (post/reel) donde ocurrio el comentario. */
  mediaId?: string;
  /** Epoch ms del evento segun la plataforma. */
  timestamp: number;
  /** Objeto crudo original, por si un flujo necesita algo especifico. */
  raw?: unknown;
}

/** Un mensaje saliente que un flujo pide enviar. Lo materializa el adaptador. */
export type OutgoingMessage =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; text?: string }
  | { kind: 'buttons'; text: string; buttons: OutgoingButton[] }
  | { kind: 'private_reply'; commentId: string; text: string };

export interface OutgoingButton {
  title: string;
  /** payload que volvera como IncomingEvent de tipo 'postback'. */
  payload: string;
}

/**
 * Contrato que cada red social debe implementar. El engine depende solo de
 * esta interfaz, nunca de la API concreta.
 */
export interface PlatformAdapter {
  readonly platform: Platform;

  /** Verifica la firma del webhook (HMAC). Lanza si es invalida. */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): void;

  /** Traduce el payload crudo del webhook a 0..N eventos normalizados. */
  parseWebhook(body: unknown): IncomingEvent[];

  /** Envia un mensaje a un usuario dentro de la ventana de mensajeria permitida. */
  sendMessage(userId: string, message: OutgoingMessage): Promise<void>;

  /**
   * Indica si `userId` sigue a la cuenta del negocio.
   * En Instagram se resuelve con el campo is_user_follow_business.
   * Devuelve null si la plataforma no puede determinarlo.
   */
  isFollower(userId: string): Promise<boolean | null>;

  /**
   * Devuelve el texto (caption) de un post/reel para derivar keywords del copy.
   * Opcional: no todas las plataformas lo exponen. null si no se pudo obtener.
   */
  getMediaCaption?(mediaId: string): Promise<string | null>;

  /**
   * Epoch ms de publicacion de un post/reel. Se usa para resolver el documento
   * de Drive por la fecha del post. null si no se pudo obtener.
   */
  getMediaTimestamp?(mediaId: string): Promise<number | null>;
}

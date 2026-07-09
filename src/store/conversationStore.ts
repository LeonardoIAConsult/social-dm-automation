import type { Platform } from '../core/types.js';

/**
 * Estado por conversacion (usuario+plataforma).
 *
 * Implementacion in-memory para el MVP. La interfaz esta pensada para
 * cambiarla por Redis/Postgres sin tocar el engine: solo reimplementa
 * ConversationStore y pasa otra instancia.
 */
export interface ConversationState {
  platform: Platform;
  userId: string;
  /** Nombre del flujo activo, si el usuario esta en medio de uno. */
  activeFlow?: string;
  /** Paso actual dentro del flujo. */
  step?: string;
  /** Epoch ms de la ultima interaccion del usuario (abre/renueva ventana 24h). */
  lastUserInteractionAt: number;
  /** Cache de follow status para no llamar a la API en cada paso. */
  followCache?: { isFollower: boolean; checkedAt: number };
  /** Datos arbitrarios que el flujo quiera recordar. */
  data: Record<string, unknown>;
}

export interface ConversationStore {
  get(platform: Platform, userId: string): Promise<ConversationState | undefined>;
  upsert(state: ConversationState): Promise<void>;
}

function key(platform: Platform, userId: string): string {
  return `${platform}:${userId}`;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly map = new Map<string, ConversationState>();

  async get(platform: Platform, userId: string): Promise<ConversationState | undefined> {
    return this.map.get(key(platform, userId));
  }

  async upsert(state: ConversationState): Promise<void> {
    this.map.set(key(state.platform, state.userId), state);
  }
}

/** Ventana de mensajeria estandar de Meta: 24h desde la ultima interaccion del usuario. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinMessagingWindow(state: ConversationState, now = Date.now()): boolean {
  return now - state.lastUserInteractionAt < MESSAGING_WINDOW_MS;
}

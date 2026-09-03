import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_ACCOUNT_ID } from '../core/account.js';
import type { Platform } from '../core/types.js';

/**
 * Estado por conversacion (usuario+plataforma).
 *
 * Implementacion in-memory para el MVP. La interfaz esta pensada para
 * cambiarla por Redis/Postgres sin tocar el engine: solo reimplementa
 * ConversationStore y pasa otra instancia.
 */
/** Un mensaje registrado en la conversacion, para la bandeja (/inbox). */
export interface ConversationMessage {
  /** 'in' = recibido del usuario; 'out' = enviado por la cuenta. */
  dir: 'in' | 'out';
  /** Tipo (comment, message, postback, private_reply, buttons, text, image...). */
  kind: string;
  /** Texto del mensaje, si aplica. */
  text?: string;
  /** Epoch ms. */
  at: number;
}

export interface ConversationState {
  /** Tenant dueno de la conversacion (SaaS multi-cuenta). Default 'default'. */
  accountId?: string;
  platform: Platform;
  userId: string;
  /** Username de la plataforma (si lo conocemos), para mostrar en la bandeja. */
  username?: string;
  /** Nombre del flujo activo, si el usuario esta en medio de uno. */
  activeFlow?: string;
  /** Paso actual dentro del flujo. */
  step?: string;
  /** Epoch ms de la ultima interaccion del usuario (abre/renueva ventana 24h). */
  lastUserInteractionAt: number;
  /** Cache de follow status para no llamar a la API en cada paso. */
  followCache?: { isFollower: boolean; checkedAt: number };
  /** Historial de mensajes (entrantes+salientes) para la bandeja /inbox. */
  messages: ConversationMessage[];
  /** Datos arbitrarios que el flujo quiera recordar. */
  data: Record<string, unknown>;
}

export interface ConversationStore {
  /** `accountId` scopea por tenant; omitirlo = tenant 'default' (compat single-account). */
  get(
    platform: Platform,
    userId: string,
    accountId?: string,
  ): Promise<ConversationState | undefined>;
  upsert(state: ConversationState): Promise<void>;
  /** Conversaciones de un tenant (para /inbox). Sin `accountId` = todas. */
  list(accountId?: string): Promise<ConversationState[]>;
}

function key(platform: Platform, userId: string, accountId = DEFAULT_ACCOUNT_ID): string {
  return `${accountId}:${platform}:${userId}`;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly map = new Map<string, ConversationState>();

  async get(
    platform: Platform,
    userId: string,
    accountId = DEFAULT_ACCOUNT_ID,
  ): Promise<ConversationState | undefined> {
    return this.map.get(key(platform, userId, accountId));
  }

  async upsert(state: ConversationState): Promise<void> {
    this.map.set(key(state.platform, state.userId, state.accountId), state);
  }

  async list(accountId?: string): Promise<ConversationState[]> {
    const all = [...this.map.values()];
    if (!accountId) return all;
    return all.filter((s) => (s.accountId ?? DEFAULT_ACCOUNT_ID) === accountId);
  }
}

/**
 * Store persistente en un archivo JSON local. Misma interfaz que el in-memory:
 * mantiene un Map en RAM para lecturas rapidas y vuelca a disco (escritura
 * atomica: tmp + rename) en cada upsert. Al arrancar, recarga el archivo si
 * existe — asi los flags 'delivered' y el historial de /inbox sobreviven un
 * reinicio, evitando re-enviar DMs ya entregados (riesgo de ban en Meta).
 *
 * Pensado para self-hosted single-tenant con disco persistente. Volumen de DMs
 * bajo -> un volcado por upsert es suficiente (sin cola ni debounce, YAGNI).
 */
export class FileConversationStore implements ConversationStore {
  private readonly map = new Map<string, ConversationState>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const states = JSON.parse(raw) as ConversationState[];
      for (const s of states) this.map.set(key(s.platform, s.userId, s.accountId), s);
    } catch (err) {
      // Archivo corrupto: no matamos el arranque; empezamos vacio y avisamos.
      // (No usamos el logger aqui para no crear dependencia circular con config.)
      console.error(`⚠️  No se pudo leer ${this.filePath}, empezando vacio:`, err);
      // Respaldamos el corrupto: el proximo upsert lo sobrescribiria y se perderia
      // todo el historial. Con .bak queda recuperable manualmente.
      try {
        renameSync(this.filePath, `${this.filePath}.bak-${Date.now()}`);
      } catch {
        // Si no se puede respaldar (permisos/carrera), seguimos sin bloquear.
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.map.values()]), 'utf8');
    renameSync(tmp, this.filePath); // rename atomico: nunca deja un JSON a medias
  }

  async get(
    platform: Platform,
    userId: string,
    accountId = DEFAULT_ACCOUNT_ID,
  ): Promise<ConversationState | undefined> {
    return this.map.get(key(platform, userId, accountId));
  }

  async upsert(state: ConversationState): Promise<void> {
    this.map.set(key(state.platform, state.userId, state.accountId), state);
    this.persist();
  }

  async list(accountId?: string): Promise<ConversationState[]> {
    const all = [...this.map.values()];
    if (!accountId) return all;
    return all.filter((s) => (s.accountId ?? DEFAULT_ACCOUNT_ID) === accountId);
  }
}

/**
 * Minimo que necesita el store de una conexion a Postgres (lo cumple el `Pool`
 * de `pg`). Se inyecta para poder testear sin una base real.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<{ state: ConversationState }> }>;
}

/**
 * Store en Postgres (Neon/Supabase). A diferencia del file store, el estado vive
 * FUERA del contenedor -> sobrevive reinicios/redeploys aunque el disco sea
 * efimero (caso Render Free). Es el backend indicado para blindar `/inbox`
 * durante la revision de Meta.
 *
 * Diseno minimo: una tabla `conversations` con la clave (account_id,platform,
 * user_id) — aislada por tenant — y el estado completo en una columna `jsonb`.
 * Sin ORM ni migraciones (YAGNI): `init()` crea la tabla si no existe. El volumen
 * es bajo -> un upsert por evento sobra.
 */
export class PostgresConversationStore implements ConversationStore {
  constructor(private readonly db: Queryable) {}

  /** Crea la tabla si no existe. Llamar UNA vez al arrancar, antes de servir. */
  async init(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS conversations (
         account_id text        NOT NULL DEFAULT 'default',
         platform   text        NOT NULL,
         user_id    text        NOT NULL,
         state      jsonb       NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (account_id, platform, user_id)
       )`,
    );
  }

  async get(
    platform: Platform,
    userId: string,
    accountId = DEFAULT_ACCOUNT_ID,
  ): Promise<ConversationState | undefined> {
    const { rows } = await this.db.query(
      'SELECT state FROM conversations WHERE account_id = $1 AND platform = $2 AND user_id = $3',
      [accountId, platform, userId],
    );
    return rows[0]?.state;
  }

  async upsert(state: ConversationState): Promise<void> {
    // El estado va como jsonb; ON CONFLICT hace el upsert por la PK (idempotente).
    await this.db.query(
      `INSERT INTO conversations (account_id, platform, user_id, state, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (account_id, platform, user_id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [state.accountId ?? DEFAULT_ACCOUNT_ID, state.platform, state.userId, JSON.stringify(state)],
    );
  }

  async list(accountId?: string): Promise<ConversationState[]> {
    // Cota dura: la bandeja /inbox no necesita todo el historico; las mas
    // recientes bastan y evita traer una tabla enorme de golpe. Filtra por tenant
    // si se pide (el $1 = NULL trae todas -> util para admin).
    const { rows } = await this.db.query(
      `SELECT state FROM conversations
       WHERE ($1::text IS NULL OR account_id = $1)
       ORDER BY updated_at DESC LIMIT 500`,
      [accountId ?? null],
    );
    return rows.map((r) => r.state);
  }
}

/** Ventana de mensajeria estandar de Meta: 24h desde la ultima interaccion del usuario. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinMessagingWindow(state: ConversationState, now = Date.now()): boolean {
  return now - state.lastUserInteractionAt < MESSAGING_WINDOW_MS;
}

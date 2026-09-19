import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { noopFunnelRecorder, type FunnelRecorder } from './funnel.js';
import type { FunnelEventType } from '../store/panelStore.js';
import {
  agregarMensaje,
  isWithinMessagingWindow,
  type ConversationMessage,
  type ConversationState,
  type ConversationStore,
} from '../store/conversationStore.js';
import {
  captionCampaigns,
  getCampaign,
  matchCampaign,
  sheetCampaigns,
  type Campaign,
} from './campaigns.js';
import { extractKeywordFromCaption } from './keywordExtractor.js';
import { matchesKeyword } from './textMatch.js';
import { NoopRateLimiter, type RateLimiter } from './rateLimiter.js';
import type { SendQueue } from './sendQueue.js';
import { DEFAULT_ACCOUNT_ID, type AccountRegistry } from './account.js';
import { FuenteHoja, type FuenteDeRecursos } from './recursos.js';
import { googleDrive, toDateFolderName } from '../integrations/googleDrive.js';
import type { IncomingEvent, PlatformAdapter } from './types.js';

/** Prefijo del payload del boton "Obtener el enlace" (abre la ventana de 24h). */
const GET_PREFIX = 'GET_LINK:';

/** Marca interna: entregar el recurso por defecto de DM (ej. Calendar). */
const DM_DEFAULT = '__dm_default__';

/** Prefijo del payload que reintenta el gate tras "ya te sigo". */
const CHECK_PREFIX = 'CHECK_FOLLOW:';

/** Cuanto confiar en el cache de follow antes de re-consultar la API. */
const FOLLOW_CACHE_TTL_MS = 60 * 1000;

/** Dia en formato AAAA-MM-DD, para acotar por dia las claves de dedup. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * El engine recibe eventos ya normalizados y decide que hacer:
 * hace match de campana, aplica el follow-gate y entrega el valor.
 * No sabe nada de Instagram; usa el PlatformAdapter.
 */
export class FlowEngine {
  /** Cache de keyword derivada por media, para no pedir el caption en cada comentario. */
  private readonly captionKeywordCache = new Map<string, string | null>();

  constructor(
    private readonly store: ConversationStore,
    private readonly adapters: Map<string, PlatformAdapter>,
    /** Backstop anti-ban: tope de envios por ventana. Noop = sin limite (tests/dry-run). */
    private readonly rateLimiter: RateLimiter = new NoopRateLimiter(),
    /** Cola de envios opcional (gap #2). Si se pasa, los envios se encolan con
     *  reintentos y requeue por rate-limit; el rate-limit lo aplica la cola.
     *  Si es undefined (default), el envio es sincrono como siempre. */
    private readonly sendQueue?: SendQueue,
    /** Tenant al que pertenecen las conversaciones de este engine (SaaS
     *  multi-cuenta). Default 'default' = single-account. El ruteo por-evento
     *  (resolver la cuenta segun el IG destinatario) es fase posterior. */
    private readonly accountId: string = DEFAULT_ACCOUNT_ID,
    /** Cuenta los pasos del embudo para el panel. Noop = no se cuenta nada. */
    private readonly funnel: FunnelRecorder = noopFunnelRecorder,
    /**
     * Resuelve a que cliente pertenece cada evento por el id de la cuenta de IG
     * que lo recibio. Sin registry (o con una sola cuenta) se usa `accountId`,
     * que es el comportamiento de siempre.
     */
    private readonly accounts?: AccountRegistry,
    /**
     * De donde salen palabra y recurso. Sin fuente, se lee la hoja como siempre:
     * inyectarla es lo que hace que el panel pueda mandar.
     */
    private readonly recursos: FuenteDeRecursos = new FuenteHoja(),
  ) {}

  /**
   * De quien es este evento.
   *
   * Con una sola cuenta configurada, siempre la misma: es el caso de hoy y no
   * cambia nada. Con VARIAS, se resuelve por el destinatario, y si no resuelve
   * se DESCARTA en vez de caer en la cuenta primaria: escribir el evento de un
   * cliente en la cuenta de otro es peor que perderlo.
   */
  private cuentaDelEvento(event: IncomingEvent): string | undefined {
    if (!this.accounts) return this.accountId;
    const todas = this.accounts.all();
    if (todas.length <= 1) return this.accountId;

    const dueno = event.recipientId ? this.accounts.byIgId(event.recipientId) : undefined;
    if (dueno) return dueno.id;
    logger.warn(
      { recipientId: event.recipientId, type: event.type },
      'Evento sin cuenta destinataria reconocible: se descarta para no mezclar clientes',
    );
    return undefined;
  }

  /**
   * Deja constancia de un paso del embudo. `dedupeKey` es la clave natural del
   * hecho: con ella, reenviar el mismo webhook no cuenta dos veces.
   */
  private async note(
    type: FunnelEventType,
    state: ConversationState,
    campaignName?: string,
    dedupeKey?: string,
  ): Promise<void> {
    const accountId = state.accountId ?? this.accountId;
    await this.funnel.record({
      accountId,
      campaignId: campaignName,
      platformUserId: state.userId,
      type,
      at: Date.now(),
      // La clave se scopea por cuenta siempre: ningun tenant puede pisar el
      // conteo de otro, ni siquiera por accidente.
      dedupeKey: dedupeKey ? `${accountId}:${dedupeKey}` : undefined,
    });
  }

  /**
   * Un webhook a la vez por conversacion.
   *
   * El comentario viejo decia que el check-and-set de la bandera de entrega era
   * atomico "porque no hay await en medio". Eso solo es cierto si `store.get()`
   * devuelve SIEMPRE el mismo objeto, como hacen los stores de memoria y de
   * archivo. El de Postgres, que es el de produccion, deserializa una copia
   * nueva en cada consulta: dos webhooks simultaneos del mismo usuario leen dos
   * copias, las dos ven la bandera en falso y las dos entregan. Resultado: DM
   * duplicado, que es justo el riesgo de spam/ban que se queria evitar.
   *
   * Esta cola por clave de conversacion cierra la ventana dentro del proceso.
   * Con varias instancias haria falta ademas un candado en la base.
   */
  private readonly enCurso = new Map<string, Promise<void>>();

  async handle(event: IncomingEvent): Promise<void> {
    const cuenta = this.cuentaDelEvento(event);
    if (!cuenta) return;
    const clave = `${cuenta}:${event.platform}:${event.user.id}`;
    const anterior = this.enCurso.get(clave) ?? Promise.resolve();
    const turno = anterior.then(
      () => this.handleSerializado(event, cuenta),
      () => this.handleSerializado(event, cuenta),
    );
    this.enCurso.set(clave, turno);
    try {
      await turno;
    } finally {
      // Solo limpia si nadie mas se encolo detras: si no, se borraria el turno
      // de otro y volveria el solapamiento.
      if (this.enCurso.get(clave) === turno) this.enCurso.delete(clave);
    }
  }

  private async handleSerializado(event: IncomingEvent, cuenta: string): Promise<void> {
    const adapter = this.adapters.get(event.platform);
    if (!adapter) {
      logger.warn({ platform: event.platform }, 'No hay adaptador para la plataforma');
      return;
    }

    const state = await this.loadState(event, cuenta);
    // La llegada de cualquier evento del usuario renueva la ventana de 24h.
    // Usamos la hora de RECEPCION (ahora): el usuario acaba de interactuar, asi
    // evitamos problemas de unidad (Meta envia el timestamp en segundos, no ms).
    state.lastUserInteractionAt = Date.now();
    // Guarda el username para mostrarlo en la bandeja (/inbox).
    if (event.user.username) state.username = event.user.username;
    // Registra el evento ENTRANTE en el hilo de la conversacion (bandeja /inbox).
    this.recordMessage(state, {
      dir: 'in',
      kind: event.type,
      text: event.text ?? event.payload,
      at: Date.now(),
    });
    // Recuerda el post de origen: la entrega por Drive lo necesita aunque el
    // usuario llegue luego por el boton "ya te sigo" (postback sin mediaId).
    if (event.mediaId) state.data.mediaId = event.mediaId;

    try {
      // El usuario toco "Obtener el enlace": su interaccion abrio la ventana de
      // 24h, ahora SI podemos aplicar el gate y entregar el valor por DM.
      if (event.type === 'postback' && event.payload?.startsWith(GET_PREFIX)) {
        const campaign = getCampaign(event.payload.slice(GET_PREFIX.length));
        if (campaign) {
          // Clave por dia: dos toques del mismo dia son la misma intencion. Sin
          // esto, cualquiera llena la tabla tocando el boton en bucle (no cuesta
          // envios) e infla el embudo que lee el cliente.
          await this.note('button_tapped', state, campaign.name, `tap:${state.userId}:${campaign.name}:${hoy()}`);
          await this.runGate(adapter, state, campaign);
        }
        return;
      }

      // El usuario toco "Ya te sigo": re-chequeamos el follow.
      if (event.type === 'postback' && event.payload?.startsWith(CHECK_PREFIX)) {
        const campaign = getCampaign(event.payload.slice(CHECK_PREFIX.length));
        if (campaign) await this.runGate(adapter, state, campaign);
        return;
      }

      const campaign = await this.resolveCampaign(adapter, state, event, cuenta);
      if (!campaign) {
        logger.debug({ type: event.type, text: event.text }, 'Sin campana que haga match');
        return;
      }

      state.activeFlow = campaign.name;
      if (event.type === 'comment') {
        // El comentario es el hecho: si Meta reenvia el mismo webhook, el
        // commentId lo delata y no se cuenta dos veces.
        await this.note(
          'comment_detected',
          state,
          campaign.name,
          event.commentId ? `comment:${event.commentId}` : undefined,
        );
      }
      // Patron comment-to-DM (estilo ManyChat): NO entregamos aun. Mandamos el
      // welcome con el boton "Obtener el enlace". Al tocarlo, el usuario abre la
      // ventana de 24h y ahi entregamos (regla de Meta: no puedes mandar DMs de
      // seguimiento hasta que la persona interactue de vuelta).
      // Solo se cuenta el DM si de verdad salio: fuera de la ventana de 24h o
      // con el tope de envios alcanzado no sale nada, y el numero que lee el
      // cliente no puede decir lo contrario.
      const salioElDm = await this.sendEntry(adapter, state, campaign, event);
      if (salioElDm) {
        await this.note(
          'dm_sent',
          state,
          campaign.name,
          event.commentId ? `entry:${event.commentId}` : undefined,
        );
      }
    } finally {
      await this.store.upsert(state);
    }
  }

  /** Envia el mensaje de entrada (welcome + boton "Obtener el enlace"). */
  private async sendEntry(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
    event: IncomingEvent,
  ): Promise<boolean> {
    // Si el recurso es la agenda/Calendar (DM sin keyword), usa el copy de cita.
    const isDm = state.data.matchedKeyword === DM_DEFAULT;
    const button = {
      title: (isDm && campaign.copy.dmButtonTitle) || campaign.copy.getLinkButtonTitle,
      payload: GET_PREFIX + campaign.name,
    };
    const text = (isDm && campaign.copy.dmWelcome) || campaign.copy.welcome || '¡Hola! 👋';

    if (event.type === 'comment' && event.commentId) {
      // Respuesta privada al comentario, con el boton adjunto. Es el unico envio
      // permitido antes de que la persona interactue de vuelta. Va por safeSend
      // (que deja pasar private_reply) para quedar registrado en la bandeja.
      return await this.safeSend(adapter, state, {
        kind: 'private_reply',
        commentId: event.commentId,
        text,
        buttons: [button],
      });
    }
    // Disparado por DM entrante: la ventana ya esta abierta, mandamos con boton.
    return await this.safeSend(adapter, state, { kind: 'buttons', text, buttons: [button] });
  }

  /**
   * Decide que campana aplica al evento.
   * 1) Campanas en modo 'keywords' (match directo por texto).
   * 2) Campanas en modo 'caption': deriva la keyword del copy del post en runtime
   *    y dispara si el comentario la contiene.
   */
  private async resolveCampaign(
    adapter: PlatformAdapter,
    state: ConversationState,
    event: IncomingEvent,
    cuenta: string,
  ): Promise<Campaign | undefined> {
    const direct = matchCampaign(event.type, event.text, event.mediaId);
    if (direct) {
      // Guarda cual keyword hizo match, para entregar el recurso mapeado.
      state.data.matchedKeyword = direct.trigger.keywords.find((k) =>
        matchesKeyword(event.text, k),
      );
      return direct;
    }

    // Modo 'sheet': el comentario/DM matchea cualquier palabra de la hoja.
    const sheets = sheetCampaigns(event.type);
    if (sheets.length > 0) {
      const hallado = event.text ? await this.recursos.buscar(cuenta, event.text) : undefined;
      if (hallado) {
        state.data.matchedKeyword = hallado.palabra;
        // Se recuerda si esa campana exige seguir, porque el gate corre despues,
        // en otro webhook (cuando la persona toca el boton).
        state.data.exigirSeguir = hallado.exigirSeguir;
        logger.info({ keyword: hallado.palabra }, 'Palabra detectada');
        return sheets[0];
      }
      // DM sin palabra clave -> recurso por defecto (ej. link de agenda/Calendar),
      // definido en la fila con CTA "Escríbeme por DM". Opt-in: apagado por
      // defecto para no auto-responder a cada DM normal (conversaciones, dudas).
      if (
        env.DM_DEFAULT_ENABLED &&
        event.type === 'message' &&
        (await this.recursos.porDefecto(cuenta))
      ) {
        state.data.matchedKeyword = DM_DEFAULT;
        logger.info('DM sin keyword -> recurso por defecto');
        return sheets[0];
      }
    }

    // Modo 'caption': deriva la keyword del copy del post (requiere comentario).
    if (event.type !== 'comment' || !event.mediaId || !event.text) return undefined;
    const candidates = captionCampaigns(event.type, event.mediaId);
    if (candidates.length === 0) return undefined;

    const keyword = await this.resolveCaptionKeyword(adapter, event.mediaId);
    if (!keyword) return undefined;
    if (!matchesKeyword(event.text, keyword)) return undefined;

    state.data.matchedKeyword = keyword;
    logger.info({ mediaId: event.mediaId, keyword }, 'Keyword derivada del copy del post');
    return candidates[0];
  }

  /** Obtiene (con cache) la keyword derivada del caption de un media. */
  private async resolveCaptionKeyword(
    adapter: PlatformAdapter,
    mediaId: string,
  ): Promise<string | null> {
    if (this.captionKeywordCache.has(mediaId)) {
      return this.captionKeywordCache.get(mediaId) ?? null;
    }
    const caption = adapter.getMediaCaption ? await adapter.getMediaCaption(mediaId) : null;
    const keyword = extractKeywordFromCaption(caption);
    this.captionKeywordCache.set(mediaId, keyword);
    return keyword;
  }

  /** Corazon del follow-gate: entrega si pasa, si no pide seguir. */
  private async runGate(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    // Se RELEE la campana ahora, no se confia en lo que se guardo cuando llego el
    // comentario: entre ese momento y este toque pueden pasar horas, y si el
    // cliente encendio el follow-gate en el medio, la bandera vieja lo saltaria.
    const cuenta = state.accountId ?? this.accountId;
    const palabra =
      typeof state.data.matchedKeyword === 'string' ? state.data.matchedKeyword : undefined;
    const alDia = palabra ? await this.recursos.porPalabra(cuenta, palabra) : undefined;
    const guardado =
      typeof state.data.exigirSeguir === 'boolean' ? state.data.exigirSeguir : undefined;
    const exigeLaCampana = alDia?.exigirSeguir ?? guardado ?? campaign.requireFollow;
    const gateOn = env.FOLLOW_GATE_ENABLED && exigeLaCampana;

    if (gateOn) {
      const follows = await this.checkFollow(adapter, state);
      if (follows === true) {
        await this.note(
          'follow_verified',
          state,
          campaign.name,
          `follow:${state.userId}:${campaign.name}:${hoy()}`,
        );
      }
      if (follows === false) {
        await this.note(
          'blocked_not_following',
          state,
          campaign.name,
          `noflow:${state.userId}:${campaign.name}:${hoy()}`,
        );
        // Reintento = la persona ya venia en 'awaiting_follow' y volvio a tocar.
        const retry = state.step === 'awaiting_follow';
        state.step = 'awaiting_follow';
        await this.safeSend(adapter, state, {
          kind: 'buttons',
          text: retry ? campaign.copy.stillNotFollowing : campaign.copy.askToFollow,
          buttons: [
            { title: campaign.copy.followedButtonTitle, payload: CHECK_PREFIX + campaign.name },
          ],
        });
        return;
      }
      // follows === null (no determinable) → dejamos pasar para no bloquear valor.
    }

    await this.deliver(adapter, state, campaign);
  }

  private async deliver(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    const flagKey = `delivered:${campaign.name}`;
    if (state.data[flagKey]) {
      logger.debug({ user: state.userId, campaign: campaign.name }, 'Ya entregado, se omite');
      return;
    }
    // Reclamamos la entrega ANTES de los envios. Lo que hace segura esta reclama
    // NO es la ausencia de await (con el store de Postgres cada consulta trae una
    // copia distinta del estado): es la cola por conversacion de `handle()`, que
    // procesa un webhook a la vez por usuario. Tradeoff: si un envio falla no hay
    // reintento automatico (es el gap #2, diferido); el usuario re-dispara el flujo.
    state.data[flagKey] = true;
    state.step = 'delivered';
    let salioAlgo = false;
    for (const msg of campaign.deliver) {
      salioAlgo = (await this.safeSend(adapter, state, msg)) || salioAlgo;
    }
    salioAlgo = (await this.deliverFromKeyword(adapter, state, campaign)) || salioAlgo;
    salioAlgo = (await this.deliverFromDrive(adapter, state, campaign)) || salioAlgo;

    if (!salioAlgo) {
      // Nada salio (falta el link en la hoja, ventana cerrada, tope de envios).
      // Se SUELTA la bandera: si se quedara puesta, la persona nunca volveria a
      // recibir el recurso aunque lo pidiera de nuevo, y el fallo seria invisible
      // porque tampoco se registra la entrega. Soltarla no arriesga doble envio:
      // no hubo envio que duplicar.
      delete state.data[flagKey];
      logger.warn(
        { user: state.userId, campaign: campaign.name },
        'No salio ningun mensaje: no se cuenta como entrega',
      );
      return;
    }
    logger.info({ user: state.userId, campaign: campaign.name }, 'Valor entregado ✅');
    // Una entrega por usuario y campana: la misma clave que usa la bandera de
    // arriba, para que el panel cuente lo mismo que entrego el motor.
    await this.note(
      'resource_delivered',
      state,
      campaign.name,
      `delivered:${state.userId}:${campaign.name}`,
    );
  }

  /** Entrega el recurso (link/doc) mapeado a la palabra clave detectada. */
  private async deliverFromKeyword(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<boolean> {
    if (!campaign.deliverFromKeyword) return false;
    const cuenta = state.accountId ?? this.accountId;
    const kw = typeof state.data.matchedKeyword === 'string' ? state.data.matchedKeyword : undefined;
    const res =
      kw === DM_DEFAULT
        ? await this.recursos.porDefecto(cuenta)
        : kw
          ? await this.recursos.porPalabra(cuenta, kw)
          : undefined;
    if (!res) {
      logger.warn({ keyword: kw }, 'Sin recurso mapeado para la keyword (revisa la hoja)');
      return false;
    }
    if (res.texto) await this.safeSend(adapter, state, { kind: 'text', text: res.texto });
    return await this.safeSend(adapter, state, { kind: 'text', text: res.url });
  }

  /** Entrega el documento de Drive resuelto por la fecha del post de origen. */
  private async deliverFromDrive(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<boolean> {
    if (!campaign.driveDelivery?.enabled) return false;

    const mediaId = typeof state.data.mediaId === 'string' ? state.data.mediaId : undefined;
    if (!mediaId || !adapter.getMediaTimestamp) {
      logger.warn({ user: state.userId }, 'Drive: sin mediaId/timestamp; se omite entrega Drive');
      return false;
    }

    const ts = await adapter.getMediaTimestamp(mediaId);
    if (ts === null) {
      logger.warn({ mediaId }, 'Drive: no se pudo obtener la fecha del post');
      return false;
    }

    const date = toDateFolderName(ts);
    const link = await googleDrive.resolveLinkByDate(date);
    if (!link) {
      logger.warn({ date }, 'Drive: sin documento para esa fecha; se omite');
      return false;
    }

    if (campaign.driveDelivery.prependText) {
      await this.safeSend(adapter, state, { kind: 'text', text: campaign.driveDelivery.prependText });
    }
    return await this.safeSend(adapter, state, { kind: 'text', text: link });
  }

  /** Consulta follow status con cache corto. */
  private async checkFollow(
    adapter: PlatformAdapter,
    state: ConversationState,
  ): Promise<boolean | null> {
    const now = Date.now();
    if (state.followCache && now - state.followCache.checkedAt < FOLLOW_CACHE_TTL_MS) {
      return state.followCache.isFollower;
    }
    const result = await adapter.isFollower(state.userId);
    if (result !== null) {
      state.followCache = { isFollower: result, checkedAt: now };
    }
    return result;
  }

  /**
   * Envia respetando la ventana de 24h. Las respuestas a comentarios
   * (private_reply) tienen su propia ventana y se dejan pasar.
   */
  /** Devuelve true si el mensaje salio (o quedo encolado), false si se omitio. */
  private async safeSend(
    adapter: PlatformAdapter,
    state: ConversationState,
    message: Parameters<PlatformAdapter['sendMessage']>[1],
  ): Promise<boolean> {
    if (message.kind !== 'private_reply' && !isWithinMessagingWindow(state)) {
      logger.warn(
        { user: state.userId },
        'Fuera de ventana de 24h: no se envia para no violar politica de Meta',
      );
      return false;
    }

    // Registro del saliente para la bandeja /inbox (mismo shape en ambas ramas).
    const outbound: ConversationMessage = {
      dir: 'out',
      kind: message.kind,
      text: 'text' in message ? message.text : undefined,
      at: Date.now(),
    };

    // Gap #2 (opt-in): con cola, registramos el saliente (optimista) y encolamos
    // el envio real. La cola aplica el rate-limit (requeue si topa) y reintenta
    // fallos transitorios; el webhook no espera al envio -> respuesta rapida.
    if (this.sendQueue) {
      this.recordMessage(state, outbound);
      this.sendQueue.enqueue({ platform: state.platform, userId: state.userId, message });
      return true;
    }

    // Sin cola (default): envio sincrono. Backstop anti-ban: si superamos el tope
    // por hora de la cuenta, omitimos (aqui no hay requeue; para eso esta la cola).
    if (!this.rateLimiter.tryAcquire(state.platform)) {
      logger.warn(
        { user: state.userId, platform: state.platform },
        'Tope de envios por hora alcanzado: se omite el envio (anti-ban Meta)',
      );
      return false;
    }
    await adapter.sendMessage(state.userId, message);
    this.recordMessage(state, outbound); // registra en la bandeja /inbox
    return true;
  }

  /**
   * Agrega un mensaje al hilo y poda al tope (conserva los mas recientes).
   * El tope vive en el store: la respuesta manual del operador escribe el mismo
   * hilo y tiene que respetar exactamente el mismo limite.
   */
  private recordMessage(state: ConversationState, msg: ConversationMessage): void {
    agregarMensaje(state, msg);
  }

  private async loadState(event: IncomingEvent, cuenta: string): Promise<ConversationState> {
    const existing = await this.store.get(event.platform, event.user.id, cuenta);
    if (existing) return existing;
    return {
      accountId: cuenta,
      platform: event.platform,
      userId: event.user.id,
      lastUserInteractionAt: event.timestamp || Date.now(),
      messages: [],
      data: {},
    };
  }
}

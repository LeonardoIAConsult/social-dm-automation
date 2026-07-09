# Arquitectura

## Idea central
El **núcleo es agnóstico de plataforma**. Cada red social se conecta con un
**adaptador** que implementa un contrato común (`PlatformAdapter`). El motor de
flujos (`FlowEngine`) nunca habla con Instagram directamente: habla con el
adaptador. Por eso agregar Facebook u otra red no toca la lógica de negocio.

```
                 webhook HTTP (Meta)
                        │
                        ▼
             ┌──────────────────────┐
             │  server/app.ts       │  valida firma, responde 200,
             │  (Express)           │  entrega el body al adaptador
             └──────────┬───────────┘
                        │ parseWebhook()
                        ▼
             ┌──────────────────────┐
             │  InstagramAdapter    │  implementa PlatformAdapter
             │  (platforms/instagram)│  - signature.ts
             └──────────┬───────────┘  - webhookParser.ts
                        │ IncomingEvent[]  - client.ts (Graph API)
                        ▼
             ┌──────────────────────┐
             │  FlowEngine          │  match campaña → follow-gate → entrega
             │  (core/flowEngine)   │  usa ConversationStore para el estado
             └──────────┬───────────┘
                        │ sendMessage() / isFollower()
                        ▼
                  (de vuelta al adaptador → Graph API)
```

## Piezas
| Archivo | Rol |
|---|---|
| `core/types.ts` | Contrato `PlatformAdapter` + eventos normalizados. |
| `core/campaigns.ts` | **Lo que edita el usuario**: disparadores, follow-gate, valor a entregar. |
| `core/flowEngine.ts` | Lógica: match, gate, entrega, respeto de ventana 24h. |
| `store/conversationStore.ts` | Estado por conversación (in-memory; cambiable a Redis/DB). |
| `platforms/instagram/*` | Adaptador Instagram (firma, parser, cliente Graph API). |
| `server/app.ts` | HTTP: verificación + recepción de webhooks. |
| `index.ts` | Cableado de todo. |

## Cómo agregar otra red (ej. Facebook)
1. Crea `src/platforms/facebook/facebookAdapter.ts` implementando `PlatformAdapter`.
2. Reusa lo que puedas de Instagram (Messenger Platform comparte casi toda la API).
3. Regístralo en `index.ts`: `adapters.set(fb.platform, fb)` y agrega su ruta en `server/app.ts`.
4. El `FlowEngine` y las campañas **no cambian**.

> LinkedIn y YouTube no exponen API de DM masivo/automatizado; sus adaptadores
> quedarían como stubs no funcionales. Twitter/X tiene API de DM en tiers de pago.

## Persistencia
El MVP usa memoria (se pierde al reiniciar). Para producción, implementa
`ConversationStore` con Redis o Postgres y pásalo en `index.ts`. El resto no cambia.

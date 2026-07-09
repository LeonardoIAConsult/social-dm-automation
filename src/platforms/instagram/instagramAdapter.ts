import type {
  IncomingEvent,
  OutgoingMessage,
  PlatformAdapter,
} from '../../core/types.js';
import { InstagramClient } from './client.js';
import { parseInstagramWebhook } from './webhookParser.js';
import { verifyInstagramSignature } from './signature.js';

/**
 * Adaptador de Instagram: implementa el contrato PlatformAdapter delegando
 * en el cliente Graph API, el parser y el validador de firma.
 *
 * Para agregar Facebook u otra red, se crea otro archivo analogo que
 * implemente PlatformAdapter y se registra en el server. El engine no cambia.
 */
export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram' as const;
  private readonly client = new InstagramClient();

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    verifyInstagramSignature(rawBody, signatureHeader);
  }

  parseWebhook(body: unknown): IncomingEvent[] {
    return parseInstagramWebhook(body);
  }

  async sendMessage(userId: string, message: OutgoingMessage): Promise<void> {
    await this.client.send(userId, message);
  }

  async isFollower(userId: string): Promise<boolean | null> {
    return this.client.isUserFollowBusiness(userId);
  }

  async getMediaCaption(mediaId: string): Promise<string | null> {
    return this.client.getMediaCaption(mediaId);
  }
}

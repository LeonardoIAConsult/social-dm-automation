import { drive, type drive_v3 } from '@googleapis/drive';
import { GoogleAuth } from 'google-auth-library';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Entrega de documentos desde Google Drive, resueltos por la FECHA del post.
 *
 * Convencion: en Drive tienes una carpeta raiz (GDRIVE_ROOT_FOLDER_ID) con una
 * subcarpeta por fecha/post cuyo nombre CONTIENE la fecha en formato YYYY-MM-DD.
 * Ej: "2026-07-09 - Carrusel Guia". Dentro va el PDF a entregar.
 *
 * Auth: cuenta de servicio (GOOGLE_APPLICATION_CREDENTIALS). Comparte la carpeta
 * raiz con el email de la cuenta de servicio (permiso lector) para que pueda leer.
 *
 * En DRY_RUN devuelve un link simulado, para probar el flujo sin credenciales.
 */
class GoogleDriveService {
  private client: drive_v3.Drive | null = null;

  private getClient(): drive_v3.Drive {
    if (this.client) return this.client;
    const auth = new GoogleAuth({
      keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    // Cast: coexisten dos copias de google-auth-library (una anidada en
    // googleapis-common); la clase es la misma en runtime, solo choca el tipo.
    this.client = drive({ version: 'v3', auth: auth as unknown as never });
    return this.client;
  }

  /**
   * Devuelve el link compartible del documento de la carpeta cuya fecha coincide.
   * @param date fecha en formato YYYY-MM-DD (la del post).
   */
  async resolveLinkByDate(date: string): Promise<string | null> {
    if (env.DRY_RUN) {
      logger.info({ date, link: env.SIM_DRIVE_LINK }, '🧪 [DRY_RUN] link de Drive simulado');
      return env.SIM_DRIVE_LINK;
    }
    if (!env.GDRIVE_ENABLED) return null;
    if (!env.GDRIVE_ROOT_FOLDER_ID) {
      logger.warn('GDRIVE_ENABLED pero falta GDRIVE_ROOT_FOLDER_ID');
      return null;
    }

    try {
      const api = this.getClient();

      // 1) Subcarpeta cuyo nombre contiene la fecha.
      const folders = await api.files.list({
        q:
          `'${env.GDRIVE_ROOT_FOLDER_ID}' in parents and ` +
          `mimeType='application/vnd.google-apps.folder' and ` +
          `name contains '${date}' and trashed=false`,
        fields: 'files(id,name)',
        pageSize: 5,
      });
      const folder = folders.data.files?.[0];
      if (!folder?.id) {
        logger.warn({ date }, 'No hay carpeta de Drive para esa fecha');
        return null;
      }

      // 2) Primer archivo (no carpeta) de esa subcarpeta, mas reciente primero.
      const files = await api.files.list({
        q: `'${folder.id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: 10,
      });
      const file = files.data.files?.[0];
      if (!file?.id) {
        logger.warn({ folder: folder.name }, 'Carpeta de fecha sin archivos');
        return null;
      }

      // 3) Asegura permiso "cualquiera con el link" (lector) y devuelve el link.
      await this.ensureAnyoneReader(api, file.id);
      const link = file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
      logger.info({ date, file: file.name, link }, 'Documento de Drive resuelto');
      return link;
    } catch (err) {
      logger.error({ err, date }, 'Error resolviendo documento en Drive');
      return null;
    }
  }

  private async ensureAnyoneReader(api: drive_v3.Drive, fileId: string): Promise<void> {
    try {
      await api.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch {
      // Ya existia el permiso o la politica lo restringe: no es fatal.
    }
  }
}

export const googleDrive = new GoogleDriveService();

/** Formatea un epoch ms a YYYY-MM-DD (zona local del server). */
export function toDateFolderName(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

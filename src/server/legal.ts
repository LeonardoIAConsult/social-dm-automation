/**
 * Paginas legales minimas (politica de privacidad y terminos) que Meta exige
 * para publicar la app en modo Activo. Se sirven en /privacy y /terms.
 *
 * Ajusta el nombre, la marca y el email de contacto segun corresponda.
 */

const CONTACT_EMAIL = 'leoanrdoantolinezpizon@gmail.com'; // TODO: confirmar ortografia
const BRAND = 'Leonardo Antolinez';
const UPDATED = '9 de julio de 2026';

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a1a1a}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.8rem}small{color:#666}a{color:#2563eb}</style>
</head><body>${bodyHtml}<hr><small>Contacto: ${CONTACT_EMAIL}</small></body></html>`;
}

export const privacyHtml = page(
  'Política de Privacidad',
  `<h1>Política de Privacidad</h1>
<small>Última actualización: ${UPDATED}</small>
<p>Esta aplicación ("la App") automatiza respuestas a mensajes directos y comentarios en las
cuentas de redes sociales de ${BRAND}. Esta política explica qué datos se procesan y cómo.</p>

<h2>1. Datos que procesamos</h2>
<ul>
<li>Identificadores de usuario de Instagram (IGSID) de quienes interactúan con la cuenta.</li>
<li>Contenido de los mensajes o comentarios enviados a la cuenta.</li>
<li>Estado de seguimiento (si la persona sigue la cuenta), obtenido de la API de Meta.</li>
</ul>

<h2>2. Para qué los usamos</h2>
<p>Únicamente para responder de forma automática, aplicar reglas de entrega de contenido
(por ejemplo, enviar un recurso a quienes siguen la cuenta) y mejorar la atención. No vendemos
ni compartimos estos datos con terceros con fines publicitarios.</p>

<h2>3. Conservación</h2>
<p>Se conserva el estado mínimo necesario de cada conversación para operar los flujos. Puedes
solicitar la eliminación de tus datos escribiendo al contacto de esta página.</p>

<h2>4. Terceros</h2>
<p>La App usa la Plataforma de Meta (Instagram) para recibir y enviar mensajes, y puede usar
Google Drive para entregar documentos. El uso de esos servicios se rige por sus propias políticas.</p>

<h2>5. Tus derechos</h2>
<p>Puedes pedir acceso, corrección o eliminación de tus datos, o dejar de recibir mensajes
respondiendo "STOP" en la conversación.</p>

<h2>6. Cambios</h2>
<p>Podemos actualizar esta política. La fecha de arriba indica la última versión.</p>`,
);

export const termsHtml = page(
  'Términos de Servicio',
  `<h1>Términos de Servicio</h1>
<small>Última actualización: ${UPDATED}</small>
<p>Al interactuar con las cuentas automatizadas de ${BRAND} aceptas estos términos.</p>
<h2>1. Uso</h2>
<p>La App envía respuestas automáticas y contenido de valor. No garantiza disponibilidad
ininterrumpida.</p>
<h2>2. Contenido</h2>
<p>El contenido entregado es informativo. No constituye asesoría profesional personalizada.</p>
<h2>3. Contacto</h2>
<p>Para cualquier consulta, usa el correo de contacto de esta página.</p>`,
);

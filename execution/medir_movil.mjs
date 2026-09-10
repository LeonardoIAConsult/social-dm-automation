/**
 * Mide el panel en un viewport REAL de 360 px, el ancho de un telefono modesto.
 *
 * Responde tres preguntas que no se pueden contestar leyendo el codigo:
 *  - ¿el contenido cabe? (si no cabe, el navegador movil ENSANCHA el viewport y
 *    la pagina se ve alejada y diminuta: por eso se exige innerWidth === 360)
 *  - ¿lo importante se ve sin bajar?
 *  - ¿que dice exactamente el texto que lee el cliente?
 *
 * Deja capturas en .tmp/movil-*.png. Necesita el servidor local levantado y
 * playwright-core (instalado global en esta maquina).
 *
 * Uso:
 *   node execution/medir_movil.mjs <token-de-invitacion>
 */
import pw from 'file:///C:/Users/Lonardo%20Antonilez/AppData/Roaming/npm/node_modules/playwright-core/index.js';
const { chromium } = pw;

const TOKEN = process.argv[2];
const BASE = 'http://localhost:3117';

const navegador = await chromium.launch({ channel: 'chrome' });
const contexto = await navegador.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const pagina = await contexto.newPage();

async function medir(nombre, ruta) {
  await pagina.goto(BASE + ruta, { waitUntil: 'networkidle' });
  const m = await pagina.evaluate(() => {
    const anchoVisible = window.innerWidth;
    const anchoDoc = document.documentElement.scrollWidth;
    let masAncho = 0;
    let culpable = '';
    for (const el of document.querySelectorAll('body *')) {
      const w = el.getBoundingClientRect().width;
      if (w > masAncho) {
        masAncho = w;
        culpable = el.tagName.toLowerCase() + (el.className ? '.' + el.className : '');
      }
    }
    const primera = document.querySelector('.tarjeta');
    return {
      anchoVisible,
      anchoDoc,
      desborda: anchoDoc > anchoVisible + 1,
      masAncho: Math.round(masAncho),
      culpable,
      finDelPrimerBloque: primera ? Math.round(primera.getBoundingClientRect().bottom) : null,
      alturaVisible: window.innerHeight,
    };
  });
  // En emulacion movil, si el contenido no cabe, el navegador ENSANCHA el
  // viewport de diseno en vez de mostrar barra horizontal: la pagina se ve
  // alejada y diminuta. Por eso el que manda es que innerWidth siga siendo 360,
  // no la ausencia de desbordamiento. (Este chequeo se agrego porque una
  // mutacion que rompia el movil pasaba como "ok".)
  const anchoCorrecto = m.anchoVisible === 360;
  const veredicto = !anchoCorrecto
    ? `VIEWPORT ENSANCHADO a ${m.anchoVisible}px: el contenido no cabe`
    : m.desborda
      ? 'DESBORDA'
      : 'ok';
  const sinBajar =
    m.finDelPrimerBloque !== null && m.finDelPrimerBloque <= m.alturaVisible
      ? 'primer bloque visible sin bajar'
      : 'HAY QUE BAJAR para ver el primer bloque';
  console.log(
    `${nombre.padEnd(10)} ancho=${m.anchoVisible} doc=${m.anchoDoc} ${veredicto} · elemento mas ancho=${m.masAncho}px (${m.culpable}) · ${sinBajar}`,
  );
  await pagina.screenshot({ path: `.tmp/movil-${nombre}.png`, fullPage: true });
  return anchoCorrecto && !m.desborda;
}

let todoBien = true;
todoBien = (await medir('entrar', `/panel/entrar?t=${TOKEN}`)) && todoBien;
await pagina.click('button[type=submit]');
await pagina.waitForURL('**/panel');
todoBien = (await medir('panel', '/panel')) && todoBien;
todoBien = (await medir('sin-sesion', '/panel/salir-inexistente')) && todoBien;
todoBien = (await medir('campana', '/panel/campana')) && todoBien;
todoBien = (await medir('prueba', '/panel/prueba')) && todoBien;
todoBien = (await medir('cuentas', '/panel/cuentas')) && todoBien;

// Texto visible del panel, para revisar que no haya jerga.
await pagina.goto(BASE + '/panel');
const texto = await pagina.evaluate(() => document.body.innerText);
console.log('\n--- texto que ve el cliente ---\n' + texto);

await navegador.close();
console.log(todoBien ? '\nGO: ningun desbordamiento a 360 px' : '\nNO-GO: hay desbordamiento');
process.exit(todoBien ? 0 : 1);

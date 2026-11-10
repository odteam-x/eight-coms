// Regenera las cabeceras de correo (img/correo/cabecera-*.png) desde docs/fuente-cabecera-correo.html con el servidor demo en :3100.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 700 } })).newPage();
await p.goto('http://localhost:3100/docs/fuente-cabecera-correo.html'); await p.waitForTimeout(2500);
for (const id of ['oscuro', 'claro']) await p.locator('#' + id).screenshot({ path: `img/correo/cabecera-${id}.png` });
await b.close();

# Sistema visual: iconos, reconocimientos, gradientes y movimiento (noviembre 2026)

## Auditoría de partida (lo que había)
- **Stack:** HTML/CSS/JS sin build, Supabase, Chart.js 4.4.7 (CDN con SRI). **Iconos:** ya locales, una sola familia (Remix Icon, 145
  glifos en `core/iconos.js`, 33 KB; el marcado sigue usando `data-lucide="…"` por historia, pero Lucide no se carga). Sin CDN de iconos.
- **Gradientes:** una malla única (`vidrio.css`) y ~20 gradientes sueltos repartidos en hojas distintas.
- **Rankings:** medalla = disco plano con número (pasaba por «emoji»); sin estrellas; sin trofeo; animación casi nula (a propósito: las
  entradas por bloque se quitaron por «look de IA»).
- **Medido en el navegador:** 176 pantallas × 4 anchos (ver `docs/auditoria-ui-noviembre-2026.md`).

## Investigación y decisión

| Familia | Evaluado | Hallazgo (fuentes en el informe) | Decisión |
|---|---|---|---|
| Iconos | Lucide (ISC), Tabler (MIT, ~5 000), Phosphor (MIT, 6 pesos), Remix (Apache-2.0; ojo: v4.9+ usa licencia propia que prohíbe logos), Iconify, Nuqta | Todas gratuitas para uso comercial; el proyecto **ya tiene** una familia local coherente | **Se queda Remix** (sin segunda familia). Cambiar de familia = reemplazar 145 glifos sin ganancia visual. Si falta un glifo: se genera de `@iconify-json/ri` con `tools/generar-iconos.mjs`. |
| Medallas / trofeos | Icons8, IconScout, Iconfinder, SVG Repo, Free Game UI, Envato | Licencias de atribución o de pago por uso comercial; estilo de videojuego; recursos de 20–300 KB | **SVG propio** (~2 KB en total): disco con borde interior, reflejo y cinta; el metal es un gradiente de `gradients.css`. |
| Animación | Motion (MIT, mini ≈ 2,3–3 KB), GSAP (licencia estándar gratuita desde 2025, ≈ 23–28 KB), Lottie (lottie-web pesado), Lordicon (gratis exige **atribución**), Rive, Animate.css | Nada de lo que hace falta (fundidos, barras, pulsación) requiere JavaScript | **Solo CSS** (`motion.css`). Sin dependencia nueva. |
| Gradientes | CSS Gradient, Grabient, Gradient Hunt, WebGradients, Haikei, Mesh Gradients | Útiles como referencia de paradas y de mallas | Reescritos a mano en CSS con los colores de marca; **nada remoto**. |

**Dependencias incorporadas:** `playwright-core` (solo desarrollo, pruebas). **Para el sitio: ninguna.**
**Recursos descargados:** ninguno (todo es SVG/CSS propio).

## Dónde vive cada cosa
| Pieza | Archivo |
|---|---|
| Gradientes (metales, velos de tono, progreso, luces de atmósfera, superficies) | `gradients.css` (variables `--g-*`, `--metal-*`; hex solo en `:root`) |
| Medallas, trofeo, estrellas (sprite SVG + funciones) | `core/reconocimientos.js` → `medallaSVG`, `trofeoHTML`, `estrellasHTML` |
| `medallaHTML(pos)` (lo que usan los rankings) | `core/render.js` (delega en `medallaSVG`) |
| Movimiento | `motion.css` (tokens `--mov-*`, `prefers-reduced-motion`) |
| Escala de iconos y estados | `vidrio.css` §47 (`--ico-xs…xl`, `.ico-*`, deshabilitado 45 %) |
| Atmósfera por área | `rotularPantalla` (core/render.js) pone `data-area` en `<body>`; `gradients.css` cambia las luces |

## Reconocimientos: qué existe y por qué
Solo lo respaldado por datos reales:
- **Puesto 1–3** de un ranking que ya calcula la base → medalla de oro, plata y bronce (Evaluar, Desempeño, Panel, Distritos).
- **Mejor resultado** del período (máximo de los publicados) → trofeo en el Panel, con el nombre en la etiqueta accesible.
- **Estrellas**: criterios de escala 1–5 del perfil, con la nota real (`4/5` = 80 % del relleno; admite fracciones). Una nota ausente
  no pinta estrellas.
- **No se crearon** coronas, escudos, diamantes ni «mayor crecimiento» como premio: no hay una regla de negocio escrita. Añadir uno
  exige regla + dato real + una entrada en `core/reconocimientos.js`. El token `--metal-diamante-*` queda definido para cuando exista.

## Gradientes: dónde se aplica cada familia
- **Tono de tarjeta** (`--g-velo`): indicadores del Panel (publicación = cian, promedio = azul, mejor = oro, plazo = verde), tarjetas de
  persona (según su fondo elegido). Velo de ≤ 24 % que muere a la mitad: el texto sigue sobre vidrio.
- **Progreso** (`--g-progreso`, `--g-plazo`, `--g-nivel-*`): barras de publicación, panorama de Reportes y criterios.
- **Atmósfera** (`--g-luz-*`): Operaciones (violeta), Organización/Mi distrito (verde), Configuración (ámbar); Centro de control, la base.
- **Superficie** (`--g-superficie`): «Requiere atención».

## Movimiento incorporado (y límites)
Fundido de 180 ms al cambiar de vista (una vez por vista), respuesta de pulsación en botones, crecimiento de barras al pintarse
(450 ms), asentamiento de medallas y trofeo (320 ms), relleno de estrellas, giro del chevron de desplegables. **No** hay bucles
(`infinite`), rebotes, elevaciones al pasar el ratón ni fondos animados. Todo se apaga con `prefers-reduced-motion`.

## Validaciones
- 50 scripts de prueba, 2418+ comprobaciones; 14 nuevas sobre este sistema (orden de hojas, reduced-motion, sin `infinite`, sin recursos
  remotos, estrellas = valor real, medallas con etiqueta de puesto).
- `tools/contraste.js` ahora también lee `vidrio.css`, `gradients.css` y `motion.css` (se corrigieron 9 hex sueltos de vidrio.css).
- Recorrido Playwright (Edge) y revisión en Brave: Panel, Evaluar, Perfil (Criterios), Equipos, Reportes, Auditoría, Rúbrica, Gestiones.

## Pendiente
- Medallas en el ranking de la secretaría (`secretario.js`): usan `medallaHTML`; Distritos (admin) revisado a ojo, con empates compartiendo medalla.
- Estrellas en la vista del miembro (`core/rubrica.js`, clásica) y en la hoja del reporte impreso.
- Tema claro: revisar a ojo el oro de las estrellas (se usa el oro oscuro para llegar a 3:1).

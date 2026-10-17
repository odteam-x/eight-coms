# Auditoría de interfaz — octubre 2026

Rama `feat/ui-rediseno`. Medida sobre el DOM real con el simulador (`tools/pruebas`, `npm run ui`) en 320, 390, 768, 1024, 1440 y 1920 px, los tres portales y todas sus pestañas. Herramienta nueva: `tools/pruebas/ui/audit-layout.js` (overflow por rectángulos, objetivos táctiles, texto bajo `--fs-xs`, controles sin nombre).

## Límites de lo comprobado

- **La app desplegada no se pudo abrir**: el enlace de preview de Vercel pide inicio de sesión. Se comparó producción (`eight-coms.vercel.app`) por huella de archivos: **no corresponde a la rama** (`marca.css` responde 404, `shared.css`, `premium.css`, `admin.js`… difieren). Producción sigue en una versión anterior al rediseño.
- Todo el análisis visual es sobre el simulador con datos de ejemplo, no sobre datos reales.
- No hay lint ni TypeScript en el proyecto (sin build). Las comprobaciones existentes son `tools/contraste.js` y `tools/pruebas` (`npm run todo`).

## Hallazgos y estado

| # | Prioridad | Hallazgo (evidencia) | Estado |
|---|---|---|---|
| 1 | Alta | **Evaluar**: la cabecera (título, período, filtros, progreso, estado, atajos) ocupaba ~58 % de la altura a 1440×900; lista y formulario quedaban con ~380 px | Corregido: período y filtros en una fila; progreso, estado y atajos en otra; atajos con 0 personas ocultos. La cabecera pasa de ~520 a ~340 px |
| 2 | Alta | **Cabeceras de pantalla de tres sistemas distintos**: `.ptitle` en MAYÚSCULAS (5 pestañas del admin), `h2.tab-title` en MAYÚSCULAS (portales de miembro y secretaría), `.pantalla-cab` (el canónico). Títulos `<div>`/`<h2>` sin `h1` | Corregido: todas las pestañas usan `.pantalla-cab` + `h1.pantalla-t`. Test nuevo lo exige |
| 3 | Alta | **Acción primaria incoherente**: «Nueva tarea» coral, «Nueva actividad / período / rol» contorno, «Abrir gestión» dentro de una barra de herramientas | Corregido: crear = `.btn-save` en la cabecera; exportar CSV = secundario |
| 4 | Media | **Contenido del admin capado a 1200 px** a ≥1600 px (el tope de 1440 de `shared.css` perdía contra `admin.css`): 478 px vacíos a la derecha a 1920 | Corregido (`premium.css`, carga al final) |
| 5 | Media | Degradado opaco `.eval-fijo` tapaba la luz ambiental y dibujaba un **recuadro visible** bajo 1100 px | Corregido |
| 6 | Media | **Medalla del ranking** se salía de su columna de 26 px y se superponía al nombre | Corregido |
| 7 | Media | **Tarjeta de persona en móvil**: el nombre se partía letra a letra (columna < 30 px) | Corregido: cuadrícula nombre/puntaje, estado debajo, perfil a la derecha |
| 8 | Media | **Objetivos táctiles de 40 px** con puntero grueso (chips, botones de icono, `eval-perfil` 36 px, `.pb` 34 px de ancho, enlaces «Ver entrega» 23 px, `cal2-ver` 36 px); el proyecto declara 44 | Corregido bajo `@media (pointer: coarse)` |
| 9 | Media | **Rail colapsado** (768–1099): botones de 35×44 y 24×44 dentro de un rail de 72 px | Corregido (ancho completo) |
| 10 | Media | Barra inferior a 320 px: «Calendario» se truncaba («Calenda…») | Corregido |
| 11 | Baja | `a.btn-icon` de Gestiones solo tenía `title` como nombre | Corregido (`aria-label`) |
| 12 | Baja | `<small>` del hero de Inicio a 12,67 px (< `--fs-xs`) | Corregido |
| 13 | Baja | Markup muerto: `#tab-perfiles` con ids duplicados (`catalogo-v2`) y estilos en línea con alias retirados (`--s2`, `--faint`) en Personas/Distritos (51 `style=""` en `admin.html`) | Eliminado el bloque muerto; Personas, Tareas y Distritos usan `.filtros-fila`. Quedan 38 `style=""` en `admin.html`, sobre todo en modales (ver pendientes) |
| 14 | Baja | Evaluar en móvil: chips en varias filas empujaban la lista fuera de pantalla | Corregido: una fila desplazable por grupo |

| 15 | Alta | **Tema claro**: `--surface-1` (blanco) sobre `--bg` casi blanco (1,1:1) y las tarjetas sin borde ni sombra: nada se distinguía; campos blancos sin límite visible (WCAG 1.4.11) | Corregido: contenedores con anillo `--trazo` + `--shadow-sm`; campos con `--campo-borde` (#6B84A0, 3,56–3,87:1), medido en `contraste.js` |
| 16 | Media | `theme-color` del navegador con colores antiguos (`#0E0F12` / `#F4F6F9`) | Corregido (`#061326` / `#EEF7FC`) |
| 17 | Media | **Rail**: los ítems de Configuración medían lo que su texto (113–167 px) y el hover dibujaba una píldora distinta en cada uno | Corregido: todos 195 px |
| 18 | Media | **Línea de tiempo de Períodos**: una barra coral a todo el ancho sin escala | Rehecha: eje de meses, pistas para períodos que se pisan, rango de fechas en el tramo, marca «Hoy» |
| 19 | Baja | Login móvil: «EIGHT» sangrado respecto de «CREATORS / LABs» por un espacio duro de `login.css` | Corregido |
| 20 | Alta | **Acceso y registro eran dos páginas**: «Crear cuenta» recargaba otra pantalla; en escritorio el panel de marca (lista de tres puntos) obligaba a deslizar para ver información secundaria | Una sola página con transición animada entre Entrar y Crear cuenta; escritorio sin scroll (verificado a 1440×800, 1366×600 y 1536×674); móvil con cabecera de marca de una línea |

## Inventario de pantallas (rutas)

| Ruta | Pestañas / vistas |
|---|---|
| `index.html` | Entrar, recuperación de contraseña y Crear cuenta (`#registro`) en una sola página; `registro.html` solo redirige |
| `user.html` | Inicio · Mi perfil (4 sub-pestañas) · Calendario · Entregas · Mi cuenta |
| `secretario.html` | Lo anterior + Distrito (Personas / Ranking de distritos) · Tareas del distrito |
| `admin.html` | Panel · Evaluar · Tareas · Personas · Calendario · Reportes · Configuración: Períodos, Actividades, Rúbrica, Roles y perfiles, Distritos, Gestiones · Mi cuenta · modal de entrada (gestión/período) |

## Resultado de las comprobaciones

- `npm run todo` (tools/pruebas): SQL 0015–0018 (58 + 79 + 19 + 26) y front (45 + 59, **8 comprobaciones nuevas** de estructura) — todas correctas.
- `node tools/contraste.js`: 170 pares, sin fallos.
- Barrido de layout con `audit-layout.js` tras los cambios: sin overflow horizontal ni controles sin nombre ni texto bajo 12,8 px en admin (390, 768, 1024), miembro (320) y secretaría (320).

## Pendientes

- **Desplegar**: producción no tiene el rediseño. Revisar el preview de Vercel (requiere sesión) antes de fusionar.
- Campos en tema oscuro: el relleno `--surface-2` sobre `--surface-1` no llega a 3:1 como límite de campo (WCAG 1.4.11). No se tocó para no cambiar la identidad; decidir.
- Calendario a 320 px: las celdas de día miden 35×54 (cuadrícula de 7 columnas); cumple WCAG 2.2 AA (24 px) pero no los 44 px del proyecto.
- Estilos en línea que quedan en `admin.html` (modales) y la mezcla de alias antiguos (`--s1`, `--glass`…, ~263 referencias según CLAUDE.md).
- Cabeceras de Inicio y Mi perfil no llevan `h1` (el hero lleva el saludo); valorar un `h1` visible o `sr-only`.
- No se probó con un lector de pantalla real, ni la app desplegada, ni Safari/Firefox.

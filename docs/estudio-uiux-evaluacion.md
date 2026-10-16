# Estudio UI/UX y de sistemas de evaluación

**Portal de CELIDER 08 Santiago (EIGHT CREATORS LABs)** · Fase 0 del rediseño · para aprobar antes de tocar el código

---

## 0. Resumen

1. El sitio ya mide bien lo importante (competencias comunes y del rol, escala con anclas, comparación dentro del rol, tareas como evidencia). Lo que falla es **cómo se lee y se usa**: siglas que nadie entiende, pantallas que se mueven, gráficos que no responden preguntas y formularios que parecen de otra aplicación.
2. Un buen sistema de evaluación es un **ciclo**, no un formulario: planificar → evidenciar → evaluar → calibrar → publicar → retroalimentar → mejorar. Hoy el sitio cubre bien "evidenciar" y "evaluar", cubre a medias "publicar" y casi no cubre "calibrar", "retroalimentar" ni "mejorar" (la persona no ve hacia dónde va).
3. La consistencia visual se rompe porque cada pantalla se construyó con sus propios componentes: más de 15 clases de botón, 7 cabeceras de pantalla distintas y 4 formas de listar datos. Se propone **un solo juego de componentes** (6 botones, 1 campo, 1 lista, 1 tarjeta, 1 etiqueta, 1 cabecera) y que todo lo existente se reduzca a él.
4. Las actividades, los períodos y el calendario están entrelazados por herencia (un "período NN" con cuatro fechas fijas). Se separan: **los períodos son ciclos de evaluación; las actividades son eventos del calendario**.
5. Se adoptan el isotipo de CELIDER 08 y el pack Remix Icon; nunca emojis.

---

## A. Sistemas de evaluación

### A.1 Qué evalúa hoy el sitio

**Rúbrica por roles (v2)** — para períodos nuevos.

- 24 criterios: **5 comunes** (núcleo, iguales para todos) y **19 técnicos** (cada rol usa los suyos).
- Escala 1–5 con descripción en 1, 3 y 5 (2 y 4 son intermedios). Un criterio que no aplica **se excluye**, nunca vale 0.
- Cada rol tiene un **perfil** versionado: pesos técnicos que suman 100. Un perfil usado no se edita; se crea una versión nueva.
- Resultado calculado en la base de datos: Núcleo, Técnico, Individual = 60 % técnico + 40 % núcleo, **Percentil dentro del rol**, General = 40 % núcleo + 60 % percentil. Roles con menos de 4 personas: el percentil se sustituye por el técnico y se avisa.
- **Tareas** como evidencia (plazos, devoluciones, iniciativa propia) y **puntos 0–10** al aprobar; son hechos para quien evalúa, no entran en ninguna fórmula.

**Clásica (legacy)** — períodos anteriores: 7 criterios de 1 a 4 más 2 de bono, nivel por 26/20/11. No se modifica.

### A.2 Sistemas de referencia

| Sistema | Qué es | Aporta | Riesgo | ¿Lo tiene el sitio? | Decisión |
|---|---|---|---|---|---|
| **Competencias con anclas conductuales (BARS)** | Cada nivel de cada criterio se describe con conductas observables | Evaluaciones comparables y explicables | Mucho texto si no se muestra bien | **Sí** (anclas 1-3-5) | Mantener y **mostrar las anclas** al evaluar y al evaluado |
| **Retroalimentación 360** | Pares, supervisores y la propia persona opinan | Visión completa, detecta puntos ciegos | Carga alta, sesgo social en grupos pequeños | No | Proponer **autoevaluación opcional** como futuro; no implementar ahora |
| **Objetivos / OKR** | Metas medibles por período | Dirección y conversación | Convierte la evaluación en burocracia | Parcial (las tareas son metas pequeñas) | Las **tareas** cumplen ese papel; no añadir módulo de OKR |
| **Gestión continua (check-ins)** | Conversaciones y registros frecuentes, no solo al cierre | Menos sorpresas, mejora durante el período | Requiere hábito | Parcial (tareas, devoluciones, comentarios) | Hacer **visible el avance durante el período** (tendencia, tareas, comentarios) |
| **Calibración** | Revisar entre evaluadores para que midan igual | Justicia entre roles y distritos | Si se fuerza una curva, se premia la competencia, no el crecimiento | No | Dar al admin una **vista de calibración** (distribución, comparación por rol/distrito) sin curva forzada |
| **Portafolio / evidencia** | Trabajo real como base de la nota | Objetividad | Subir archivos pesa | Sí (tareas y entregas) | Mantener; enlazar la evidencia desde el criterio que alimenta |

### A.3 Principios que guían el diseño

1. **Conducta observable, no etiqueta.** El evaluador ve qué significa un 1, un 3 y un 5 mientras puntúa.
2. **Evidencia antes que memoria.** Plazos, devoluciones y entregas aparecen junto al criterio que informan, sin puntuar solos.
3. **Se compara dentro del rol.** Nunca un diseñador contra un redactor.
4. **Transparencia hacia la persona.** Sabe qué se mide, cómo, y por qué obtuvo su resultado.
5. **El número no es el mensaje.** Cada resultado se acompaña de dónde destaca y dónde tiene más margen.
6. **Ritmo claro.** Toda persona sabe en qué fase del ciclo está el período y qué fecha sigue.
7. **Cuidado con los grupos pequeños.** Con pocas personas por rol se avisa en lugar de aparentar precisión.

### A.4 Brechas y recomendación

| # | Brecha | Recomendación | Fase |
|---|---|---|---|
| 1 | La persona no ve **hacia dónde va** (tendencia) | Tendencia entre períodos en el perfil y en el Panel | 3 y 5 |
| 2 | El admin no puede **calibrar** | Distribución de niveles, comparación por rol y por distrito, mapa de calor persona × criterio | 3 |
| 3 | Las anclas están "escondidas" | Mostrarlas al evaluar y en el perfil ("¿Cómo se puntúa?") | 2 |
| 4 | Siglas (PLA, REV…) impiden entender qué se mide | Nombres completos en todas partes | 2 |
| 5 | El evaluador pierde el contexto al cambiar de persona (la pantalla se mueve) | Cabecera y filtros fijos; lista y formulario con scroll propio | 2 |
| 6 | No hay forma de ver "a quién me falta evaluar y por qué" | Filtros predeterminados con conteo (por estado, rol, distrito, por revisar, vencidas…) | 2 |
| 7 | Reportes solo existen para la rúbrica clásica | Reporte completo también para rúbrica por roles | 3 |
| 8 | Autoevaluación y metas | **Propuesta futura** (no se implementa ahora) | — |

### A.5 El ciclo en pantalla

| Fase del ciclo | Evaluado | Evaluador (secretaría) | Administración |
|---|---|---|---|
| **Planificar** | Ve el calendario y su rúbrica ("qué se mide") | Asigna tareas y fechas a su distrito | Crea el período, elige modelo y fechas |
| **Evidenciar** | Entrega tareas con enlace o nota | Revisa y aprueba con puntos | Ve avance y vencidas en el Panel |
| **Evaluar** | — | — | Puntúa con anclas y evidencia a la vista |
| **Calibrar** | — | — | Compara roles y distritos, detecta desvíos |
| **Publicar** | Recibe su resultado | Ve su distrito | Publica |
| **Retroalimentar** | Lee comentarios y dónde mejorar | Conversa con su gente | Ve el cierre en Reportes |
| **Mejorar** | Ve su tendencia y su siguiente período | — | Compara períodos |

---

## B. Estudio UX

### B.1 Quién usa qué y para qué

| Persona | Trabajo principal | Lo que más necesita | Hoy le cuesta |
|---|---|---|---|
| **Creador** (miembro) | Saber cómo va y qué le toca | Un resultado entendible, lo próximo a entregar, su evolución | Siglas, no ve las anclas, el calendario es solo de lectura |
| **Secretaría** (evaluador de distrito) | Revisar entregas de su gente | Pendientes por revisar, personas con problemas, un calendario donde asignar | Personas como pared de tarjetas, sin atajos para asignar |
| **Administración** | Evaluar, calibrar, publicar y configurar | Avance del período de un vistazo, cola de trabajo, comparar | Panel sin gráficos, Evaluar se mueve, configuración con tablas viejas |

### B.2 Mapa de fricciones (lo que señaló el usuario y lo que se encontró)

| # | Pantalla | Problema | Causa | Solución | Fase |
|---|---|---|---|---|---|
| 1 | Panel | Sencillo, sin gráficos útiles y con espacio vacío | KPIs y barras CSS; no hay gráficos | Embudo, histograma de niveles, comparación por rol, radar, tendencia | 3 |
| 2 | Rúbrica / Criterios / informes | PLA, REV, EDI… no se entienden | Se pinta `abbr` en 15 sitios | Nombre completo siempre; adaptar anchos | 2 |
| 3 | Evaluar | Pocos filtros; la pantalla se mueve al elegir a alguien; iconos tipo emoji | `scrollIntoView`, re-render completo, barras no fijas, 🥇🥈🥉 | Cabecera fija, filtros con conteo, paneles con scroll propio, iconos Remix | 2 |
| 4 | Personas / Perfil | Tarjeta exterior e interior poco claras | Lista de filas con anillo; cabecera pesada | Tarjeta con estado y pendientes; perfil sobrio con "lo que sigue" | 5 |
| 5 | Calendario | Estático; leyenda atada a la marca | Solo hitos y tareas; sin actividades | Crear actividad o asignar tarea desde el día; etiquetas con colores propios | 4 |
| 6 | Reportes | Pobre y solo para la rúbrica clásica | `.rpt-page` solo legacy | Constructor de reporte, vista A4, v2 | 3 |
| 7 | Períodos | Se crean con un formulario viejo; mezcla modelos | Modal sin guía; fechas duplicadas con `calendario` | Asistente corto; separar "por roles" de "clásicos" | 4 |
| 8 | Actividades | Depende de los PE ("Período NN") | Tabla `calendario` con número de período | Tabla `actividades` independiente | 4 |
| 9 | Rúbrica | Poco intuitiva | Tabla + tarjetas separadas | Por tipo (comunes / del rol) con anclas visibles | 2 |
| 10 | Roles | Tabla simple sin contexto | `renderRoles` aislado de Perfiles | Tarjeta por rol: personas, perfil vigente, pesos | 2 |
| 11 | Global | Botones, esquinas y campos distintos | Cada pantalla trae sus clases | Componentes canónicos (sección C) | 1 |
| 12 | Global | Isotipo antiguo (Eight Creators) | — | Isotipo de CELIDER 08 | 1 |

### B.3 Arquitectura de información propuesta

| | Creador | Secretaría | Administración |
|---|---|---|---|
| **Hoy** | Inicio · Mi perfil · Calendario · Entregas | + Distrito · Tareas | Panel · Evaluar · Tareas · Personas · Calendario · Reportes · Configuración (Períodos, Actividades, Rúbrica, Perfiles, Roles, Distritos, Gestiones) |
| **Propuesta** | Sin cambios (mejoras internas) | Sin cambios (Personas pasa a lista con estado) | **Configuración** se ordena por intención: *Ciclo* (Períodos, Actividades), *Medición* (Rúbrica, Roles y perfiles), *Estructura* (Distritos, Gestiones). **Roles y Perfiles se fusionan** en una experiencia. |

### B.4 Lenguaje

| Hoy | Mejor | Dónde |
|---|---|---|
| PE, PE4 | "Período 4" (con "PE4" como atajo) y su rango de fechas | Barras de período |
| Núcleo | **Competencias comunes** | Rúbrica, perfil, Panel |
| Técnico | **Competencias del rol** | Rúbrica, perfil, Panel |
| Percentil | **Posición en tu rol** (con explicación) | Perfil |
| Rol pequeño | "Pocas personas en este rol" | Avisos |
| PLA / REV / EDI… | Planificación / Revisión / Edición Creativa… | Todas las pantallas |
| Legacy / v2 | **Clásica** / **Por roles** | Períodos |
| Gestión | **Año de gestión** | Selector |

---

## C. Homogeneidad: qué hay y a qué se reduce

### C.1 Inventario (resumen)

- **Botones**: `btn-save`, `btn-cfg-add`, `btn-cfg-cancel`, `btn-icon`, `tk-btn`, `tk-btn--main`, `cal2-btn`, `cal2-btn--hoy`, `eval-chip`, `cal2-chip`, `tk-chip`, `perfil-accion`, `rpt-pe-btn`, `pb`, `seg-btn`, `chip`, `btn-login`, `btn-pass-toggle`, `btn-add-evento`, `btn-save-cal`… (más de 15 clases con alturas, radios y rellenos distintos).
- **Cabeceras de pantalla**: `ptitle`, `tab-title`, `page-header`, `cfg-toolbar`, `eval-pe-bar`, `admin-pe-bar`, `rpt-toolbar`.
- **Listas y tablas**: `tbl` (rejilla de 4 columnas), `v2-tabla`, tablas del reporte, `roster/pcard`, `eval-ucard`, `lista-aj/fila-aj`.
- **Tarjetas**: `scard`, `kpi-card`, `v2-kpi`, `pf-card`, `atencion-item`, `ov-*`, `dist-*`.
- **Campos**: `cfg-inp`, `search-inp`, `field input`, `tk-campo`, selects nativos en los modales del admin, estilos en línea con alias viejos (`--s2`, `--faint`) en `admin.html`.
- **Iconos**: pack Phosphor + 🥇🥈🥉🏆 como emoji, ✓ ▾ ← como texto.

### C.2 Componentes canónicos (todo se reduce a esto)

| Componente | Variantes | Regla |
|---|---|---|
| **Botón** | primario (coral) · secundario (contorno) · texto · destructivo · icono (círculo) · chip (filtro) | Alto 44 o 48, píldora; **un primario por vista** |
| **Campo** | texto · selector · área · casilla · interruptor | Alto 48, radio 12 (o píldora si es búsqueda), borde solo al enfocar |
| **Lista** | fila de ajustes (título + descripción + indicador) | Un contenedor redondeado, divisores finos |
| **Tarjeta** | estándar · KPI · persona | Radio 20, sin sombra, una elevación |
| **Contenedor** | lista, tabla, calendario, panel | Radio 28, recorta su contenido |
| **Ventana** | modal · panel lateral · buscador | Radio 32, pie fijo con acciones |
| **Etiqueta** | estado · rol · etiqueta de color | Píldora con punto; el color tiene sentido |
| **Cabecera** | título + contexto + **una** acción primaria | Misma estructura en todas las pantallas |
| **Gráfico** | barras · radar · línea · mapa de calor | Colores por token; texto alterno obligatorio |

---

## D. Especificación de diseño

### D.1 Color

- **Marca** (70/30/10): azules profundos y cianes para superficies y datos; **coral solo** para la acción principal, el período actual y los estados que piden atención. Texto sobre coral: azul marino.
- **Etiquetas del calendario y de actividades**: aquí **no hay que amarrarse a la marca**. Se propone una paleta de 8 tonos con nombre y significado, calculada para contraste en ambos temas (se mide en la Fase 1):

| Etiqueta (ejemplo) | Tono | Sentido |
|---|---|---|
| Entrega | coral | Fecha límite |
| Jornada / evento | violeta | Actividad presencial |
| Capacitación | verde | Aprendizaje |
| Reunión | ámbar | Coordinación |
| Hito del período | cian | Inicio, cierre |
| Tarea | azul | Trabajo asignado |
| Vencida | rojo | Atención |
| Personal / otra | gris azulado | Sin categoría |

Las etiquetas son **editables** (nombre + tono de la paleta), así cada equipo las crea con sentido.

### D.2 Iconografía

Pack **Remix Icon** (trazo para reposo, relleno para activo). Nunca emojis ni caracteres como icono. Medallas: icono de trofeo/medalla con color de posición.

### D.3 Gráficos: cada uno responde una pregunta

| Pregunta | Gráfico | Dónde |
|---|---|---|
| ¿Cómo va el avance del período? | Embudo pendiente → borrador → publicado | Panel |
| ¿Cómo se distribuye el equipo? | Histograma por nivel (87/67/37) | Panel, reporte |
| ¿Hay diferencias entre roles o distritos? | Barras agrupadas | Panel (calibración), reporte |
| ¿Qué tan equilibrada es una persona? | Radar comunes vs. del rol | Perfil, reporte |
| ¿Estamos mejorando? | Línea entre períodos | Panel, perfil |
| ¿Dónde está el equipo fuerte o débil? | Mapa de calor persona × criterio | Panel (calibración) |

### D.4 Calendario y actividades

- Cada día ofrece: **Nueva actividad**, **Asignar tarea** (secretaría y admin) o **Mi iniciativa** (creador).
- Una actividad tiene título, descripción, fecha o rango, **etiqueta** y es independiente de los períodos.
- Las tareas siguen perteneciendo a un período: si el día cae fuera de uno, el formulario pide elegirlo (por defecto, el activo).
- La leyenda se construye con las etiquetas existentes y filtra el calendario.

### D.5 Períodos

- Crear = **asistente corto**: nombre → modelo (Por roles / Clásica, con explicación) → fechas (inicio ≤ fin de trabajo ≤ entrega ≤ jornada, con selector de fecha real) → copiar fechas del anterior → activar.
- La lista separa **Por roles** (con rúbrica y tareas) de **Clásicos** (anteriores, solo lectura de comportamiento) y muestra una línea de tiempo.
- Las fechas del período dejan de duplicarse en la tabla `calendario`.

---

## E. Alcance y orden

| Fase | Contenido | Migración |
|---|---|---|
| 1 | Componentes canónicos, isotipo CELIDER 08, Remix Icon, etiquetas (tokens) | — |
| 2 | Evaluar, Rúbrica, Roles y perfiles, nombres completos | — |
| 3 | Panel y Reportes con gráficos | — |
| 4 | Calendario, Actividades, Períodos | **0018** (actividades y etiquetas) |
| 5 | Personas y perfil | — |

**No entra ahora** (propuestas futuras): autoevaluación, retroalimentación 360, metas por período.

**Decisiones ya tomadas**: actividades en tabla nueva; tareas siguen ligadas a un período; Remix Icon; entrega por fases con commit y enlace de prueba en cada una.

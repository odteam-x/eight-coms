# 14 · Glosario y pendientes

## 14.1 Glosario

| Término | Significado |
|---|---|
| **Administración** | Tipo de acceso con `es_admin = true`. Gestiona todo y **no se evalúa** |
| **Aprobado / acceso pendiente** | `profiles.aprobado`: hasta que la administración aprueba, la persona no entra |
| **Aviso** | Notificación (campana y, según el tipo, correo) |
| **Bandeja de trabajo** | Lista en el Inicio de la secretaría con lo que puede resolver hoy en su distrito |
| **Borrador / Publicada** | Estados de una evaluación. Solo la publicada cuenta |
| **Cobertura** | Criterios puntuados de los que aplicaban a una persona |
| **Colectiva** | Tarea de equipo: una sola fila para todo el grupo |
| **Criterio** | Competencia que se puntúa. **Núcleo** (5, iguales para todos) o **técnico** (propios del rol) |
| **Distrito** | Agrupación de personas; tiene evaluación y ranking propios |
| **Esencial / opcional** | Tipos de aviso: los esenciales no se pueden apagar |
| **Excepción de rol** | Tarea asignada por la administración con un rol que la persona no tiene habilitado |
| **Gestión** | El año de trabajo; contenedor de períodos, criterios, perfiles y calendario |
| **Gafete** | Identificación con QR verificable públicamente |
| **General** | Resultado que mezcla núcleo y percentil (y tareas) |
| **Individual** | Resultado que mezcla técnico y núcleo (y tareas) |
| **Iniciativa propia** | Tarea creada por la propia persona; solo cuenta cuando otra la aprueba |
| **Modelo (`v2` / `legacy`)** | Rúbrica por roles o clásica de un período |
| **Nivel** | Excelente / Bueno / En proceso / Bajo según los cortes de cada escala |
| **Nota de tareas** | Resumen 0–100 de las tareas aprobadas con puntos |
| **Núcleo** | Las cinco competencias transversales |
| **PE** | Período de evaluación (PE1, PE2…) |
| **Percentil** | Posición de la persona dentro de su rol, 0–100 |
| **Perfil de evaluación** | Pesos de los criterios técnicos de un rol; versionado e inmutable si se usó |
| **Participación** | Si una persona toma parte en un PE; si no, el PE «no existe» para ella |
| **Preferencias de rol** | Lo que la persona querría hacer; información, nunca un permiso |
| **Rectificar** | Corregir una evaluación publicada con motivo y versión nueva |
| **RLS** | Seguridad por fila de la base de datos: decide qué filas ve y escribe cada persona |
| **Rol funcional** | Tipo de acceso (miembro, secretaría, administración) |
| **Rol operativo** | Lo que se hace en el equipo (Fotografía, Redacción…): principal y, desde 0062, un segundo |
| **Rol pequeño** | Rol con menos de 4 personas evaluadas: percentil = técnico |
| **Secretaría de distrito** | Tipo de acceso con distrito: supervisa y gestiona a su distrito |
| **Seguimiento** | Pantalla «¿quién está al día?» |
| **Desempeño** | Pantalla «¿cómo les va?» |
| **Tiempo real** | Los portales se actualizan solos cuando otra persona cambia algo |

## 14.2 Decisiones pendientes del dueño

| # | Decisión | Estado hoy |
|---|---|---|
| 1 | **Peso de las tareas** en el resultado de los PE nuevos | 20 % provisional, marcado «sin confirmar» hasta que se guarde |
| 2 | **Activar «sin tareas calificadas se pierden los puntos»** en un PE concreto | Apagada por defecto; antes asignar tareas a todos |
| 3 | **Ranking de distritos**: ¿público para todo el equipo o solo para secretarías y administración? | La base lo permite; la pantalla lo reserva |
| 4 | **Zona horaria** oficial para «a tiempo» y fechas límite | `America/Santiago` por defecto, por confirmar |
| 5 | **Entrega tardía**: ¿penalización, etiqueta, o nada? | Solo se mide y se muestra |
| 6 | **Percentil por técnico o por resultado con tareas** (D-5) | Por técnico |
| 7 | **Estados «validada/cerrada»** de las estadísticas de Instagram y quién las cierra | Sin definir |
| 8 | **Recursos** (antes banco de imágenes): ¿lo lee todo el mundo o por rol/distrito? | Lee toda persona aprobada (provisional) |
| 9 | **Umbrales de puntuaciones atípicas** (alertas) | Sin definir |
| 10 | **Reorganización propuesta** (capítulo 13) | A decidir por el dueño |

## 14.3 Pendientes técnicos y de configuración

| Pendiente | Quién |
|---|---|
| **Google Wallet**: crear la cuenta emisora y cargar los secretos (el dueño decidió no trabajarlo por ahora) | Dueño |
| Activar en Supabase Auth la **protección contra contraseñas filtradas** | Dueño |
| **Límite de correo** (~100 por día con el Gmail actual): pasar a un proveedor transaccional si crece | Dueño |
| **Verificación en vivo** de la sincronización con dos sesiones; del aspecto en un iPhone real; del tema claro pantalla por pantalla | Dueño |
| Manual de administración: lo escribe el dueño; el texto vive en la tabla `manuales_privados` (se publica ejecutando el SQL generado antes de desplegar la carcasa) | Dueño |
| Revisar el estado real de los `fix-*.sql` sueltos y de **huérfanos al borrar personas** contra la base viva | Dueño / sesión con acceso |
| Atender detalles de interfaz conocidos: el botón de cerrar tapa la última letra del título de la bienvenida en celular | Desarrollo |

## 14.4 Lo que no se pudo verificar

- **La base de datos en vivo**: las descripciones salen de leer el código y las migraciones y de pruebas con Postgres real simulado (PGlite) y datos de ejemplo; no de consultas a producción. El dueño aplicó todas las migraciones hasta la 0064 y confirmó el resultado, pero **no se leyeron las tablas reales**.
- **La publicación real de Realtime** y su comportamiento con latencia real.
- **Dispositivos reales**: todo se observó en el simulador (320 a 1920 px).
- **El envío real de correos** con volumen y el comportamiento de `pg_cron` en producción.
- **Google Wallet** (sin configurar).

## 14.5 Qué no existe (para que nadie lo busque)

- **«Solicito tu ayuda»**: no está en el repositorio.
- **Apple Wallet** (`.pkpass`): requiere un certificado de pago de Apple.
- **Archivos adjuntos** en tareas y equipos: solo enlaces y notas.
- **Reenvío del correo de confirmación** desde el portal.
- **Penalización por entrega tardía**.
- **Pertenencia de personas a una gestión concreta** (`gestion_miembros`, diseñada y pendiente a propósito).
- **Pantalla del historial de correcciones** de estadísticas de Instagram (los datos sí se guardan).
- **Una segunda fórmula en el cliente**: el cálculo de la rúbrica por roles solo existe en la base (la clásica y el distrito se calculan en el cliente, y es una inconsistencia conocida).

## 14.6 Dónde seguir leyendo

| Tema | Documento |
|---|---|
| Reglas de trabajo y trampas aprendidas (para quien desarrolle) | `CLAUDE.md` |
| Arquitectura resumida | `docs/documentacion-tecnica.md` |
| Estado y pendientes a noviembre | `docs/estado-del-sistema-2026-11.md` |
| Auditoría (H-01…H-12, matrices) | `docs/auditoria/` |
| Tiempo real | `docs/sincronizacion-tiempo-real.md` |
| Notificaciones y correo | `docs/notificaciones-contrato.md`, `docs/configurar-correos.md` |
| Google Wallet | `docs/google-wallet.md` |
| Estudio de interfaz | `docs/estudio-uiux-evaluacion.md`, `docs/sistema-visual-noviembre-2026.md` |
| Manuales de uso | `ayuda/miembro.html`, `ayuda/secretario.html` (el de administración es privado) |

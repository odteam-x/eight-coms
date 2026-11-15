# Estado del sistema — revisión de noviembre de 2026

Revisión completa del portal (eight-coms.vercel.app): qué está hecho, qué está a medias y qué falta. Se apoya en la auditoría de `docs/auditoria/` (H-01…H-12), en el registro de migraciones (`docs/auditoria/06-registro-migraciones.md`) y en el trabajo posterior (PR #9 a #16). La descripción técnica vigente está en [`documentacion-tecnica.md`](documentacion-tecnica.md).

**Qué NO se pudo verificar desde el repositorio** (hay que comprobarlo en el entorno real): el aspecto en un iPhone real (franja del notch), el correo en producción con volumen, Google Wallet (falta la cuenta emisora y los secretos), y los trabajos programados (`pg_cron`) en su ejecución real.

## 1. Hecho y en producción

| Área | Estado |
|---|---|
| Seguridad (RLS, funciones SECURITY DEFINER, anon limitado, CSP sin código en línea, SRI) | Hecho; probado con `cadena.mjs` y pruebas SQL |
| Motor de evaluación único en SQL (v2), niveles, rectificación con versiones, cobertura | Hecho (0053–0056, 0059 corrige el id UUID) |
| Tareas individuales y de equipo, notas con historial, reglas por período | Hecho (0031–0036, 0061) |
| Texto largo en tareas (20.000 caracteres, «Ver todo») | Hecho (0060) |
| Distritos: evaluación, ranking, estadísticas de Instagram con capturas | Hecho |
| Notificaciones por campana y correo, preferencias, recordatorios | Hecho; límite de Gmail (~100 al día) |
| Tres temas (oscuro, claro, rosa), tarjeta de vidrio única, aviso del notch en iPhone | Hecho; notch sin confirmar en iPhone real |
| Manuales de miembro, secretaría y administración (privado) | Actualizados en esta revisión |

## 2. En revisión (PR abiertos, nada fusionado sin tu orden)

| PR | Contenido |
|---|---|
| #12 | Evaluar muestra la nota de tareas y su peso |
| #15 | Fondo de diálogos y avisos según el tema + dos contrastes del tema claro |
| #16 | Gafete y página de verificación con la línea gráfica nueva |
| Esta rama | Documentación técnica, este estado y los manuales actualizados |

## 3. Qué falta (priorizado)

**Decisiones tuyas (bloquean o cambian resultados)**
1. Activar «sin tareas calificadas, se pierden los puntos» en el PE que corresponda (primero asignar tareas a todos y dejar «cuentan las iniciativas propias» en Sí).
2. Confirmar el peso de tareas de los períodos nuevos (hoy 20 % «sin confirmar»; los antiguos tienen 0 %).
3. Ranking de distritos: ¿público para todos o solo para secretarías y administración? (B-05 de la auditoría).
4. Zona horaria oficial para fechas límite y cortes de período.

**Configuración externa**
5. Google Wallet: crear la cuenta emisora y cargar los secretos de la función `gafete-wallet`. Apple Wallet no está previsto (exige certificado de pago de Apple).
6. Activar la protección contra contraseñas filtradas en Supabase Auth.
7. Si el correo supera el límite de Gmail, pasar a un proveedor transaccional.

**Técnico pendiente**
8. Tema claro: se auditaron contrastes (172 pares correctos más los dos arreglados en #15), pero la concordancia visual pantalla por pantalla depende de capturas tuyas de lo que se vea raro.
9. Estados «validada» y «cerrada» de las estadísticas de Instagram, y alertas por puntuaciones atípicas (decisión de negocio previa).
10. Inventario de scripts `fix-*.sql` sueltos y su estado real en la base viva (H-07).
11. Huérfanos al borrar personas (H-06): comprobar con la base viva.
12. El conector de Supabase de las sesiones de trabajo no tiene permiso de escritura: las migraciones siguen aplicándose a mano en el SQL Editor.

## 4. Riesgos conocidos

- La base de producción y el repositorio pueden divergir si una migración se aplica a mano y no se registra: cada migración se anota en `docs/auditoria/06-registro-migraciones.md` al crearla; tras aplicarla, confirmar en `list_migrations`.
- `stub.sql` de pruebas usa `evaluaciones.id` BIGINT mientras producción usa UUID: toda prueba que toque ese id debe convertirlo (como `sql-0059.mjs`).
- El manual de administración es privado: tras regenerarlo hay que ejecutar `.manuales-privados/admin.sql` en el SQL Editor **antes** de publicar la carcasa.

## 5. Pruebas

Últimas corridas relevantes: `sql-0059` (15), `sql-0060` (13), `sql-0061` (21), `front-texto-largo` (13), `front-reglas-tareas` (5), `front-equipos` (60), `front-tema` (34), `front-gafete` (25), `front-manual` (13), `contraste.js` sin fallos. Comando general: `npm run todo`.

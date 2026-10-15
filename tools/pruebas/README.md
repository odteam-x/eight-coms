# Pruebas de migraciones y UI

El sitio no tiene build ni `npm` y esto no lo cambia: esta carpeta es **solo para
desarrollo**. Tiene su propio `package.json` y no se despliega con nada (nadie la enlaza).

```bash
cd tools/pruebas
npm install
npm run todo      # SQL (0015 y 0016) + helpers de core/rubrica.js
npm run ui        # sitio real en http://localhost:3100 con un Supabase simulado
```

## Qué prueba cada cosa

| Archivo | Qué ejecuta | Cuántas |
|---|---|---|
| `sql-0015.mjs` | La migración `0015_rubrica_v2.sql` y su seed, en un Postgres real (PGlite): **solo períodos nuevos** (los existentes quedan legacy y bloqueados), suma de pesos = 100, perfiles inmutables, validación 1–5, perfil fijado por el servidor, versionado, `resultados_periodo` (núcleo, técnico, percentil con empates, regla de roles pequeños, visibilidad por rol, rechazo sin sesión) y el clonado de `abrir_gestion` | 58 |
| `sql-0016.mjs` | `0016_tareas.sql` con roles reales (`SET ROLE authenticated/anon`) para que **la RLS cuente**: **solo períodos v2** (sin copiar trabajos viejos), quién asigna a quién, quién ve qué, transiciones, que nadie apruebe lo suyo, prórrogas con motivo, historial append-only, entrega inmutable tras entregar, bloqueo, borrado, gestión archivada, resumen de evidencia, zona horaria | 79 |
| `front.mjs` | Los helpers de presentación de `core/rubrica.js` (niveles, perfil vigente, criterios aplicables, HTML escapado, rankings) y que los ids/acciones del HTML nuevo existan | 47 |

`stub.sql` **no es el esquema real**: reproduce lo mínimo que 0015 y 0016 necesitan de
las migraciones anteriores. Si cambias una función de la que dependen (`is_admin`,
`get_district_member_ids`, `gestion_escribible`…), actualiza el stub.

## La UI con backend simulado

`ui/server.mjs` sirve el repo real con los mismos headers de `vercel.json` (CSP
enforcing incluida: un `onclick` inline o un script de otro origen fallaría aquí igual
que en producción) y sustituye únicamente `supabase-client.js` por
`ui/fake-supabase-client.js`, un motor en memoria con datos de ejemplo.

Entra con `?as=`: `admin.html?as=admin`, `secretario.html?as=sec`, `user.html?as=m1`
(`m1`…`m5` fotógrafos, `r1`…`r3` redactores). El simulador implementa las fórmulas de
`resultados_periodo` y las transiciones de tareas **para que la UI tenga algo que
pintar**; las reglas de verdad las prueban los `sql-*.mjs`. Para ver cómo se comporta
el frontend desplegado antes que el SQL, borra una tabla del simulador desde la consola
(`delete __FAKE.DB.tareas`) y recarga la pestaña.

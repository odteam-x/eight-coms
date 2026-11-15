import fs from 'node:fs'; import path from 'node:path';
const dir='supabase/migrations'; const files=fs.readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f) && !/PENDIENTE/.test(f)).sort();
const fn=new Map(), tb=new Map(), col=new Map();
for(const f of files){ const n=parseInt(f.slice(0,4)); if(n<15) continue; const s=fs.readFileSync(path.join(dir,f),'utf8').replace(/--.*$/gm,'');
  for(const m of s.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)\s*\(/gi)) if(!fn.has(m[1])) fn.set(m[1],f.slice(0,4));
  for(const m of s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_0-9]+)/gi)) if(!tb.has(m[1])) tb.set(m[1],f.slice(0,4));
  for(const m of s.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.([a-z_0-9]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi)) col.set(m[1]+'.'+m[2],f.slice(0,4)); }
const q=a=>a.map(([k,v])=>`('${k}','${v}')`).join(',\n  ');
const sql=`-- DIAGNÓSTICO DE LA BASE (solo lectura). Pégalo en Supabase → SQL Editor y pulsa Run. Devuelve UNA fila por cosa que FALTA
-- (si no devuelve filas, todo lo que las migraciones 0015–0058 crean existe). La columna «migracion» dice cuál aplicar.
-- Generado desde supabase/migrations por tools/generar-diagnostico.mjs. No modifica nada.
WITH esperadas_fn(nombre, migracion) AS (VALUES
  ${q([...fn])}
), esperadas_tb(nombre, migracion) AS (VALUES
  ${q([...tb])}
), esperadas_col(tabla_col, migracion) AS (VALUES
  ${q([...col])}
)
SELECT 'función' AS tipo, e.nombre, e.migracion FROM esperadas_fn e
 WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = e.nombre)
UNION ALL
SELECT 'tabla', e.nombre, e.migracion FROM esperadas_tb e
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = e.nombre)
UNION ALL
SELECT 'columna', e.tabla_col, e.migracion FROM esperadas_col e
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = split_part(e.tabla_col, '.', 1) AND c.column_name = split_part(e.tabla_col, '.', 2))
ORDER BY 3, 1, 2;
`;
fs.writeFileSync('supabase/diagnostico.sql', sql); console.log('funciones',fn.size,'tablas',tb.size,'columnas',col.size);

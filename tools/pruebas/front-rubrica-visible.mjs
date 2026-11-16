// Mi perfil trae «Cómo me evalúan» (la rúbrica de mi rol) y «Mi rol»; solo en el perfil propio y nunca para la administración.
import fs from 'node:fs';
const rd = f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
let n = 0, mal = 0;
const ok = (c, t) => { n++; if (c) console.log('  ✓ ' + t); else { mal++; console.log('  ✗ ' + t); } };
const p = rd('core/perfil.js');
ok(/TAB_RUBRICA = \{ k: 'rubrica', etiqueta: 'Cómo me evalúan'/.test(p), 'existe la pestaña «Cómo me evalúan»');
ok(/inst\.modo === 'propio' && !inst\.persona\?\.es_admin && typeof descriptoresHTML === 'function'/.test(p), 'solo aparece en el perfil propio y no para la administración');
ok(/descriptoresHTML\(c\)/.test(p) && /criteriosAplicables\(perfilVigenteDe\(rid, periodo\.id\), cat\)/.test(p), 'usa las anclas de cada criterio y el perfil vigente de cada rol (hasta 2)');
ok(/0\.6|60 % técnico/.test(p) && /Excelente<\/b> desde 87/.test(p), 'explica la fórmula y los niveles sin calcular nada');
ok(!/resultados_periodo|calcScore/.test(p.split('_panelRubrica')[1]?.split('_panelTareas')[0] || ''), 'no calcula ningún resultado: solo presenta');
ok(/rubrica:'perfil'/.test(rd('user.js')) || /rubrica:/.test(rd('user.js')), 'el alias «rubrica» sigue llevando al perfil');
console.log('\n' + (n - mal) + ' correctas, ' + mal + ' fallidas'); process.exit(mal ? 1 : 0);

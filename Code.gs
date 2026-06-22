// ═══════════════════════════════════════════════════════════════
//  EIGHT CREATORS LABs — Google Apps Script Backend
//  CELIDER Santiago · Sistema de Evaluación
// ═══════════════════════════════════════════════════════════════
//
//  HOJAS DEL SPREADSHEET:
//
//  USUARIOS (fila 1 = encabezado, datos desde fila 2):
//    A=usuario  B=contraseña  C=nombre  D=rol  E=distrito
//
//  CREATORS SCORE - PE1/PE2/PE3 (filas 1-3 encabezados, datos desde fila 4):
//    A=usuario  B=rol  C=distrito  D=nombre  E=area
//    F=pla  G=rev  H=edi  I=dis  J=flu  K=nar  L=eje  M=ext(bono)  O=estado
//
//  CREATORS FEEDBACK - PE1/PE2/PE3 (misma estructura):
//    A=usuario  B=rol  C=distrito  D=nombre  E=area
//    F=pla  G=rev  H=edi  I=dis  J=flu  K=nar  L=eje  M=ext
//
//  CREATORS DISTRITOS - PE1/PE2/PE3 (fila 1 = encabezado, datos desde fila 2):
//    A=distrito  B=CGO  C=CCT  D=COM  E=CEE  F=Total
//
//  CRITERIOS (sin encabezado):
//    A=key  B=label  C=abbr  D=color
//
//  TABLA DE PUNTUACIÓN Distritos (sin encabezado / fila 1 encabezado):
//    B=criterio  C=nivel4  D=nivel3  E=nivel2  F=nivel1
// ═══════════════════════════════════════════════════════════════

const SS_ID     = '1ZDj4OvA1lkdUKTU-hU24CY34CKekZKb_i0oGlcWNCdo';
const API_TOKEN = 'sti2026';

// ── Columnas de miembros en CREATORS SCORE / FEEDBACK (0-based) ──
const COL    = { pla:5, rev:6, edi:7, dis:8, flu:9, nar:10, eje:11, ext:12, estado:14 };
const COL_1B = { pla:6, rev:7, edi:8, dis:9, flu:10, nar:11, eje:12, ext:13 };

// ── Columnas de CREATORS DISTRITOS (0-based) ──
const DCOL    = { dist:0, cgo:1, cct:2, com:3, cee:4, total:5 };
const DCOL_1B = { cgo:2, cct:3, com:4, cee:5, total:6 };

// ── Filas ──────────────────────────────────────────────────────
const DATA_START_IDX = 3;   // fila 4 (0-based): inicio de datos en CREATORS SCORE

// ── Competencias de distrito ───────────────────────────────────
const DIST_COMPETENCIAS = [
  { key:'cgo', label:'Gestión y Organización "CGO"',    abbr:'CGO', color:'#38BDF8', max:7 },
  { key:'cct', label:'Creativa y Técnica "CCT"',        abbr:'CCT', color:'#2ECC71', max:7 },
  { key:'com', label:'Comunicativa "COM"',               abbr:'COM', color:'#C084FC', max:7 },
  { key:'cee', label:'Ejecución Estratégica "CEE"',     abbr:'CEE', color:'#F0C040', max:7 },
];

// ─────────────────────────────────────────────────────────────
//  HANDLERS HTTP
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  return processRequest((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  try {
    if (e.postData && e.postData.contents) params = JSON.parse(e.postData.contents);
  } catch(_) { params = e.parameter || {}; }
  return processRequest(params);
}

function processRequest(params) {
  if (params.token !== API_TOKEN) return jsonOut({ ok:false, error:'No autorizado' });
  var action = params.action || '';
  try {
    var result;
    switch (action) {
      case 'getData':                 result = getData();                                                                  break;
      case 'login':                   result = doLogin(params.usuario, params.pass);                                      break;
      case 'getSecretarioData':       result = getSecretarioData(params.usuario);                                         break;
      case 'getDistrictRanking':      result = getDistrictRanking(params.pe);                                             break;
      case 'getRubricaDistritos':     result = getRubricaDistritosAction();                                               break;
      case 'updateScore':             result = updateScore(params.pe, params.usuario, params.criterio, params.valor);     break;
      case 'updateFeedback':          result = updateFeedback(params.pe, params.usuario, params.criterio, params.texto);  break;
      case 'updateBulkScores':        result = updateBulkScores(JSON.parse(params.changes || '[]'));                      break;
      case 'updateDistrictScore':     result = updateDistrictScore(params.pe, params.distrito, params.competencia, params.valor); break;
      case 'updateBulkDistrictScores':result = updateBulkDistrictScores(JSON.parse(params.changes || '[]'));              break;
      case 'saveCalendario':          result = saveCalendario(JSON.parse(params.eventos || '[]'));                        break;
      // ── Nuevas acciones de configuración ──
      case 'saveCriterios':           result = saveCriterios(JSON.parse(params.criterios || '[]'));                       break;
      case 'saveRubrica':             result = saveRubricaSheet(JSON.parse(params.rubrica || '[]'));                      break;
      case 'saveRubricaDistritos':    result = saveRubricaDistritosSheet(JSON.parse(params.rubrica || '[]'));             break;
      case 'saveUsuarios':            result = saveUsuarios(JSON.parse(params.usuarios || '[]'));                         break;
      // ── Períodos y configuración dinámica ──
      case 'getConfig':               result = getConfigAction();                                                          break;
      case 'savePeriodos':            result = savePeriodosAction(JSON.parse(params.periodos || '[]'));                    break;
      case 'saveConfig':              result = saveConfigAction(params.clave, params.valor);                               break;
      default: result = { ok:false, error:'Accion desconocida: ' + action };
    }
    return jsonOut(result);
  } catch(err) {
    return jsonOut({ ok:false, error:err.message });
  }
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  doLogin
// ─────────────────────────────────────────────────────────────

function doLogin(usuario, pass) {
  if (!usuario || !pass) return { ok:false, error:'Credenciales requeridas' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var users = getUsers(ss);
  var u = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].user === String(usuario).trim() && String(users[i].pass) === String(pass).trim()) { u = users[i]; break; }
  }
  if (!u) return { ok:false, error:'Usuario o contraseña incorrectos' };
  return { ok:true, user:u.user, name:u.name, rol:u.rol, distrito:u.distrito||'', districtKey:u.distrito||'' };
}

// ─────────────────────────────────────────────────────────────
//  getData — todos los datos (admin)
// ─────────────────────────────────────────────────────────────

function getData() {
  var ss = SpreadsheetApp.openById(SS_ID);
  return {
    ok:               true,
    users:            getUsers(ss),
    districtKeys:     {},
    criterios:        getCriteriosFromSheet(ss),
    distCompetencias: DIST_COMPETENCIAS,
    scores:           { PE1:getScores(ss,'PE1'),          PE2:getScores(ss,'PE2'),          PE3:getScores(ss,'PE3')          },
    feedback:         { PE1:getFeedback(ss,'PE1'),         PE2:getFeedback(ss,'PE2'),         PE3:getFeedback(ss,'PE3')         },
    districtScores:   { PE1:getDistrictScores(ss,'PE1'),   PE2:getDistrictScores(ss,'PE2'),   PE3:getDistrictScores(ss,'PE3')   },
    rubrica:          getRubrica(ss),
    rubricaDistritos: getRubricaDistritos(ss),
    calendario:       getCalendario(ss),
    config:           getConfig(ss),
    periodos:         getPeriodos(ss),
    ts:               Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
//  getSecretarioData — solo datos del distrito (secretario/miembro)
// ─────────────────────────────────────────────────────────────

function getSecretarioData(usuario) {
  if (!usuario) return { ok:false, error:'Usuario requerido' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var users = getUsers(ss);
  var u = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].user === String(usuario).trim()) { u = users[i]; break; }
  }
  if (!u)                                          return { ok:false, error:'Usuario no encontrado' };
  if (u.rol !== 'secretario' && u.rol !== 'miembro') return { ok:false, error:'Acceso no autorizado' };

  var myDistrito = '';
  if (u.rol === 'secretario' && u.distrito) {
    myDistrito = u.distrito.trim();
  }
  if (!myDistrito) {
    myDistrito = findUserDistrito(ss, String(usuario).trim());
  }
  if (!myDistrito) return { ok:false, error:'Sin distrito asignado. Agrega el distrito en col E de USUARIOS o verifica col C en CREATORS SCORE.' };

  function soloDistrito(arr) {
    return arr.filter(function(r) {
      if (String(r.usuario||'').trim().toLowerCase() === String(usuario).trim().toLowerCase()) return true;
      return String(r.distrito||'').trim().toLowerCase() === myDistrito.toLowerCase();
    });
  }
  var scPE1 = soloDistrito(getScores(ss,'PE1'));
  var scPE2 = soloDistrito(getScores(ss,'PE2'));
  var scPE3 = soloDistrito(getScores(ss,'PE3'));
  var dUsers = {};
  scPE1.concat(scPE2).concat(scPE3).forEach(function(r){ dUsers[r.usuario]=true; });
  function soloFb(arr){ return arr.filter(function(r){ return dUsers[r.usuario]; }); }

  return {
    ok:               true,
    myDistrito:       myDistrito,
    criterios:        getCriteriosFromSheet(ss),
    distCompetencias: DIST_COMPETENCIAS,
    scores:           { PE1:scPE1, PE2:scPE2, PE3:scPE3 },
    feedback:         { PE1:soloFb(getFeedback(ss,'PE1')), PE2:soloFb(getFeedback(ss,'PE2')), PE3:soloFb(getFeedback(ss,'PE3')) },
    districtScores:   { PE1:getDistrictScores(ss,'PE1'),   PE2:getDistrictScores(ss,'PE2'),   PE3:getDistrictScores(ss,'PE3')   },
    rubrica:          getRubrica(ss),
    rubricaDistritos: u.rol === 'secretario' ? getRubricaDistritos(ss) : [],
    calendario:       getCalendario(ss),
    config:           getConfig(ss),
    periodos:         getPeriodos(ss),
    ts:               Date.now(),
  };
}

function findUserDistrito(ss, usuario) {
  var pes = ['PE1','PE2','PE3'];
  for (var i = 0; i < pes.length; i++) {
    var sc = getScores(ss, pes[i]);
    for (var j = 0; j < sc.length; j++) {
      if (sc[j].usuario === usuario && sc[j].distrito) return sc[j].distrito.trim();
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
//  getDistrictRanking
// ─────────────────────────────────────────────────────────────

function getDistrictRanking(pe) {
  var periodos = ['PE1','PE2','PE3'];
  var targets  = periodos.indexOf(pe) !== -1 ? [pe] : periodos;
  var ss       = SpreadsheetApp.openById(SS_ID);
  var result   = {};
  targets.forEach(function(p) {
    var ds = getDistrictScores(ss, p);
    result[p] = ds.map(function(d) {
      return {
        dist:         d.distrito,
        total:        d.total,
        criterioAvgs: { cgo:d.cgo, cct:d.cct, com:d.com, cee:d.cee },
      };
    });
  });
  return { ok:true, ranking:result, ts:Date.now() };
}

// ─────────────────────────────────────────────────────────────
//  getRubricaDistritosAction
// ─────────────────────────────────────────────────────────────

function getRubricaDistritosAction() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var rubrica = getRubricaDistritos(ss);
  return { ok:true, rubrica:rubrica };
}

// ─────────────────────────────────────────────────────────────
//  LECTURA
// ─────────────────────────────────────────────────────────────

function getUsers(ss) {
  var sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(1).filter(function(r){ return r[0]; }).map(function(r) {
    var rol      = String(r[3]||'miembro').toLowerCase().trim();
    var distrito = String(r[4]||'').trim();
    return { user:String(r[0]).trim(), pass:String(r[1]).trim(), name:String(r[2]||'').trim(), rol:rol, distrito:distrito, districtKey:distrito };
  });
}

// Lee CREATORS SCORE — incluye col O (estado) como campo "estado"
function getScores(ss, pe) {
  var sheet = ss.getSheetByName('CREATORS SCORE - ' + pe);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(DATA_START_IDX).filter(function(r){ return r[0]; }).map(function(r) {
    return {
      usuario:  String(r[0]).trim(),
      rol:      String(r[1]||'').trim(),
      distrito: String(r[2]||'').trim(),
      nombre:   String(r[3]||'').trim(),
      area:     String(r[4]||'').trim(),
      pla:      toNum(r[COL.pla]),
      rev:      toNum(r[COL.rev]),
      edi:      toNum(r[COL.edi]),
      dis:      toNum(r[COL.dis]),
      flu:      toNum(r[COL.flu]),
      nar:      toNum(r[COL.nar]),
      eje:      toNum(r[COL.eje]),
      ext:      toNum(r[COL.ext]),
      // Col O (índice 14) = Estado: "Activo" o "Inactivo"
      estado:   String(r[COL.estado] || 'Activo').trim() || 'Activo',
    };
  });
}

function getFeedback(ss, pe) {
  var sheet = ss.getSheetByName('CREATORS FEEDBACK - ' + pe);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(DATA_START_IDX).filter(function(r){ return r[0]; }).map(function(r) {
    return {
      usuario:String(r[0]).trim(), nombre:String(r[3]||'').trim(),
      pla:String(r[COL.pla]||'').trim(), rev:String(r[COL.rev]||'').trim(),
      edi:String(r[COL.edi]||'').trim(), dis:String(r[COL.dis]||'').trim(),
      flu:String(r[COL.flu]||'').trim(), nar:String(r[COL.nar]||'').trim(),
      eje:String(r[COL.eje]||'').trim(), ext:String(r[COL.ext]||'').trim(),
    };
  });
}

function getDistrictScores(ss, pe) {
  var sheet = ss.getSheetByName('CREATORS DISTRITOS - ' + pe);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[DCOL.dist]) continue;
    result.push({
      distrito: String(r[DCOL.dist]).trim(),
      cgo:      toNum(r[DCOL.cgo]),
      cct:      toNum(r[DCOL.cct]),
      com:      toNum(r[DCOL.com]),
      cee:      toNum(r[DCOL.cee]),
      total:    toNum(r[DCOL.total]),
    });
  }
  return result.sort(function(a,b){ return b.total - a.total; });
}

function getCriteriosFromSheet(ss) {
  var sheet = ss.getSheetByName('CRITERIOS');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.filter(function(r){ return r[0]; }).map(function(r,i) {
    return { key:String(r[0]).trim()||('c'+i), label:String(r[1]||'').trim()||('Criterio '+(i+1)), abbr:String(r[2]||'').trim()||String(r[0]).trim().toUpperCase().slice(0,3), color:String(r[3]||'').trim()||'#888888' };
  });
}

function getRubrica(ss) {
  var sheet = ss.getSheetByName('TABLA DE PUNTUACIÓN') || ss.getSheetByName('TABLA DE PUNTUACION');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.filter(function(r){ return r[1]; }).map(function(r) {
    return { criterio:String(r[1]).trim(), nivel4:String(r[2]||'').trim(), nivel3:String(r[3]||'').trim(), nivel2:String(r[4]||'').trim(), nivel1:String(r[5]||'').trim() };
  });
}

// Lee la rúbrica de distritos desde "TABLA DE PUNTUACIÓN Distritos"
// Misma estructura que la rúbrica de creators: B=criterio C=nivel4 D=nivel3 E=nivel2 F=nivel1
function getRubricaDistritos(ss) {
  var sheet = ss.getSheetByName('TABLA DE PUNTUACIÓN Distritos')
             || ss.getSheetByName('TABLA DE PUNTUACION Distritos')
             || ss.getSheetByName('TABLA DE PUNTUACIÓN DISTRITOS')
             || ss.getSheetByName('RUBRICA DISTRITOS');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.filter(function(r){ return r[1]; }).map(function(r) {
    return {
      criterio: String(r[1]).trim(),
      nivel4:   String(r[2]||'').trim(),
      nivel3:   String(r[3]||'').trim(),
      nivel2:   String(r[4]||'').trim(),
      nivel1:   String(r[5]||'').trim(),
    };
  });
}

function getCalendario(ss) {
  var sheet = ss.getSheetByName('Calendario') || ss.getSheetByName('CALENDARIO');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(1).filter(function(r){ return r[0]; }).map(function(r) {
    return { numero:String(r[0]).trim(), titulo:String(r[1]||'').trim(), color:String(r[2]||'rojo').trim().toLowerCase(), inicio:formatDate(r[3]), finTrabajo:formatDate(r[4]), entrega:formatDate(r[5]), jornada:formatDate(r[6]), estado:String(r[7]||'Pendiente').trim() };
  });
}

// Lee CONFIG (clave/valor): A=key, B=value
function getConfig(ss) {
  var sheet = ss.getSheetByName('CONFIG');
  if (!sheet) return {};
  var rows = sheet.getDataRange().getValues();
  var cfg = {};
  rows.filter(function(r){ return r[0]; }).forEach(function(r) {
    cfg[String(r[0]).trim()] = String(r[1]||'').trim();
  });
  return cfg;
}

// Lee PERIODOS: fila 1 encabezado, A=PE B=Nombre C=Inicio D=Fin E=Entrega F=Jornada G=Estado H=Color
function getPeriodos(ss) {
  var sheet = ss.getSheetByName('PERIODOS');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(1).filter(function(r){ return r[0]; }).map(function(r) {
    return {
      pe:         String(r[0]||'').trim(),
      nombre:     String(r[1]||'').trim(),
      inicio:     formatDate(r[2]),
      finTrabajo: formatDate(r[3]),
      entrega:    formatDate(r[4]),
      jornada:    formatDate(r[5]),
      estado:     String(r[6]||'Pendiente').trim(),
      color:      String(r[7]||'azul').trim().toLowerCase(),
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Scores y Feedback de miembros
// ─────────────────────────────────────────────────────────────

function updateScore(pe, usuario, criterio, valor) {
  if (!pe||!usuario||!criterio) return { ok:false, error:'Parametros incompletos' };
  var colIdx = COL_1B[criterio];
  if (!colIdx) return { ok:false, error:'Criterio desconocido: '+criterio };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('CREATORS SCORE - '+pe);
  if (!sheet) return { ok:false, error:'Hoja no encontrada: CREATORS SCORE - '+pe };
  var maxVal = criterio==='ext'?2:4;
  var numVal = parseFloat(valor)||0;
  if (numVal<0||numVal>maxVal) return { ok:false, error:'Valor '+numVal+' fuera de rango (0-'+maxVal+')' };
  var rows = sheet.getDataRange().getValues();
  for (var i = DATA_START_IDX; i < rows.length; i++) {
    if (String(rows[i][0]).trim()===String(usuario).trim()) {
      sheet.getRange(i+1, colIdx).setValue(numVal);
      return { ok:true, pe:pe, usuario:usuario, criterio:criterio, valor:numVal };
    }
  }
  return { ok:false, error:'Usuario no encontrado: '+usuario };
}

function updateFeedback(pe, usuario, criterio, texto) {
  if (!pe||!usuario||!criterio) return { ok:false, error:'Parametros incompletos' };
  var colIdx = COL_1B[criterio];
  if (!colIdx) return { ok:false, error:'Criterio desconocido: '+criterio };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('CREATORS FEEDBACK - '+pe);
  if (!sheet) return { ok:false, error:'Hoja no encontrada: CREATORS FEEDBACK - '+pe };
  var rows = sheet.getDataRange().getValues();
  for (var i = DATA_START_IDX; i < rows.length; i++) {
    if (String(rows[i][0]).trim()===String(usuario).trim()) {
      sheet.getRange(i+1, colIdx).setValue(String(texto||'').trim());
      return { ok:true };
    }
  }
  return { ok:false, error:'Usuario no encontrado: '+usuario };
}

function updateBulkScores(changes) {
  if (!Array.isArray(changes)) return { ok:false, error:'changes debe ser un array' };
  var results = changes.map(function(c){ return updateScore(c.pe,c.usuario,c.criterio,c.valor); });
  var failed  = results.filter(function(r){ return !r.ok; });
  return { ok:failed.length===0, total:changes.length, failed:failed };
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Scores de distritos
// ─────────────────────────────────────────────────────────────

function updateDistrictScore(pe, distrito, competencia, valor) {
  if (!pe||!distrito||!competencia) return { ok:false, error:'Parametros incompletos' };
  var colIdx = DCOL_1B[competencia];
  if (!colIdx) return { ok:false, error:'Competencia desconocida: '+competencia };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('CREATORS DISTRITOS - '+pe);
  if (!sheet) return { ok:false, error:'Hoja no encontrada: CREATORS DISTRITOS - '+pe };
  var maxVal = 7;
  var numVal = parseFloat(valor)||0;
  if (numVal<0||numVal>maxVal) return { ok:false, error:'Valor '+numVal+' fuera de rango (0-7)' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][DCOL.dist]).trim().toLowerCase()===String(distrito).trim().toLowerCase()) {
      sheet.getRange(i+1, colIdx).setValue(numVal);
      return { ok:true, pe:pe, distrito:distrito, competencia:competencia, valor:numVal };
    }
  }
  return { ok:false, error:'Distrito no encontrado: '+distrito };
}

function updateBulkDistrictScores(changes) {
  if (!Array.isArray(changes)) return { ok:false, error:'changes debe ser un array' };
  var results = changes.map(function(c){ return updateDistrictScore(c.pe,c.distrito,c.competencia,c.valor); });
  var failed  = results.filter(function(r){ return !r.ok; });
  return { ok:failed.length===0, total:changes.length, failed:failed };
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Calendario
// ─────────────────────────────────────────────────────────────

function saveCalendario(eventos) {
  if (!Array.isArray(eventos)) return { ok:false, error:'eventos debe ser un array' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('Calendario') || ss.getSheetByName('CALENDARIO');
  if (!sheet) return { ok:false, error:'Hoja Calendario no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 8).clearContent();
  }
  if (!eventos.length) return { ok:true, saved:0 };
  var rows = eventos.map(function(e, i) {
    return [
      e.numero   || (i + 1),
      e.titulo   || '',
      e.color    || 'rojo',
      e.inicio   || '',
      e.finTrabajo || '',
      e.entrega  || '',
      e.jornada  || '',
      e.estado   || 'Pendiente',
    ];
  });
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);
  return { ok:true, saved:rows.length };
}

// ─────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────

function toNum(v) {
  if (v===null||v===undefined||v==='') return 0;
  var n = parseFloat(v);
  return isNaN(n)?0:n;
}

function formatDate(v) {
  if (!v) return '';
  if (v instanceof Date) return v.getDate()+'/'+(v.getMonth()+1)+'/'+v.getFullYear();
  return String(v).trim();
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Criterios
//  Reemplaza toda la hoja CRITERIOS
//  criterios: [{key, label, abbr, color}]
// ─────────────────────────────────────────────────────────────
function saveCriterios(criterios) {
  if (!Array.isArray(criterios) || !criterios.length) return { ok:false, error:'criterios debe ser un array no vacío' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('CRITERIOS');
  if (!sheet) return { ok:false, error:'Hoja CRITERIOS no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow > 0) sheet.getRange(1, 1, lastRow, 4).clearContent();
  var rows = criterios.map(function(c) {
    return [String(c.key||'').trim(), String(c.label||'').trim(), String(c.abbr||'').trim(), String(c.color||'#888888').trim()];
  });
  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  return { ok:true, saved:rows.length };
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Rúbrica de Creators
//  Reemplaza TABLA DE PUNTUACIÓN
//  rubrica: [{criterio, nivel4, nivel3, nivel2, nivel1}]
// ─────────────────────────────────────────────────────────────
function saveRubricaSheet(rubrica) {
  if (!Array.isArray(rubrica)) return { ok:false, error:'rubrica debe ser un array' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('TABLA DE PUNTUACIÓN') || ss.getSheetByName('TABLA DE PUNTUACION');
  if (!sheet) return { ok:false, error:'Hoja TABLA DE PUNTUACIÓN no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow > 0) sheet.getRange(1, 1, lastRow, 6).clearContent();
  if (!rubrica.length) return { ok:true, saved:0 };
  var rows = rubrica.map(function(r, i) {
    return ['', String(r.criterio||'').trim(), String(r.nivel4||'').trim(), String(r.nivel3||'').trim(), String(r.nivel2||'').trim(), String(r.nivel1||'').trim()];
  });
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  return { ok:true, saved:rows.length };
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Rúbrica de Distritos
//  Reemplaza TABLA DE PUNTUACIÓN Distritos
// ─────────────────────────────────────────────────────────────
function saveRubricaDistritosSheet(rubrica) {
  if (!Array.isArray(rubrica)) return { ok:false, error:'rubrica debe ser un array' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('TABLA DE PUNTUACIÓN Distritos')
             || ss.getSheetByName('TABLA DE PUNTUACION Distritos')
             || ss.getSheetByName('TABLA DE PUNTUACIÓN DISTRITOS')
             || ss.getSheetByName('RUBRICA DISTRITOS');
  if (!sheet) return { ok:false, error:'Hoja de rúbrica de distritos no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow > 0) sheet.getRange(1, 1, lastRow, 6).clearContent();
  if (!rubrica.length) return { ok:true, saved:0 };
  var rows = rubrica.map(function(r) {
    return ['', String(r.criterio||'').trim(), String(r.nivel4||'').trim(), String(r.nivel3||'').trim(), String(r.nivel2||'').trim(), String(r.nivel1||'').trim()];
  });
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  return { ok:true, saved:rows.length };
}

// ─────────────────────────────────────────────────────────────
//  CONFIG / PERÍODOS — Lectura y escritura
// ─────────────────────────────────────────────────────────────

function getConfigAction() {
  var ss = SpreadsheetApp.openById(SS_ID);
  return { ok:true, config:getConfig(ss), periodos:getPeriodos(ss) };
}

function savePeriodosAction(periodos) {
  if (!Array.isArray(periodos)) return { ok:false, error:'periodos debe ser un array' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('PERIODOS');
  if (!sheet) return { ok:false, error:'Hoja PERIODOS no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 8).clearContent();
  if (!periodos.length) return { ok:true, saved:0 };
  var rows = periodos.map(function(p) {
    return [
      String(p.pe||'').trim(),
      String(p.nombre||'').trim(),
      String(p.inicio||'').trim(),
      String(p.finTrabajo||'').trim(),
      String(p.entrega||'').trim(),
      String(p.jornada||'').trim(),
      String(p.estado||'Pendiente').trim(),
      String(p.color||'azul').trim(),
    ];
  });
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);
  return { ok:true, saved:rows.length };
}

function saveConfigAction(clave, valor) {
  if (!clave) return { ok:false, error:'Clave requerida' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('CONFIG');
  if (!sheet) return { ok:false, error:'Hoja CONFIG no encontrada' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(clave).trim()) {
      sheet.getRange(i + 1, 2).setValue(String(valor||'').trim());
      return { ok:true };
    }
  }
  var nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, 2).setValues([[String(clave).trim(), String(valor||'').trim()]]);
  return { ok:true };
}

// ─────────────────────────────────────────────────────────────
//  ESCRITURA — Usuarios (CRUD completo)
//  Reemplaza todas las filas de USUARIOS (fila 1 = encabezado)
//  usuarios: [{user, pass, name, rol, distrito}]
// ─────────────────────────────────────────────────────────────
function saveUsuarios(usuarios) {
  if (!Array.isArray(usuarios)) return { ok:false, error:'usuarios debe ser un array' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) return { ok:false, error:'Hoja USUARIOS no encontrada' };
  // Mantener fila 1 (encabezado), limpiar desde fila 2
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
  if (!usuarios.length) return { ok:true, saved:0 };
  var rows = usuarios.map(function(u) {
    return [
      String(u.user||'').trim(),
      String(u.pass||'').trim(),
      String(u.name||'').trim(),
      String(u.rol||'miembro').trim().toLowerCase(),
      String(u.distrito||'').trim(),
    ];
  });
  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  return { ok:true, saved:rows.length };
}

// ═════════════════════════════════════════════════════════════════
//  SETUP — Ejecutar UNA SOLA VEZ desde el editor para crear todas
//  las hojas con sus encabezados y datos de ejemplo.
//  NO sobreescribe hojas que ya tengan datos.
// ═════════════════════════════════════════════════════════════════
function setup() {
  var ss  = SpreadsheetApp.openById(SS_ID);
  var log = [];

  // ── Helpers ──────────────────────────────────────────────────
  function getOrCreate(name) {
    var s = ss.getSheetByName(name);
    if (!s) { s = ss.insertSheet(name); log.push('CREADA  : ' + name); }
    else     {                           log.push('EXISTIA : ' + name); }
    return s;
  }

  function header(sheet, row, cols, bg) {
    bg = bg || '#002247';
    var r = sheet.getRange(row, 1, 1, cols.length);
    r.setValues([cols]);
    r.setFontWeight('bold');
    r.setBackground(bg);
    r.setFontColor('#FFFFFF');
  }

  function isEmpty(sheet) { return sheet.getLastRow() === 0; }

  // ── 1. USUARIOS ──────────────────────────────────────────────
  var u = getOrCreate('USUARIOS');
  if (isEmpty(u)) {
    header(u, 1, ['usuario','contraseña','nombre','rol','distrito']);
    u.getRange(2, 1, 3, 5).setValues([
      ['admin',      'admin2026',  'Administrador',    'admin',      ''         ],
      ['sec01',      'sec2026',    'Secretario Uno',   'secretario', 'NORTE'    ],
      ['creator01',  'cr2026',     'Creator Uno',      'miembro',    'NORTE'    ],
    ]);
  }

  // ── 2. CREATORS SCORE PE1 / PE2 / PE3 ───────────────────────
  //   Filas 1-3 = encabezados (DATA_START_IDX = 3 → datos desde fila 4)
  //   Columnas: A=usuario B=rol C=distrito D=nombre E=area
  //             F=pla G=rev H=edi I=dis J=flu K=nar L=eje M=ext N=(vacío) O=estado
  var scoreHeader = ['Usuario','Rol','Distrito','Nombre','Área',
                     'Planificación','Revisión','Edición Creativa','Diseño Creativo',
                     'Fluidez Oral','Narrativa / Guión','Ejecución en Redes',
                     'Bono Ext.','','Estado'];
  ['PE1','PE2','PE3'].forEach(function(pe) {
    var s = getOrCreate('CREATORS SCORE - ' + pe);
    if (isEmpty(s)) {
      s.getRange(1,1).setValue('EIGHT CREATORS LABs — Scores');
      s.getRange(2,1).setValue('Período: ' + pe);
      header(s, 3, scoreHeader);
      if (pe === 'PE1') {
        // Fila de ejemplo (fila 4)
        s.getRange(4, 1, 1, 15).setValues([
          ['creator01','miembro','NORTE','Creator Uno','Video',2,3,3,2,3,2,3,0,'','Activo']
        ]);
      }
    }
  });

  // ── 3. CREATORS FEEDBACK PE1 / PE2 / PE3 ────────────────────
  //   Misma estructura de filas que SCORE
  var fbHeader = ['Usuario','Rol','Distrito','Nombre','Área',
                  'Planificación','Revisión','Edición Creativa','Diseño Creativo',
                  'Fluidez Oral','Narrativa / Guión','Ejecución en Redes','Bono Ext.'];
  ['PE1','PE2','PE3'].forEach(function(pe) {
    var s = getOrCreate('CREATORS FEEDBACK - ' + pe);
    if (isEmpty(s)) {
      s.getRange(1,1).setValue('EIGHT CREATORS LABs — Feedback');
      s.getRange(2,1).setValue('Período: ' + pe);
      header(s, 3, fbHeader, '#003070');
      if (pe === 'PE1') {
        s.getRange(4, 1, 1, 13).setValues([
          ['creator01','miembro','NORTE','Creator Uno','Video','','','','','','','','']
        ]);
      }
    }
  });

  // ── 4. CREATORS DISTRITOS PE1 / PE2 / PE3 ───────────────────
  //   Fila 1 = encabezado, datos desde fila 2
  //   A=Distrito B=CGO C=CCT D=COM E=CEE F=Total
  ['PE1','PE2','PE3'].forEach(function(pe) {
    var s = getOrCreate('CREATORS DISTRITOS - ' + pe);
    if (isEmpty(s)) {
      header(s, 1, ['Distrito','CGO','CCT','COM','CEE','Total'], '#003A82');
      if (pe === 'PE1') {
        s.getRange(2, 1, 2, 6).setValues([
          ['NORTE', 5, 6, 4, 5, 20],
          ['SUR',   4, 4, 5, 4, 17],
        ]);
      }
    }
  });

  // ── 5. CRITERIOS ─────────────────────────────────────────────
  //   Sin encabezado. A=key B=label C=abbr D=color
  var crit = getOrCreate('CRITERIOS');
  if (isEmpty(crit)) {
    crit.getRange(1, 1, 7, 4).setValues([
      ['pla','Planificación',      'PLA','#E05A6A'],
      ['rev','Revisión',           'REV','#38BDF8'],
      ['edi','Edición Creativa',   'EDI','#2ECC71'],
      ['dis','Diseño Creativo',    'DIS','#5B7FFF'],
      ['flu','Fluidez Oral',       'FLU','#C084FC'],
      ['nar','Narrativa / Guión',  'NAR','#F0C040'],
      ['eje','Ejecución en Redes', 'EJE','#FB923C'],
    ]);
  }

  // ── 6. TABLA DE PUNTUACIÓN (rúbrica creators) ────────────────
  //   Col A vacía, B=criterio, C=nivel4, D=nivel3, E=nivel2, F=nivel1
  var rub = getOrCreate('TABLA DE PUNTUACIÓN');
  if (isEmpty(rub)) {
    header(rub, 1, ['','Criterio','Nivel 4 — Excelente','Nivel 3 — Bueno','Nivel 2 — En Proceso','Nivel 1 — Bajo']);
    rub.getRange(2, 1, 7, 6).setValues([
      ['','Planificación',      'Organiza con anticipación y detalle completo',   'Planifica la mayoría del contenido',      'Planificación básica o incompleta',    'Sin planificación'],
      ['','Revisión',           'Revisión exhaustiva, cero errores publicados',   'Revisión adecuada con errores mínimos',   'Revisión superficial',                'Sin revisión del contenido'],
      ['','Edición Creativa',   'Edición profesional, creativa y original',       'Buena edición con detalles menores',      'Edición básica, genérica',             'Edición mínima o sin editar'],
      ['','Diseño Creativo',    'Diseño original, atractivo y coherente',         'Buen diseño con cohesión visual',         'Diseño genérico o inconsistente',      'Sin diseño o muy básico'],
      ['','Fluidez Oral',       'Comunicación fluida, natural y carismática',     'Buena fluidez con pausas ocasionales',    'Fluidez limitada, pausas frecuentes',  'Comunicación entrecortada'],
      ['','Narrativa / Guión',  'Guión estructurado, atractivo y memorable',      'Buena narrativa con estructura clara',    'Narrativa básica, poca estructura',    'Sin estructura narrativa'],
      ['','Ejecución en Redes', 'Publicación óptima, consistente y estratégica',  'Buena ejecución con detalles a mejorar', 'Ejecución irregular o inconsistente',  'Ejecución deficiente'],
    ]);
  }

  // ── 7. TABLA DE PUNTUACIÓN Distritos ────────────────────────
  var rubD = getOrCreate('TABLA DE PUNTUACIÓN Distritos');
  if (isEmpty(rubD)) {
    header(rubD, 1, ['','Criterio','Nivel 7-6 — Excelente','Nivel 5-4 — Bueno','Nivel 3-2 — En Proceso','Nivel 1-0 — Bajo']);
    rubD.getRange(2, 1, 4, 6).setValues([
      ['','Gestión y Organización "CGO"',   'Gestión eficiente, organizada y anticipada',  'Buena gestión con áreas de mejora',   'Gestión básica e inconsistente',     'Gestión deficiente o ausente'],
      ['','Creativa y Técnica "CCT"',       'Alta calidad creativa y técnica constante',   'Buena calidad con detalles a mejorar','Calidad básica con errores frecuentes','Calidad deficiente'],
      ['','Comunicativa "COM"',             'Comunicación excelente y muy efectiva',       'Buena comunicación con mejoras menores','Comunicación limitada o irregular',  'Comunicación deficiente'],
      ['','Ejecución Estratégica "CEE"',    'Ejecución estratégica excelente y puntual',  'Buena ejecución con ajustes menores', 'Ejecución básica, incompleta',       'Ejecución deficiente o ausente'],
    ]);
  }

  // ── 8. Calendario ────────────────────────────────────────────
  //   Fila 1 = encabezado, datos desde fila 2
  //   A=numero B=titulo C=color D=inicio E=finTrabajo F=entrega G=jornada H=estado
  var cal = getOrCreate('Calendario');
  if (isEmpty(cal)) {
    header(cal, 1, ['Número','Título','Color','Inicio','Fin de Trabajo','Entrega Scores','Jornada','Estado']);
    cal.getRange(2, 1, 3, 8).setValues([
      [1,'Período de Evaluación 1','azul',  '1/1/2026', '31/1/2026','5/2/2026', '10/2/2026','Completado'],
      [2,'Período de Evaluación 2','rojo',  '1/3/2026', '31/3/2026','5/4/2026', '10/4/2026','En curso' ],
      [3,'Período de Evaluación 3','verde', '1/5/2026', '31/5/2026','5/6/2026', '10/6/2026','Pendiente'],
    ]);
  }

  // ── 9. CONFIG ─────────────────────────────────────────────────
  //   A=clave B=valor (sin encabezado — lo lee como datos directos)
  var cfg = getOrCreate('CONFIG');
  if (isEmpty(cfg)) {
    cfg.getRange(1, 1, 3, 2).setValues([
      ['periodoActivo', 'PE1'      ],
      ['autoRefreshMs', '300000'   ],
      ['sitioNombre',   'EIGHT CREATORS LABs'],
    ]);
  }

  // ── 10. PERIODOS ─────────────────────────────────────────────
  //   Fila 1 = encabezado, datos desde fila 2
  //   A=PE B=Nombre C=Inicio D=FinTrabajo E=Entrega F=Jornada G=Estado H=Color
  var per = getOrCreate('PERIODOS');
  if (isEmpty(per)) {
    header(per, 1, ['PE','Nombre','Inicio','Fin de trabajo','Entrega scores','Jornada','Estado','Color']);
    per.getRange(2, 1, 3, 8).setValues([
      ['PE1','Primer Período', '1/1/2026', '31/1/2026','5/2/2026', '10/2/2026','Completado','azul' ],
      ['PE2','Segundo Período','1/3/2026', '31/3/2026','5/4/2026', '10/4/2026','En curso',  'rojo' ],
      ['PE3','Tercer Período', '1/5/2026', '31/5/2026','5/6/2026', '10/6/2026','Pendiente', 'verde'],
    ]);
  }

  // ── Log final ─────────────────────────────────────────────────
  Logger.log('════════════════════════════════════════════');
  Logger.log('  EIGHT CREATORS LABs — Setup completado');
  Logger.log('════════════════════════════════════════════');
  log.forEach(function(l) { Logger.log(l); });
  Logger.log('────────────────────────────────────────────');
  Logger.log('Usuarios de prueba creados:');
  Logger.log('  admin     / admin2026  → Panel de Admin');
  Logger.log('  sec01     / sec2026   → Panel Secretario');
  Logger.log('  creator01 / cr2026    → Vista Miembro');
  Logger.log('────────────────────────────────────────────');
  Logger.log('Próximo paso: Implementar → Nueva implementación → Web App');
  Logger.log('════════════════════════════════════════════');
}

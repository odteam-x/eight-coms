// Núcleo de gafete-wallet (Google Wallet): configuración, firma RS256 verificable y forma del pase. Sin red.
import crypto from 'node:crypto';
import { leerConfig, importarClave, firmar, objetoWallet, enlaceGuardar, afirmacionAcceso, claseWallet, claseId } from '../../supabase/functions/gafete-wallet/nucleo.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const sa = { client_email: 'wallet@proyecto.iam.gserviceaccount.com', private_key: pem };
const env = { GOOGLE_WALLET_ISSUER_ID: '3388000000012345678', GOOGLE_WALLET_SA_JSON: JSON.stringify(sa) };

console.log('[configuración]');
ok(leerConfig(env).listo, 'con emisor y cuenta de servicio queda listo');
ok(!leerConfig({}).listo && leerConfig({}).errores.length === 2, 'sin secretos: no listo, dos errores');
ok(!leerConfig({ ...env, GOOGLE_WALLET_SA_JSON: '{"client_email":"x"}' }).listo, 'una cuenta de servicio sin clave privada no vale');
ok(!leerConfig({ ...env, GOOGLE_WALLET_ISSUER_ID: 'abc' }).listo, 'un emisor no numérico no vale');
ok(!leerConfig({ ...env, SITIO_URL: 'http://x.com' }).listo, 'SITIO_URL exige https');
ok(leerConfig(env).sitio === 'https://eight-coms.vercel.app', 'sitio por defecto');

console.log('\n[firma RS256]');
const clave = await importarClave(pem);
const dec = s => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const url = await enlaceGuardar({ sa, clave, objetoId: '3388000000012345678.9cea38933d954029aac01d08', ahora: 1000 });
ok(url.startsWith('https://pay.google.com/gp/v/save/'), 'el enlace tiene el formato de Google');
const [h, p, s] = url.replace('https://pay.google.com/gp/v/save/', '').split('.');
ok(dec(h).alg === 'RS256', 'cabecera RS256');
const cuerpo = dec(p);
ok(cuerpo.iss === sa.client_email && cuerpo.aud === 'google' && cuerpo.typ === 'savetowallet', 'iss / aud / typ');
ok(cuerpo.payload.genericObjects[0].id.endsWith('9cea38933d954029aac01d08'), 'lleva solo el id del objeto (el pase ya está creado por API)');
ok(crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), 'la firma verifica con la clave pública');
ok(url.length < 1800, `el enlace cabe en 1800 caracteres (${url.length})`);
const af = await afirmacionAcceso({ sa, clave, ahora: 1000 });
ok(dec(af.split('.')[1]).scope.includes('wallet_object.issuer') && dec(af.split('.')[1]).exp === 4600, 'afirmación OAuth con alcance de Wallet y 1 h');

console.log('\n[forma del pase]');
const d = { valido: true, nombre: 'Oscar Núñez', rol: 'Desarrollador web', distrito: '08-06', cargo: 'secretaria', miembro_desde: '2026-06-03T12:00:00Z', pe_evaluados: 0 };
const o = objetoWallet({ issuer: '3388000000012345678', token: '9cea38933d954029aac01d08', d, urlQR: 'https://eight-coms.vercel.app/v/9cea38933d954029aac01d08', logoUrl: 'https://eight-coms.vercel.app/img/wallet/logo-660.png', heroUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/u/wallet-hero.png?v=1' });
ok(o.id === '3388000000012345678.9cea38933d954029aac01d08' && o.classId === claseId('3388000000012345678') && claseWallet('1').id === '1.eight_gafete', 'ids de objeto y clase');
ok(o.barcode.type === 'QR_CODE' && o.barcode.value.endsWith('/v/9cea38933d954029aac01d08'), 'el QR del pase es el mismo enlace de verificación');
ok(o.header.defaultValue.value === 'Oscar Núñez' && o.subheader.defaultValue.value === 'Miembro de EIGHT Creators', 'nombre y subtítulo');
ok(o.hexBackgroundColor === '#002247' && o.state === 'ACTIVE', 'fondo navy y estado activo');
const mod = Object.fromEntries(o.textModulesData.map(m => [m.id, m.body]));
ok(mod.cargo === 'Secretaría' && mod.distrito === '08-06' && mod.rol === 'Desarrollador web' && /2026/.test(mod.desde), 'cargo, distrito, rol y desde: ' + JSON.stringify(mod));
ok(!/@|email|nota|puntaje/i.test(JSON.stringify(o)), 'el pase no contiene correo ni notas');
ok(o.textModulesData.every(m => m.id && m.header && m.body), 'módulos completos');
const largo = objetoWallet({ issuer: '1'.repeat(19), token: 'a'.repeat(24), d: { ...d, nombre: 'N'.repeat(200), rol: 'R'.repeat(200) }, urlQR: 'u', logoUrl: 'l', heroUrl: 'h' });
ok(largo.header.defaultValue.value.length <= 40 && largo.textModulesData.every(m => m.body.length <= 40), 'los textos largos se recortan');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

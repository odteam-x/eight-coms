/**
 * EIGHT CREATORS LABs — Lógica del formulario de registro
 *
 * Extraído del <script> inline de registro.html: la CSP declara script-src 'self',
 * así que al activarla un bloque inline dejaría de ejecutarse.
 */
'use strict';

document.getElementById('register-form').addEventListener('submit', function(e) {
  e.preventDefault();
  doRegister();
});

document.querySelectorAll('.btn-pass-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var inp = this.closest('.pass-wrap').querySelector('input');
    var isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    this.setAttribute('aria-label', isPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
    this.querySelector('i').setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
    lucide.createIcons({ nodes: [this] });
  });
});

// SEGURIDAD: el registro NO pide rol, distrito ni tipo de miembro.
// Un <select> público con la opción "Secretario" permitía autoproclamarse
// secretario de cualquier distrito y leer, vía las policies
// profiles_read_secretario y evaluaciones_read_secretario, los perfiles y
// todas las evaluaciones publicadas de ese distrito.
// Esos tres campos los asigna el admin desde el panel; el perfil lo crea el
// trigger on_auth_user_created del servidor con valores fijos.

/** Spinner dentro del propio botón (mismo comportamiento que en login.js). */
function cargando(btn, activo, texto) {
  const t = btn.querySelector('.btn-login-txt') || btn;
  btn.disabled = activo;
  btn.setAttribute('aria-busy', activo ? 'true' : 'false');
  btn.querySelector('.spin')?.remove();
  if (activo) {
    if (!btn.dataset.txtOriginal) btn.dataset.txtOriginal = t.textContent;
    t.textContent = texto || 'Enviando…';
    const sp = document.createElement('span');
    sp.className = 'spin';
    btn.prepend(sp);
  } else if (btn.dataset.txtOriginal) {
    t.textContent = btn.dataset.txtOriginal;
  }
}

function authErrEs(msg) {
  if (!msg) return 'Ocurrió un error. Intenta de nuevo.';
  const m = msg.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many') || m.includes('request rate'))
    return 'Demasiados intentos. Supabase limita solicitudes por hora. Espera unos minutos e intenta de nuevo.';
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already'))
    return 'Este correo ya tiene una cuenta registrada. Inicia sesión en su lugar.';
  if (m.includes('invalid email') || m.includes('valid email'))
    return 'El correo electrónico no es válido.';
  if (m.includes('password') && m.includes('short'))
    return 'La contraseña es muy corta.';
  if (m.includes('weak password'))
    return 'La contraseña es muy débil. Usa al menos 8 caracteres con letras y números.';
  if (m.includes('network') || m.includes('fetch'))
    return 'Sin conexión. Verifica tu internet e intenta de nuevo.';
  return 'Error al registrarse: ' + msg;
}

/* ── Fortaleza de la contraseña ───────────────────────────────────────
 * Cuenta variedad, no reglas de composición: exigir "un símbolo" produce
 * Password1! una y otra vez. La longitud es lo que más pesa.
 *
 * Reutiliza la escala de nivel del portal (Bajo → Excelente): el usuario ya
 * la asocia a peor→mejor en sus puntajes, así que no hay un segundo código
 * de color que aprender. El texto acompaña siempre a la barra: el color por
 * sí solo no es un indicador accesible.
 */
const _NIVELES_PASS = ['', 'Débil', 'Aceptable', 'Buena', 'Excelente'];

function fuerzaPass(v) {
  if (!v) return 0;
  let p = 0;
  if (v.length >= 8)  p++;
  if (v.length >= 12) p++;
  if (v.length >= 16) p++;
  const variedad = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(v)).length;
  if (variedad >= 2) p++;
  if (variedad >= 3) p++;
  // Una secuencia repetida o trivial anula el bono de longitud.
  if (/^(.)\1+$/.test(v) || /^(0123|1234|abcd|qwer|password|contrasena)/i.test(v)) p = 1;
  return Math.max(1, Math.min(4, p));
}

(function initMedidorPass() {
  const inp    = document.getElementById('r-pass');
  const medida = document.getElementById('pass-meter');
  const txt    = document.getElementById('pass-meter-txt');
  if (!inp || !medida) return;

  inp.addEventListener('input', () => {
    const v = inp.value;
    medida.hidden = !v;
    if (!v) { medida.dataset.nivel = '0'; txt.textContent = ''; return; }
    const n = fuerzaPass(v);
    medida.dataset.nivel = String(n);
    txt.textContent = v.length < 8
      ? `Seguridad: ${_NIVELES_PASS[n]} — faltan ${8 - v.length} caracteres`
      : `Seguridad: ${_NIVELES_PASS[n]}`;
  });
})();

async function doRegister() {
  const nombre   = document.getElementById('r-nombre').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const pass     = document.getElementById('r-pass').value;
  const pass2    = document.getElementById('r-pass2').value;
  const btn      = document.getElementById('btn-reg');
  const err      = document.getElementById('r-err');
  const ok       = document.getElementById('r-ok');

  err.classList.remove('visible'); ok.classList.remove('visible');

  if (!nombre)          { err.textContent='Escribe tu nombre completo.'; err.classList.add('visible'); return; }
  if (!email)           { err.textContent='Escribe tu email.'; err.classList.add('visible'); return; }
  if (pass.length < 8)  { err.textContent='La contraseña debe tener al menos 8 caracteres.'; err.classList.add('visible'); return; }
  if (pass !== pass2)   { err.textContent='Las contraseñas no coinciden.'; err.classList.add('visible'); return; }

  cargando(btn, true, 'Creando cuenta…');

  const res = await API.register({ email, password: pass, nombre });

  cargando(btn, false);

  if (!res.ok) { err.textContent = authErrEs(res.error); err.classList.add('visible'); return; }
  ok.classList.add('visible');
  btn.style.display = 'none';
}

if(typeof lucide!=='undefined') lucide.createIcons();

/* ── ¿Hay gestión abierta? ─────────────────────────────────────────────
 * Hasta ahora el registro funcionaba aunque no hubiera ninguna gestión
 * activa, y creaba perfiles huérfanos que nadie podía asignar a nada.
 *
 * OJO CON EL ALCANCE: esto NO es "registrarse en una gestión". `profiles`
 * no tiene gestion_id; la pertenencia por gestión está diseñada en la
 * migración 0006, sin aplicar. Esto solo cierra la puerta cuando no hay
 * ninguna gestión abierta.
 */
(async function comprobarGestionAbierta() {
  const form = document.getElementById('register-form');
  const btn  = document.getElementById('btn-reg');
  const err  = document.getElementById('r-err');
  if (!form || !btn) return;

  // RPC, no select: esta página se visita sin sesión y `gestiones` no es
  // legible para anon, así que un select devolvería [] y cerraría el
  // registro para todo el mundo. null = no se pudo saber; ante la duda no
  // se bloquea, porque dejar fuera a alguien es peor que un perfil suelto.
  const abierta = await API.hayGestionAbierta();
  if (abierta === null || abierta) return;

  for (const c of form.querySelectorAll('input, button, select, textarea')) {
    c.disabled = true;
    c.setAttribute('aria-disabled', 'true');
  }
  err.textContent = 'El registro está cerrado en este momento. '
                  + 'No hay ninguna gestión abierta; escribe a la coordinación.';
  err.classList.add('visible');
})();

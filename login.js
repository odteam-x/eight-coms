/**
 * EIGHT CREATORS LABs — Lógica de la página de acceso
 *
 * Extraído del <script> inline de index.html: la CSP declara script-src 'self',
 * así que al activarla un bloque inline dejaría de ejecutarse.
 */
'use strict';

'use strict';
if(typeof lucide!=='undefined') lucide.createIcons();

document.getElementById('login-form').addEventListener('submit', function(e) {
  e.preventDefault();
  doLogin();
});

// Aviso de cuenta pendiente de aprobación.
// auth.js cierra la sesión y redirige aquí con ?pendiente=1 cuando el perfil
// tiene aprobado = false.
(function avisoPendiente() {
  if (new URLSearchParams(location.search).get('pendiente') !== '1') return;
  const err = document.getElementById('li-err');
  err.textContent = 'Tu cuenta está pendiente de aprobación por el administrador. '
                  + 'Podrás entrar en cuanto la active.';
  err.classList.add('visible');
  // Limpia el parámetro para que no reaparezca al recargar.
  history.replaceState(null, '', location.pathname);
})();

function togglePassField(btn, inputId) {
  var inp = document.getElementById(inputId);
  var isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  btn.setAttribute('aria-label', isPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
  btn.querySelector('i').setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
  lucide.createIcons({ nodes: [btn] });
}

document.getElementById('pass-toggle').addEventListener('click', function() {
  togglePassField(this, 'li-pass');
});

/* Redirigir si ya hay sesión activa */
(async function() {
  const profile = await Auth.getProfile();
  if (profile) window.location.replace(profile.es_admin ? 'admin.html' : profile.tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html');
})();

const _loginThrottle = { attempts: 0, lockedUntil: 0 };
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MS  = 60000;

function authErrEs(msg) {
  if (!msg) return 'Ocurrió un error. Intenta de nuevo.';
  const m = msg.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many') || m.includes('request rate'))
    return 'Demasiados intentos de autenticación. Supabase limita a 30 solicitudes por hora. Espera unos minutos e intenta de nuevo.';
  if (m.includes('invalid login') || m.includes('invalid credentials') || m.includes('wrong password'))
    return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed'))
    return 'Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.';
  if (m.includes('network') || m.includes('fetch'))
    return 'Sin conexión. Verifica tu internet e intenta de nuevo.';
  return 'Error al ingresar: ' + msg;
}

/* ── Estado de carga y de error ────────────────────────────────────────
 * El spinner vive dentro del propio botón: en la versión anterior estaba
 * en una línea aparte bajo el formulario, así que al pulsar "Ingresar" no
 * pasaba nada visible en el sitio donde estabas mirando.
 */
function cargando(btn, activo, texto) {
  const txt = btn.querySelector('.btn-login-txt') || btn;
  btn.disabled = activo;
  btn.setAttribute('aria-busy', activo ? 'true' : 'false');
  btn.querySelector('.spin')?.remove();
  if (activo) {
    if (!btn.dataset.txtOriginal) btn.dataset.txtOriginal = txt.textContent;
    txt.textContent = texto || 'Verificando…';
    const sp = document.createElement('span');
    sp.className = 'spin';
    btn.prepend(sp);
  } else if (btn.dataset.txtOriginal) {
    txt.textContent = btn.dataset.txtOriginal;
  }
}

/** Marca el campo culpable, no solo el mensaje: el color no basta. */
function marcarError(caja, mensaje, ...campos) {
  caja.textContent = mensaje;
  caja.classList.add('visible');
  campos.forEach(c => c?.setAttribute('aria-invalid', 'true'));
}

function limpiarError(caja, ...campos) {
  caja.classList.remove('visible');
  caja.textContent = '';
  campos.forEach(c => c?.removeAttribute('aria-invalid'));
}

async function doLogin() {
  const uEl  = document.getElementById('li-user');
  const pEl  = document.getElementById('li-pass');
  const btn  = document.getElementById('btn-login');
  const err  = document.getElementById('li-err');
  const email = uEl.value.trim(), pass = pEl.value;

  if (!email || !pass) {
    marcarError(err, 'Ingresa email y contraseña.', !email ? uEl : null, !pass ? pEl : null);
    (!email ? uEl : pEl).focus();
    return;
  }

  const now = Date.now();
  if (now < _loginThrottle.lockedUntil) {
    const secsLeft = Math.ceil((_loginThrottle.lockedUntil - now) / 1000);
    marcarError(err, `Demasiados intentos fallidos. Espera ${secsLeft}s antes de reintentar.`);
    return;
  }

  limpiarError(err, uEl, pEl);
  cargando(btn, true, 'Verificando acceso…');

  const res = await API.login(email, pass);

  if (!res.ok) {
    _loginThrottle.attempts++;
    if (_loginThrottle.attempts >= LOGIN_MAX_ATTEMPTS) {
      _loginThrottle.lockedUntil = Date.now() + LOGIN_COOLDOWN_MS;
      _loginThrottle.attempts = 0;
    }
    marcarError(err, authErrEs(res.error), uEl, pEl);
    cargando(btn, false);
    pEl.value = ''; pEl.focus();
    return;
  }

  _loginThrottle.attempts = 0;
  const profile = await Auth.getProfile(true);
  const tipo = profile?.tipo_miembro || 'miembro';
  window.location.replace(profile?.es_admin ? 'admin.html' : tipo === 'secretario' ? 'secretario.html' : 'user.html');
}

/* ── Restablecer contraseña con código OTP ── */
var _resetEmail = '';
var _resetPass  = '';

function showResetForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
  document.getElementById('reset-step1').style.display = 'block';
  document.getElementById('reset-step2').style.display = 'none';
  document.getElementById('reset-err').classList.remove('visible');
  document.getElementById('reset-err').style.display = '';
  document.getElementById('reset-ok').style.display = 'none';
  document.getElementById('reset-sub').textContent = 'Ingresa tus datos y te enviaremos un código de verificación';
  document.getElementById('reset-email').focus();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function backToLogin() {
  document.getElementById('reset-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
}

function resetStep1() {
  document.getElementById('reset-step2').style.display = 'none';
  document.getElementById('reset-step1').style.display = 'block';
  document.getElementById('reset-err').classList.remove('visible');
  document.getElementById('reset-err').style.display = '';
  document.getElementById('reset-sub').textContent = 'Ingresa tus datos y te enviaremos un código de verificación';
}

async function sendResetCode() {
  var email = document.getElementById('reset-email').value.trim();
  var p1    = document.getElementById('reset-pass').value;
  var p2    = document.getElementById('reset-pass2').value;
  var err   = document.getElementById('reset-err');
  var btn   = document.getElementById('btn-send-code');

  err.classList.remove('visible');

  if (!email) {
    err.textContent = 'Ingresa tu correo electrónico.';
    err.classList.add('visible');
    document.getElementById('reset-email').focus();
    return;
  }
  if (!p1 || p1.length < 8) {
    err.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    err.classList.add('visible');
    document.getElementById('reset-pass').focus();
    return;
  }
  if (p1 !== p2) {
    err.textContent = 'Las contraseñas no coinciden.';
    err.classList.add('visible');
    document.getElementById('reset-pass2').focus();
    return;
  }

  cargando(btn, true, 'Enviando código…');

  var res = await SB.auth.signInWithOtp({
    email: email,
    options: { shouldCreateUser: false }
  });

  if (res.error) {
    err.textContent = res.error.message.includes('Signups not allowed')
      ? 'No existe una cuenta con ese correo.'
      : 'Error: ' + res.error.message;
    err.classList.add('visible');
    cargando(btn, false);
    return;
  }

  _resetEmail = email;
  _resetPass  = p1;

  document.getElementById('reset-step1').style.display = 'none';
  document.getElementById('reset-step2').style.display = 'block';
  document.getElementById('reset-sub').textContent = 'Ingresa el código que enviamos a ' + email;
  document.getElementById('reset-otp').value = '';
  document.getElementById('reset-otp').focus();

  cargando(btn, false);
}

async function verifyAndResetPassword() {
  var code = document.getElementById('reset-otp').value.trim();
  var err  = document.getElementById('reset-err');
  var ok   = document.getElementById('reset-ok');
  var btn  = document.getElementById('btn-verify-code');

  err.classList.remove('visible');
  ok.classList.remove('visible');

  if (!code || code.length < 8) {
    err.textContent = 'Ingresa el código de 8 dígitos.';
    err.classList.add('visible');
    document.getElementById('reset-otp').focus();
    return;
  }

  cargando(btn, true, 'Verificando…');

  var verifyRes = await SB.auth.verifyOtp({
    email: _resetEmail,
    token: code,
    type: 'magiclink'
  });

  if (verifyRes.error) {
    marcarError(err, 'Código inválido o expirado. Intenta de nuevo.',
                document.getElementById('reset-otp'));
    cargando(btn, false);
    return;
  }

  var updateRes = await SB.auth.updateUser({ password: _resetPass });

  if (updateRes.error) {
    marcarError(err, 'Error al actualizar contraseña: ' + updateRes.error.message);
    cargando(btn, false);
    return;
  }

  _resetPass = '';
  btn.style.display = 'none';
  document.getElementById('reset-step2').style.display = 'none';
  ok.textContent = 'Contraseña actualizada correctamente. Redirigiendo al portal…';
  ok.classList.add('visible');

  var profile = await Auth.getProfile(true);
  var dest = profile?.es_admin ? 'admin.html' : (profile?.tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html');
  setTimeout(function() { window.location.replace(dest); }, 2000);
}

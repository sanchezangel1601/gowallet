import {
  addTx, getAll, updateTx, deleteTx, getSetting, setSetting,
  hasEncryptedVault, unlockVault, lockVault, exportEncryptedBackup, importBackup,
  getLocalBackupInfo, restoreLocalBackup
} from './db.js?v=gastos-v15';

const $ = id => document.getElementById(id);
const appSurfaces = [document.querySelector('.desktop-sidebar'), document.querySelector('.top'), document.querySelector('main'), document.querySelector('.bottom-nav')];
const CATS = { egreso: ['Comida', 'Transporte', 'Casa', 'Salud', 'Ocio', 'Educación', 'Otros'], ingreso: ['Salario', 'Becas', 'Ventas', 'Otros'] };
const COLORS = ['#5157db', '#f4b740', '#28c895', '#f06472', '#51b8d5', '#a17ce8', '#ff916b'];
const fmt = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
let txs = [], budget = 0, rate = null, deferredPrompt = null;
let vaultExists = false, userProfile = null;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
const today = () => new Date().toISOString().slice(0, 10);
function showInstalledMobileSplash() {
  const installed = matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true;
  if (!installed || !matchMedia('(max-width: 759px)').matches) return;
  const splash = $('launchSplash');
  const loader = splash.querySelector('.loader');
  for (let i = 0; i < 20; i++) {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    loader.append(span);
  }
  splash.hidden = false;
  splash.setAttribute('aria-hidden', 'false');
  document.body.classList.add('show-splash');
  setTimeout(() => {
    splash.hidden = true;
    splash.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('show-splash');
  }, 500);
}
showInstalledMobileSplash();
function setView(name) {
  document.querySelectorAll('.view').forEach(view => {
    const active = view.id === `view-${name}`;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));
$('sidebarToggle').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  $('sidebarToggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebarToggle').setAttribute('aria-label', collapsed ? 'Expandir menú' : 'Contraer menú');
  $('sidebarToggle').textContent = collapsed ? '›' : '‹';
});

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  $('loginForm').hidden = !isLogin;
  $('registerForm').hidden = isLogin;
  $('loginTab').classList.toggle('active', isLogin);
  $('registerTab').classList.toggle('active', !isLogin);
  $('loginTab').setAttribute('aria-selected', String(isLogin));
  $('registerTab').setAttribute('aria-selected', String(!isLogin));
  $('authScreen').classList.toggle('auth-register', !isLogin);
  $('loginError').textContent = '';
  $('registerError').textContent = '';
}
document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
  const input = $(button.dataset.passwordToggle);
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Ocultar' : 'Mostrar';
  button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}));
$('forgotPassword').addEventListener('click', () => {
  $('loginError').textContent = 'La contraseña no se puede recuperar. Restaura una copia cifrada o crea una bóveda nueva en otro dispositivo.';
});

async function openUnlockedApp(profile) {
  userProfile = profile;
  budget = (await getSetting('budget')) || 0;
  $('budget').value = budget || '';
  await load();
  appSurfaces.forEach(surface => { surface.hidden = false; });
  $('authScreen').hidden = true;
  document.body.classList.remove('locked');
  $('btnLock').hidden = false;
  $('avatar').textContent = (profile.name || profile.username || 'A').trim().charAt(0).toUpperCase();
  $('homeGreeting').textContent = `Hola, ${(profile.name || profile.username || 'bienvenida').split(' ')[0]} 👋`;
  $('loginPassword').value = '';
  $('registerPassword').value = '';
  $('registerConfirm').value = '';
  void syncRate(false);
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginError').textContent = '';
  if (!vaultExists) {
    $('loginError').textContent = 'Todavía no hay una cuenta local. Regístrate para crearla.';
    return;
  }
  if (!$('loginForm').reportValidity()) return;
  const identity = $('loginIdentity').value.trim().toLocaleLowerCase('es-MX');
  let unlocked = false;
  try {
    await unlockVault($('loginPassword').value);
    unlocked = true;
    let profile = await getSetting('profile');
    if (profile) {
      if (identity !== String(profile.email || '').toLocaleLowerCase('es-MX') &&
          identity !== String(profile.username || '').toLocaleLowerCase('es-MX')) {
        throw new Error('El usuario o correo no coincide con esta cuenta local.');
      }
    } else {
      const username = identity.includes('@') ? identity.split('@')[0] : identity;
      profile = { name: username, username, email: identity.includes('@') ? identity : '' };
      await setSetting('profile', profile);
    }
    await openUnlockedApp(profile);
  } catch (error) {
    console.error(error);
    if (unlocked) await lockVault();
    $('loginError').textContent = error.message || 'No se pudo iniciar sesión.';
  }
});

$('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('registerError').textContent = '';
  if (!$('registerForm').reportValidity()) return;
  if (vaultExists) {
    $('registerError').textContent = 'Ya existe una bóveda en este dispositivo. Inicia sesión con esa cuenta.';
    return;
  }
  const password = $('registerPassword').value;
  if (password !== $('registerConfirm').value) {
    $('registerError').textContent = 'Las contraseñas no coinciden.';
    return;
  }
  const profile = {
    name: $('registerName').value.trim(),
    username: $('registerUsername').value.trim(),
    email: $('registerEmail').value.trim().toLocaleLowerCase('es-MX')
  };
  let unlocked = false;
  try {
    await unlockVault(password);
    unlocked = true;
    await setSetting('profile', profile);
    vaultExists = true;
    await openUnlockedApp(profile);
  } catch (error) {
    console.error(error);
    if (unlocked) await lockVault();
    $('registerError').textContent = error.message || 'No se pudo crear la cuenta local.';
  }
});

$('btnLock').addEventListener('click', async () => {
  await lockVault();
  appSurfaces.forEach(surface => { surface.hidden = true; });
  txs = [];
  budget = 0;
  rate = null;
  resetForm();
  render();
  $('authScreen').hidden = false;
  document.body.classList.add('locked');
  $('btnLock').hidden = true;
  $('loginIdentity').value = userProfile?.email || userProfile?.username || '';
  userProfile = null;
  $('loginPassword').value = '';
  setAuthMode('login');
  $('loginPassword').focus();
});

// ---------- Formulario (validación) ----------
function fillCats() {
  const sel = $('category'); sel.replaceChildren();
  CATS[$('type').value].forEach(c => sel.append(new Option(c, c)));
}
function validate(d) {
  if (!['egreso', 'ingreso'].includes(d.type)) return 'Tipo de movimiento inválido.';
  if (!Number.isFinite(d.amount) || d.amount <= 0 || d.amount > 9999999) return 'El monto debe ser mayor a 0 y no exceder 9,999,999.';
  if (typeof d.desc !== 'string' || d.desc.trim().length < 2 || d.desc.length > 60) return 'La descripción debe tener entre 2 y 60 caracteres.';
  const dateParts = typeof d.date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date);
  if (dateParts) {
    const parsedDate = new Date(0);
    parsedDate.setUTCHours(0, 0, 0, 0);
    parsedDate.setUTCFullYear(+dateParts[1], +dateParts[2] - 1, +dateParts[3]);
    if (parsedDate.toISOString().slice(0, 10) !== d.date) return 'Fecha inválida.';
  } else return 'Fecha inválida.';
  if (!CATS[d.type]?.includes(d.category)) return 'Categoría inválida.';
  return '';
}
function resetForm() {
  $('form').reset(); $('id').value = ''; $('date').value = today(); fillCats();
  $('formTitle').textContent = 'Nuevo movimiento'; $('btnCancel').hidden = true; $('err').textContent = '';
}
$('type').addEventListener('change', fillCats);
$('btnCancel').addEventListener('click', () => { resetForm(); setView('transactions'); });

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const d = { type: $('type').value, amount: Math.round(parseFloat($('amount').value) * 100) / 100,
    category: $('category').value, desc: $('desc').value.trim().slice(0, 60), date: $('date').value };
  const msg = validate(d);
  if (msg) { $('err').textContent = msg; return; }
  try {
    const id = $('id').value;
    if (id) { await updateTx({ ...d, id: Number(id) }); toast('Movimiento actualizado'); }
    else { await addTx(d); toast('Movimiento guardado'); }
    resetForm(); await load(); checkBudget(d); setView('home');
  } catch (err) { console.error(err); $('err').textContent = 'No se pudo guardar. Intenta de nuevo.'; }
});

// ---------- Lista y resumen ----------
const monthTx = () => txs.filter(t => t.date.startsWith($('month').value)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

function render() {
  const list = monthTx(), ul = $('list'); ul.replaceChildren();
  $('empty').hidden = list.length > 0;
  list.forEach(t => {
    const li = document.createElement('li');
    const meta = document.createElement('div'); meta.className = 'meta';
    const name = document.createElement('span'); name.textContent = t.desc;   // textContent evita XSS
    const sm = document.createElement('small'); sm.textContent = `${t.category} · ${t.date}`;
    meta.append(name, sm);
    const amt = document.createElement('strong'); amt.className = 'amt ' + t.type;
    amt.textContent = (t.type === 'ingreso' ? '+' : '-') + fmt(t.amount);
    const edit = document.createElement('button'); edit.textContent = '✏️'; edit.setAttribute('aria-label', 'Editar');
    edit.onclick = () => editTx(t);
    const del = document.createElement('button'); del.textContent = '🗑️'; del.setAttribute('aria-label', 'Eliminar');
    del.onclick = async () => {
      if (!confirm('¿Eliminar este movimiento?')) return;
      try { await deleteTx(t.id); await load(); toast('Eliminado'); }
      catch (e) { console.error(e); toast('No se pudo eliminar el movimiento'); }
    };
    li.append(meta, amt, edit, del); ul.append(li);
  });
  const recent = $('recentList'), recentItems = list.slice(0, 3);
  recent.replaceChildren();
  $('recentEmpty').hidden = recentItems.length > 0;
  recentItems.forEach(t => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = `recent-icon ${t.type}`;
    icon.textContent = t.type === 'ingreso' ? '↙' : '↗';
    const meta = document.createElement('div'); meta.className = 'meta';
    const name = document.createElement('span'); name.textContent = t.desc;
    const detail = document.createElement('small'); detail.textContent = `${t.category} · ${t.date}`;
    meta.append(name, detail);
    const amount = document.createElement('strong');
    amount.className = `amt ${t.type}`;
    amount.textContent = `${t.type === 'ingreso' ? '+' : '-'}${fmt(t.amount)}`;
    li.append(icon, meta, amount);
    recent.append(li);
  });
  const sum = ty => list.filter(t => t.type === ty).reduce((s, t) => s + t.amount, 0);
  const inc = sum('ingreso'), out = sum('egreso'), bal = inc - out;
  $('sumIn').textContent = fmt(inc); $('sumOut').textContent = fmt(out); $('sumBal').textContent = fmt(bal);
  $('usd').textContent = rate ? `≈ ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(bal * rate)}` : '';
  drawChart(list.filter(t => t.type === 'egreso'));
  const pct = budget > 0 ? Math.min(100, out / budget * 100) : 0;
  const progress = $('budgetProgress'), progressDetail = $('budgetProgressDetail');
  [progress, progressDetail].forEach(el => {
    el.value = pct;
    el.classList.toggle('warning', pct >= 80 && pct < 100);
    el.classList.toggle('danger', pct >= 100);
  });
  $('budgetPct').textContent = `${pct.toFixed(0)}%`;
  $('budgetPctDetail').textContent = `${pct.toFixed(0)}%`;
  $('budgetTxt').textContent = budget ? `${fmt(out)} de ${fmt(budget)}` : 'Define un presupuesto mensual.';
  $('budgetDetailText').textContent = budget ? `${fmt(out)} gastados de ${fmt(budget)} este mes.` : 'Define un presupuesto mensual.';
}
function editTx(t) {
  $('id').value = t.id; $('type').value = t.type; fillCats(); $('category').value = t.category;
  $('amount').value = t.amount; $('desc').value = t.desc; $('date').value = t.date;
  $('formTitle').textContent = 'Editar movimiento'; $('btnCancel').hidden = false; setView('new');
}

// ---------- Gráfico (canvas, sin librerías: funciona offline) ----------
function drawChart(out) {
  const g = $('chart').getContext('2d'), leg = $('legend'); leg.replaceChildren();
  g.clearRect(0, 0, 300, 300);
  const by = {}; out.forEach(t => by[t.category] = (by[t.category] || 0) + t.amount);
  const entries = Object.entries(by), total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) { g.fillStyle = '#999'; g.textAlign = 'center'; g.font = '16px sans-serif'; g.fillText('Sin egresos', 150, 150); return; }
  let a = -Math.PI / 2;
  entries.forEach(([k, v], i) => {
    const ang = v / total * Math.PI * 2;
    g.beginPath(); g.arc(150, 150, 130, a, a + ang); g.arc(150, 150, 70, a + ang, a, true); g.closePath();
    g.fillStyle = COLORS[i % COLORS.length]; g.fill(); a += ang;
    const li = document.createElement('li'), dot = document.createElement('i'); dot.className = `color-${i % COLORS.length}`;
    li.append(dot, `${k}: ${fmt(v)} (${(v / total * 100).toFixed(0)}%)`); leg.append(li);
  });
}

// ---------- Presupuesto + Notificaciones (API del dispositivo #1) ----------
$('btnBudget').onclick = async () => {
  const v = parseFloat($('budget').value);
  if (!Number.isFinite(v) || v < 0) return toast('Presupuesto inválido');
  try { await setSetting('budget', v); budget = v; render(); await updateLocalBackupStatus(); toast('Presupuesto guardado'); }
  catch (e) { console.error(e); toast('No se pudo guardar el presupuesto'); }
};
$('btnNotif').onclick = async () => {
  if (!('Notification' in window)) return toast('Tu navegador no soporta notificaciones');
  try {
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Alertas activadas' : 'Permiso denegado');
  } catch (e) { console.error(e); toast('No se pudo solicitar el permiso de notificaciones'); }
};
async function checkBudget(d) {
  if (d.type !== 'egreso' || !budget || !('Notification' in window)) return;
  const spent = txs.filter(t => t.type === 'egreso' && t.date.startsWith(d.date.slice(0, 7))).reduce((s, t) => s + t.amount, 0);
  if (spent >= budget * 0.8 && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('⚠️ Presupuesto', { body: `Llevas ${fmt(spent)} de ${fmt(budget)} este mes.`, icon: 'icons/icon-192.png' });
    } catch (e) { console.error(e); toast('No se pudo mostrar la alerta de presupuesto'); }
  }
}

// ---------- API REST: tipo de cambio (sincronización) ----------
async function syncRate(manual) {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/MXN');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.result !== 'success' || typeof j.rates?.USD !== 'number') throw new Error('Respuesta inválida');
    if (!userProfile) return;
    rate = j.rates.USD; await setSetting('rate', { v: rate, at: Date.now() });
    $('syncTxt').textContent = `1 MXN = ${rate.toFixed(4)} USD · actualizado ${new Date().toLocaleString('es-MX')}`;
    await updateLocalBackupStatus();
    if (manual) toast('Tipo de cambio actualizado');
  } catch (e) {
    if (!userProfile) return;
    console.error(e);
    try {
      const s = await getSetting('rate');
      if (s) { rate = s.v; $('syncTxt').textContent = `Sin conexión. Último tipo de cambio: ${s.v.toFixed(4)} (${new Date(s.at).toLocaleString('es-MX')})`; }
      else $('syncTxt').textContent = 'No se pudo obtener el tipo de cambio.';
    } catch (storageError) {
      console.error(storageError);
      $('syncTxt').textContent = 'No se pudo obtener el tipo de cambio ni leer el valor guardado.';
    }
    if (manual) toast('Error de red; usando datos guardados');
  }
  render();
}
$('btnSync').onclick = () => syncRate(true);

// ---------- Respaldo local cifrado ----------
async function updateLocalBackupStatus() {
  const status = $('localBackupStatus');
  const restoreButton = $('btnRestoreLocalBackup');
  try {
    const backup = await getLocalBackupInfo();
    restoreButton.disabled = !backup;
    status.textContent = backup
      ? `Copia cifrada disponible · ${new Date(backup.savedAt).toLocaleString('es-MX')}`
      : 'Se creará al guardar cambios en tus datos.';
  } catch (error) {
    console.error(error);
    restoreButton.disabled = true;
    status.textContent = 'No se pudo consultar la copia local.';
  }
}

$('btnRestoreLocalBackup').onclick = async () => {
  if (!confirm('Se restaurará la copia anterior y se reemplazarán los movimientos y ajustes actuales. ¿Continuar?')) return;
  try {
    const count = await restoreLocalBackup();
    await load();
    toast(`Copia local restaurada · ${count} movimientos`);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo restaurar la copia local.');
  }
};

// ---------- Compartir (API del dispositivo #2) ----------
$('btnShare').onclick = async () => {
  const list = monthTx(), sum = t => list.filter(x => x.type === t).reduce((s, x) => s + x.amount, 0);
  const text = `Resumen ${$('month').value}: ingresos ${fmt(sum('ingreso'))}, egresos ${fmt(sum('egreso'))}, balance ${fmt(sum('ingreso') - sum('egreso'))}.`;
  try {
    if (navigator.share) await navigator.share({ title: 'Mis gastos', text });
    else { await navigator.clipboard.writeText(text); toast('Resumen copiado al portapapeles'); }
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir'); }
};

// ---------- Respaldo JSON ----------
$('btnExport').onclick = async () => {
  try {
    const backup = await exportEncryptedBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `respaldo-cifrado-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast('Respaldo cifrado descargado');
  } catch (error) {
    console.error(error);
    toast('No se pudo exportar el respaldo cifrado');
  }
};

let pendingEncryptedBackup = null;
async function finishImport(backup, password) {
  try {
    let preparedBackup = backup;
    if (Array.isArray(backup?.txs)) {
      preparedBackup = {
        ...backup,
        txs: backup.txs.map(transaction => ({
          ...transaction,
          amount: Number(transaction.amount),
          desc: String(transaction.desc || '').trim().slice(0, 60)
        })).filter(transaction => !validate(transaction))
      };
      if (!preparedBackup.txs.length) throw new Error('El archivo no contiene movimientos válidos.');
    }
    const count = await importBackup(preparedBackup, password);
    await load();
    toast(`Importados ${count} movimientos`);
    return true;
  } catch (error) {
    console.error(error);
    $('backupPasswordError').textContent = error.message || 'El archivo no es válido.';
    return false;
  }
}

$('fileImport').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2e6) throw new Error('El archivo supera el límite de 2 MB.');
    const backup = JSON.parse(await file.text());
    if (backup?.format === 'control-gastos-encrypted-backup') {
      pendingEncryptedBackup = backup;
      $('backupPasswordError').textContent = '';
      $('backupPassword').value = '';
      $('backupPasswordDialog').showModal();
      $('backupPassword').focus();
    } else {
      const imported = await finishImport(backup, '');
      if (!imported) toast($('backupPasswordError').textContent || 'No se pudo importar el archivo.');
    }
  } catch (error) {
    console.error(error);
    toast(`Archivo inválido: ${error.message}`);
  } finally {
    if (!pendingEncryptedBackup) event.target.value = '';
  }
};

$('backupPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingEncryptedBackup) return;
  const imported = await finishImport(pendingEncryptedBackup, $('backupPassword').value);
  if (!imported) return;
  pendingEncryptedBackup = null;
  $('backupPasswordDialog').close();
  $('backupPassword').value = '';
  $('fileImport').value = '';
});
$('btnBackupCancel').addEventListener('click', () => {
  pendingEncryptedBackup = null;
  $('backupPasswordDialog').close();
  $('backupPassword').value = '';
  $('fileImport').value = '';
});
$('backupPasswordDialog').addEventListener('close', () => {
  if (!pendingEncryptedBackup) return;
  pendingEncryptedBackup = null;
  $('backupPassword').value = '';
  $('fileImport').value = '';
});

// ---------- Red e instalación ----------
function net() { const n = $('net'); n.textContent = navigator.onLine ? '● En línea' : '● Sin conexión'; n.className = 'badge ' + (navigator.onLine ? 'on' : 'off'); }
addEventListener('online', () => { net(); syncRate(false); }); addEventListener('offline', net);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('btnInstall').hidden = false; });
$('btnInstall').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('btnInstall').hidden = true; };
addEventListener('appinstalled', () => toast('App instalada'));

// ---------- Inicio ----------
async function load() {
  try { txs = await getAll(); render(); await updateLocalBackupStatus(); return true; }
  catch (e) { console.error(e); toast('Error al leer la base de datos'); return false; }
}
$('month').onchange = render;

(async function init() {
  $('month').value = today().slice(0, 7);
  resetForm();
  net();
  try {
    vaultExists = await hasEncryptedVault();
    setAuthMode(vaultExists ? 'login' : 'register');
  } catch (error) {
    console.error(error);
    setAuthMode('register');
    $('registerError').textContent = error.message || 'No se pudo revisar el almacenamiento local.';
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(error => console.error('SW', error));
  }
})();

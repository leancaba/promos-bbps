/* Panel de administrador · Directorio BBPS */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const PIN_KEY = 'bbps_admin_pin';
  const SIZES = {
    desktop: { w: 2066, h: 618, label: '2066 × 618' },
    mobile: { w: 1024, h: 1024, label: '1024 × 1024' },
    logo: { max: 600 },
  };

  const state = {
    pin: sessionStorage.getItem(PIN_KEY) || '',
    data: null,
    graf: { desktop: null, mobile: null },       // cambios pendientes de gráficas
    grafRemove: { desktop: false, mobile: false },
    editId: null,                                 // id del local en edición
    logo: null,                                   // logo nuevo pendiente {path, content, url}
    logoRemoved: false,
    listQ: '',
  };
  const preview = new Map(); // ruta -> URL local (para ver imágenes recién subidas antes de la nueva publicación)

  /* ---------- utilidades ---------- */
  const esc = (s) => (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'local';
  const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const src = (p) => (!p ? '' : /^https?:/.test(p) ? p : preview.get(p) || '/' + p);
  const logoDe = (l) => (l ? l.logo || l.logoUrl || '' : '');
  const splitRubro = (s) => (s || '').split(',').map((r) => r.trim()).filter(Boolean);
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let toastT;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = 'toast ' + type), type === 'error' ? 6500 : 4200);
  }

  function busy(btn, on) { btn.classList.toggle('busy', on); btn.disabled = on; }

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': state.pin, ...(opts.headers || {}) },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(out.error || `Error ${res.status}`); e.status = res.status; e.body = out; throw e; }
    return out;
  }

  async function persist({ data, uploads = [], deletes = [], message }) {
    try {
      const out = await api('/api/save', {
        method: 'POST',
        body: JSON.stringify({ baseUpdatedAt: state.data.updatedAt, data, uploads, deletes, message }),
      });
      state.data = out.data;
      return true;
    } catch (e) {
      if (e.status === 401) { logout('El PIN ya no es válido. Ingresá de nuevo.'); return false; }
      if (e.status === 409 && e.body && e.body.data) { state.data = e.body.data; renderAll(); }
      toast(e.message, 'error');
      return false;
    }
  }

  /* ---------- procesamiento de imágenes ---------- */
  function loadImage(file) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => ok({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  function toBlob(canvas, type, q) {
    return new Promise((ok) => canvas.toBlob(ok, type, q));
  }

  async function encode(canvas, prefer, fallback, q) {
    let blob = await toBlob(canvas, prefer, q);
    let type = prefer;
    if (!blob || blob.type !== prefer) { blob = await toBlob(canvas, fallback, q); type = fallback; }
    const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[type];
    const content = await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
    return { blob, ext, content };
  }

  // gráfica: recorta y escala para cubrir exactamente el tamaño pedido
  async function processBanner(file, kind) {
    const { w, h } = SIZES[kind];
    const { img, url } = await loadImage(file);
    URL.revokeObjectURL(url);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
    const out = await encode(c, 'image/webp', 'image/jpeg', 0.9);
    const ratioDiff = Math.abs(iw / ih - w / h) / (w / h);
    return { ...out, cropped: ratioDiff > 0.03, small: iw < w * 0.75 || ih < h * 0.75, orig: `${iw} × ${ih}` };
  }

  // logo: se achica hasta 600 px y conserva la transparencia
  async function processLogo(file) {
    const { img, url } = await loadImage(file);
    URL.revokeObjectURL(url);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, SIZES.logo.max / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return encode(c, 'image/webp', 'image/png', 0.92);
  }

  function checkFile(file) {
    if (!file) return false;
    if (!/^image\//.test(file.type)) { toast('El archivo tiene que ser una imagen (JPG, PNG o WEBP).', 'error'); return false; }
    if (file.size > 25 * 1024 * 1024) { toast('La imagen es demasiado pesada (máximo 25 MB).', 'error'); return false; }
    return true;
  }

  /* ---------- gráficas promocionales ---------- */
  async function pickBanner(kind, input) {
    const file = input.files[0];
    input.value = '';
    if (!checkFile(file)) return;
    try {
      const r = await processBanner(file, kind);
      const path = `uploads/promos/grafica-${kind}-${stamp()}.${r.ext}`;
      const url = URL.createObjectURL(r.blob);
      preview.set(path, url);
      state.graf[kind] = { path, content: r.content, cropped: r.cropped, small: r.small, orig: r.orig };
      state.grafRemove[kind] = false;
      renderGraf();
      if (r.cropped) toast(`La imagen (${r.orig}) no tenía la proporción exacta: se recortó al centro para ${SIZES[kind].label}.`);
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderGraf() {
    ['desktop', 'mobile'].forEach((kind) => {
      const box = kind === 'desktop' ? $('#pDesk') : $('#pMob');
      const pending = state.graf[kind];
      const current = state.data.banner[kind];
      const removed = state.grafRemove[kind];
      const path = pending ? pending.path : removed ? '' : current;
      if (!path) {
        box.innerHTML = removed && current
          ? `<div class="meta"><span class="tag">Se quitará al guardar</span><button class="link" data-undo="${kind}">Deshacer</button></div>`
          : `<div class="meta">Sin imagen cargada${kind === 'mobile' && state.data.banner.desktop ? ' · en celulares se usa la de escritorio' : ''}</div>`;
        return;
      }
      const notes = [];
      if (pending) notes.push('<span class="tag">Sin guardar</span>');
      if (pending && pending.small) notes.push(`<span class="warn">Resolución baja (${pending.orig})</span>`);
      box.innerHTML = `
        <div class="frame"><img src="${esc(src(path))}" alt="Vista previa"></div>
        <div class="meta">${notes.join('')}
          ${pending ? `<button class="link" data-undo="${kind}">Descartar</button>` : `<button class="link" data-remove="${kind}">Quitar gráfica</button>`}
        </div>`;
    });
    const dirty = state.graf.desktop || state.graf.mobile || state.grafRemove.desktop || state.grafRemove.mobile;
    $('#saveGraf').disabled = !dirty;
  }

  async function saveGraf() {
    const btn = $('#saveGraf');
    const data = clone(state.data);
    const uploads = [], deletes = [];
    ['desktop', 'mobile'].forEach((kind) => {
      const old = data.banner[kind];
      if (state.graf[kind]) {
        uploads.push({ path: state.graf[kind].path, content: state.graf[kind].content });
        data.banner[kind] = state.graf[kind].path;
        if (old) deletes.push(old);
      } else if (state.grafRemove[kind]) {
        data.banner[kind] = '';
        if (old) deletes.push(old);
      }
    });
    busy(btn, true);
    const ok = await persist({ data, uploads, deletes, message: 'Gráficas promocionales actualizadas' });
    busy(btn, false);
    if (ok) {
      state.graf = { desktop: null, mobile: null };
      state.grafRemove = { desktop: false, mobile: false };
      renderGraf();
      toast('Gráficas guardadas ✓ La web pública se actualiza en aproximadamente un minuto.');
    } else renderGraf();
  }

  /* ---------- formulario de local ---------- */
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4l10 8-10 8z"/></svg>';

  function promoItem(p = { titulo: '', descripcion: '' }, open = false) {
    const el = document.createElement('div');
    el.className = 'p-item' + (open ? ' open' : '');
    el.innerHTML = `
      <div class="p-head">
        <input class="p-title" placeholder="TÍTULO DE LA PROMO" maxlength="120" value="${esc(p.titulo)}" aria-label="Título de la promoción">
        <button type="button" class="p-toggle" aria-label="Mostrar u ocultar descripción" aria-expanded="${open}">${arrow}</button>
      </div>
      <div class="p-body"><div><div class="p-inner">
        <textarea class="p-desc" placeholder="DESCRIPCIÓN DE LA PROMO" maxlength="600" aria-label="Descripción de la promoción">${esc(p.descripcion)}</textarea>
        <button type="button" class="p-del">BORRAR PROMO</button>
      </div></div></div>`;
    return el;
  }

  function numberPromos() {
    [...$('#promoList').children].forEach((it, i) => {
      $('.p-title', it).placeholder = `PROMO ${i + 1}`;
      $('.p-desc', it).placeholder = `DESCRIPCIÓN PROMO ${i + 1}`;
    });
  }

  function openOnly(item) {
    [...$('#promoList').children].forEach((it) => {
      const open = it === item ? !it.classList.contains('open') : false;
      it.classList.toggle('open', open);
      $('.p-toggle', it).setAttribute('aria-expanded', String(open));
    });
  }

  function addPromo(p, focus = true) {
    const list = $('#promoList');
    const el = promoItem(p);
    list.appendChild(el);
    numberPromos();
    if (focus) { openOnly(el); $('.p-title', el).focus(); }
    return el;
  }

  function readPromos() {
    return [...$('#promoList').children]
      .map((it) => ({ titulo: $('.p-title', it).value.trim(), descripcion: $('.p-desc', it).value.trim() }))
      .filter((p) => p.titulo || p.descripcion);
  }

  function renderLogoPrev() {
    const box = $('#pLogo');
    const local = state.editId && state.data.locales.find((l) => l.id === state.editId);
    const path = state.logo ? state.logo.path : state.logoRemoved ? '' : logoDe(local);
    if (!path) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `
      <span class="thumb"><img src="${esc(src(path))}" alt="Logo"></span>
      <span class="info">${state.logo ? '<span class="tag">Sin guardar</span>' : ''}${!state.logo && /^https?:/.test(path) ? '<span class="tag">Externo: falta descargar</span>' : ''}<button type="button" class="link" id="rmLogo">Quitar logo</button></span>`;
    $('#rmLogo').onclick = () => {
      if (state.logo) state.logo = null; else state.logoRemoved = true;
      renderLogoPrev();
    };
  }

  async function pickLogo(input) {
    const file = input.files[0];
    input.value = '';
    if (!checkFile(file)) return;
    try {
      const r = await processLogo(file);
      const name = $('#lNombre').value || 'local';
      const path = `uploads/logos/${slug(name)}-${stamp()}.${r.ext}`;
      preview.set(path, URL.createObjectURL(r.blob));
      state.logo = { path, content: r.content };
      state.logoRemoved = false;
      renderLogoPrev();
    } catch (e) { toast(e.message, 'error'); }
  }

  function resetForm() {
    state.editId = null; state.logo = null; state.logoRemoved = false;
    $('#locForm').reset();
    $('#promoList').innerHTML = '';
    addPromo(undefined, false);
    renderLogoPrev();
    $('#editing').hidden = true;
    $('#cancelEdit').hidden = true;
    renderList();
  }

  function editLocal(id) {
    const l = state.data.locales.find((x) => x.id === id);
    if (!l) return;
    state.editId = id; state.logo = null; state.logoRemoved = false;
    $('#lNombre').value = l.nombre;
    $('#lRubro').value = l.rubro || '';
    const list = $('#promoList');
    list.innerHTML = '';
    (l.promos.length ? l.promos : [undefined]).forEach((p) => addPromo(p, false));
    if (list.firstElementChild) openOnly(list.firstElementChild);
    renderLogoPrev();
    $('#editing').innerHTML = `EDITANDO: <b>${esc(l.nombre)}</b>`;
    $('#editing').hidden = false;
    $('#cancelEdit').hidden = false;
    renderList();
    const form = $('#locForm');
    $('#tLoc').scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.classList.remove('flash'); void form.offsetWidth; form.classList.add('flash');
  }

  async function saveLocal(ev) {
    ev.preventDefault();
    const nombreEl = $('#lNombre');
    const nombre = nombreEl.value.trim().replace(/\s+/g, ' ');
    if (!nombre) {
      nombreEl.classList.remove('err'); void nombreEl.offsetWidth; nombreEl.classList.add('err');
      nombreEl.focus();
      toast('Escribí el nombre del local.', 'error');
      return;
    }
    const dup = state.data.locales.find((l) => norm(l.nombre) === norm(nombre) && l.id !== state.editId);
    if (dup && !confirm(`Ya existe un local llamado "${dup.nombre}". ¿Querés guardarlo igual?`)) return;

    const data = clone(state.data);
    const uploads = [], deletes = [];
    const isNew = !state.editId;
    let local = isNew ? { id: `${slug(nombre)}-${stamp().slice(0, 5)}`, logo: '' } : data.locales.find((l) => l.id === state.editId);
    if (!local) { toast('Ese local ya no existe. Se recargó la lista.', 'error'); resetForm(); return; }
    local.nombre = nombre;
    local.rubro = splitRubro($('#lRubro').value.replace(/\s+/g, ' ')).join(', ');
    local.promos = readPromos();
    if (state.logo) {
      uploads.push({ path: state.logo.path, content: state.logo.content });
      if (local.logo) deletes.push(local.logo);
      local.logo = state.logo.path;
      local.logoUrl = '';
    } else if (state.logoRemoved) {
      if (local.logo) deletes.push(local.logo);
      local.logo = '';
      local.logoUrl = '';
    }
    if (isNew) data.locales.push(local);

    const btn = $('#saveLoc');
    busy(btn, true);
    const ok = await persist({ data, uploads, deletes, message: `${isNew ? 'Nuevo local' : 'Local editado'}: ${nombre}` });
    busy(btn, false);
    if (ok) {
      toast(`${nombre} ${isNew ? 'agregado' : 'actualizado'} ✓ La web pública se actualiza en aproximadamente un minuto.`);
      resetForm();
      renderRubros();
    }
  }

  async function deleteLocal(id, row) {
    const l = state.data.locales.find((x) => x.id === id);
    if (!l) return;
    if (!confirm(`¿Borrar "${l.nombre}" y todas sus promociones? Esta acción no se puede deshacer.`)) return;
    const data = clone(state.data);
    data.locales = data.locales.filter((x) => x.id !== id);
    row.style.opacity = '.4';
    const ok = await persist({ data, deletes: l.logo ? [l.logo] : [], message: `Local borrado: ${l.nombre}` });
    if (ok) {
      row.classList.add('leaving');
      setTimeout(() => { if (state.editId === id) resetForm(); else renderList(); renderRubros(); }, 300);
      toast(`${l.nombre} borrado ✓`);
    } else row.style.opacity = '';
  }

  /* ---------- lista ---------- */
  function renderList() {
    const q = norm(state.listQ);
    const all = [...state.data.locales].sort((a, b) => collator.compare(a.nombre, b.nombre));
    const list = all.filter((l) => !q || norm(l.nombre).includes(q) || norm(l.rubro).includes(q));
    $('#count').textContent = `${all.length} ${all.length === 1 ? 'LOCAL' : 'LOCALES'}`;
    const ul = $('#locList');
    if (!list.length) {
      ul.innerHTML = `<li class="loc-empty">${all.length ? 'No hay locales que coincidan.' : 'Todavía no cargaste locales. Usá el formulario de arriba.'}</li>`;
      return;
    }
    ul.innerHTML = list.map((l, i) => `
      <li class="loc-row${l.id === state.editId ? ' current' : ''}" style="--i:${Math.min(i, 20)}" data-id="${esc(l.id)}">
        <div class="loc-name">${logoDe(l) ? `<img src="${esc(src(logoDe(l)))}" alt="" loading="lazy">` : ''}<span>${esc(l.nombre)}</span><small>${l.promos.length} PROMO${l.promos.length === 1 ? '' : 'S'}</small></div>
        <button class="edit" type="button">EDITAR</button>
        <button class="del" type="button">BORRAR</button>
      </li>`).join('');
    ul.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.remove()));
  }

  function renderRubros() {
    const set = [...new Set(state.data.locales.flatMap((l) => splitRubro(l.rubro)))].sort(collator.compare);
    $('#rubros').innerHTML = set.map((r) => `<option value="${esc(r)}">`).join('');
  }

  /* ---------- importar logos externos ---------- */
  function pendingLogos() { return state.data.locales.filter((l) => l.logoUrl && !l.logo); }

  function renderImport(msg) {
    const box = $('#importBox');
    const n = pendingLogos().length;
    if (!n && !msg) { box.hidden = true; return; }
    box.hidden = false;
    $('#importTxt').innerHTML = msg || `<b>${n} ${n === 1 ? 'logo se muestra' : 'logos se muestran'}</b> todavía desde la web del shopping. Descargalos para que queden guardados en el repositorio.`;
    $('#importBtn').hidden = !n;
  }

  async function importAll() {
    const btn = $('#importBtn');
    const failed = [];
    let done = 0;
    const total = pendingLogos().length;
    busy(btn, true);
    const tried = new Set();
    while (true) {
      const batch = pendingLogos().filter((l) => !tried.has(l.id)).slice(0, 15);
      if (!batch.length) break;
      batch.forEach((l) => tried.add(l.id));
      renderImport(`Descargando logos… <b>${done} de ${total}</b>`);
      try {
        const out = await api('/api/import-logos', { method: 'POST', body: JSON.stringify({ ids: batch.map((l) => l.id) }) });
        state.data = out.data;
        done += out.ok.length;
        failed.push(...out.failed);
      } catch (e) {
        if (e.status === 401) { busy(btn, false); logout('El PIN ya no es válido. Ingresá de nuevo.'); return; }
        failed.push(...batch.map((l) => ({ nombre: l.nombre, error: e.message })));
      }
      renderList();
    }
    busy(btn, false);
    const fails = failed.length ? `<br>No se pudieron descargar ${failed.length}: ${failed.map((f) => esc(f.nombre)).join(', ')}. Se siguen mostrando desde la web del shopping; podés reintentar o cargarles el logo a mano.` : '';
    renderImport(`<b>${done} logos guardados en el repositorio ✓</b> La web pública se actualiza en aproximadamente un minuto.${fails}`);
    $('#importBtn').hidden = !pendingLogos().length;
  }

  function renderAll() { renderGraf(); renderList(); renderRubros(); renderImport(); }

  /* ---------- acceso ---------- */
  async function login(pin) {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ pin }) });
    state.pin = pin;
    sessionStorage.setItem(PIN_KEY, pin);
  }

  function logout(msg) {
    sessionStorage.removeItem(PIN_KEY);
    state.pin = '';
    $('#app').hidden = true; $('#nav').hidden = true;
    $('#gate').hidden = false;
    $('#gateMsg').textContent = msg || '';
    $('#gatePin').value = '';
    $('#gatePin').focus();
  }

  async function start() {
    try {
      const out = await api('/api/data');
      state.data = out.data;
    } catch (e) {
      $('#gate').hidden = false;
      $('#gateMsg').textContent = 'No se pudieron leer los datos: ' + e.message;
      return;
    }
    state.data.banner = state.data.banner || { desktop: '', mobile: '' };
    state.data.locales = state.data.locales || [];
    $('#gate').hidden = true;
    $('#app').hidden = false;
    $('#nav').hidden = false;
    resetForm();
    renderAll();
  }

  /* ---------- eventos ---------- */
  $('#gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('#gatePin').value.trim();
    const form = e.currentTarget;
    $('#gateMsg').textContent = '';
    try { await login(pin); start(); }
    catch (err) {
      $('#gateMsg').textContent = err.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : err.message;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    }
  });
  $('#logout').addEventListener('click', () => logout());

  $('#fDesk').addEventListener('change', (e) => pickBanner('desktop', e.target));
  $('#fMob').addEventListener('change', (e) => pickBanner('mobile', e.target));
  $('#saveGraf').addEventListener('click', saveGraf);
  document.querySelector('.a-sec').addEventListener('click', (e) => {
    const undo = e.target.closest('[data-undo]');
    const rm = e.target.closest('[data-remove]');
    if (undo) { state.graf[undo.dataset.undo] = null; state.grafRemove[undo.dataset.undo] = false; renderGraf(); }
    if (rm) { state.grafRemove[rm.dataset.remove] = true; renderGraf(); }
  });

  $('#fLogo').addEventListener('change', (e) => pickLogo(e.target));
  $('#addPromo').addEventListener('click', () => addPromo());
  $('#promoList').addEventListener('click', (e) => {
    const item = e.target.closest('.p-item');
    if (!item) return;
    if (e.target.closest('.p-toggle')) openOnly(item);
    if (e.target.closest('.p-del')) {
      item.classList.add('leaving');
      setTimeout(() => {
        item.remove();
        if (!$('#promoList').children.length) addPromo(undefined, false);
        numberPromos();
      }, 240);
    }
  });
  $('#promoList').addEventListener('focusin', (e) => {
    const item = e.target.closest('.p-item');
    if (item && e.target.classList.contains('p-title') && !item.classList.contains('open')) openOnly(item);
  });
  $('#promoList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('p-title')) {
      e.preventDefault();
      $('.p-desc', e.target.closest('.p-item')).focus();
    }
  });
  $('#locForm').addEventListener('submit', saveLocal);
  $('#cancelEdit').addEventListener('click', resetForm);
  $('#lNombre').addEventListener('input', (e) => e.target.classList.remove('err'));

  $('#importBtn').addEventListener('click', importAll);
  $('#listQ').addEventListener('input', (e) => { state.listQ = e.target.value; renderList(); });
  $('#locList').addEventListener('click', (e) => {
    const row = e.target.closest('.loc-row');
    if (!row) return;
    if (e.target.closest('.edit')) editLocal(row.dataset.id);
    if (e.target.closest('.del')) deleteLocal(row.dataset.id, row);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.graf.desktop || state.graf.mobile || state.logo) { e.preventDefault(); e.returnValue = ''; }
  });

  // inicio
  if (state.pin) {
    login(state.pin).then(start).catch(() => logout());
  } else {
    logout();
  }
})();

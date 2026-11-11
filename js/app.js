/* Directorio de locales · Bahía Blanca Plaza Shopping */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    hdr: $('#hdr'), toolbar: $('#toolbar'), grid: $('#grilla'), status: $('#status'), empty: $('#empty'),
    q: $('#q'), filterBtn: $('#filterBtn'), filterLabel: $('#filterLabel'), filterPop: $('#filterPop'),
    sortBtn: $('#sortBtn'), clearBtn: $('#clearBtn'), topBtn: $('#topBtn'),
    banner: $('#banner'), bannerImg: $('#bannerImg'), bannerMobile: $('#bannerMobile'),
    modal: $('#modal'), mTitle: $('#mTitle'), mRubro: $('#mRubro'), mLogo: $('#mLogo'), mPromos: $('#mPromos'),
    adminForm: $('#adminForm'), pin: $('#pin'), adminMsg: $('#adminMsg'),
  };

  const state = { locales: [], q: '', rubro: '', dir: 1 };
  const nodes = new Map(); // id -> <li>

  /* ---------- utilidades ---------- */
  const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const esc = (s) => (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rubrosDe = (l) => (l.rubro || '').split(',').map((r) => r.trim()).filter(Boolean);
  const logoDe = (l) => l.logo || l.logoUrl || '';
  const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function highlight(name, q) {
    if (!q) return esc(name);
    const n = norm(name);
    const i = n.indexOf(q);
    if (i < 0) return esc(name);
    // la normalización NFD conserva la longitud de los caracteres base en español
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }

  /* ---------- carga de datos ---------- */
  async function load() {
    els.status.textContent = 'Cargando locales…';
    try {
      const res = await fetch('data/locales.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.locales = (data.locales || []).filter((l) => l && l.nombre);
      setBanner(data.banner || {});
      els.status.textContent = '';
      buildFilter();
      render();
    } catch (e) {
      els.status.textContent = 'No se pudieron cargar los locales. Intentá de nuevo en unos segundos.';
      console.error(e);
    }
  }

  function setBanner(b) {
    const desk = b.desktop || b.mobile;
    const mob = b.mobile || b.desktop;
    if (!desk) { els.banner.hidden = true; return; }
    els.bannerMobile.srcset = mob;
    els.bannerImg.src = desk;
    els.banner.hidden = false;
    measure();
  }

  /* ---------- filtros ---------- */
  function rubros() {
    const count = new Map();
    state.locales.forEach((l) => rubrosDe(l).forEach((r) => count.set(r, (count.get(r) || 0) + 1)));
    return [...count.entries()].sort((a, b) => collator.compare(a[0], b[0]));
  }

  function buildFilter() {
    const list = rubros();
    els.filterBtn.hidden = false;
    const opts = [['', state.locales.length, 'Todos los rubros'], ...list.map(([r, n]) => [r, n, r])];
    els.filterPop.innerHTML = opts.map(([val, n, label]) =>
      `<button class="filter-opt" role="menuitemradio" aria-checked="${val === state.rubro}" data-val="${esc(val)}"><span>${esc(label)}</span><small>${n}</small></button>`
    ).join('');
    if (!list.length) els.filterBtn.disabled = true;
  }

  function setRubro(val) {
    state.rubro = val;
    els.filterLabel.textContent = val ? val.toUpperCase() : 'FILTRAR';
    els.filterBtn.classList.toggle('active', !!val);
    els.filterPop.querySelectorAll('.filter-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.val === val)));
    toggleFilter(false);
    render();
  }

  function toggleFilter(open) {
    const willOpen = open ?? els.filterPop.hidden;
    els.filterPop.hidden = !willOpen;
    els.filterBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      // reinicia la animación de apertura
      els.filterPop.style.animation = 'none'; void els.filterPop.offsetWidth; els.filterPop.style.animation = '';
    }
  }

  /* ---------- render de la grilla (con animación FLIP) ---------- */
  function visible() {
    const q = norm(state.q);
    return state.locales
      .filter((l) => !state.rubro || rubrosDe(l).includes(state.rubro))
      .filter((l) => !q || norm(l.nombre).includes(q) || norm(l.rubro).includes(q))
      .sort((a, b) => collator.compare(a.nombre, b.nombre) * state.dir);
  }

  function makeCard(l) {
    const li = document.createElement('li');
    li.className = 'card enter';
    li.dataset.id = l.id;
    const promos = (l.promos || []).length;
    const logo = logoDe(l);
    li.innerHTML = `
      <button class="card-btn" type="button" aria-label="${esc(l.nombre)}${promos ? `, ${promos} ${promos === 1 ? 'promoción' : 'promociones'}` : ''}">
        <span class="tile ${logo ? 'has-logo' : ''}">
          ${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" decoding="async">` : `<span class="mono">${esc(initials(l.nombre))}</span>`}
          ${promos ? `<span class="badge" aria-hidden="true">${promos}</span>` : ''}
        </span>
        <span class="name"></span>
      </button>`;
    li.querySelector('button').addEventListener('click', () => openModal(l, li));
    const img = li.querySelector('img');
    if (img) img.addEventListener('error', () => {
      const tile = li.querySelector('.tile');
      tile.classList.remove('has-logo');
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'mono', textContent: initials(l.nombre) }));
    });
    return li;
  }

  let io;
  function reveal(li, delay) {
    li.style.setProperty('--d', delay + 'ms');
    li.classList.add('in');
    li.classList.remove('enter');
    setTimeout(() => li.style.removeProperty('--d'), delay + 900);
  }
  function observe(li) {
    if (reduced || !('IntersectionObserver' in window)) { li.classList.remove('enter'); return; }
    io.observe(li);
  }
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      let k = 0;
      entries.filter((e) => e.isIntersecting).forEach((e) => {
        io.unobserve(e.target);
        reveal(e.target, Math.min(k++ * 45, 700));
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  }

  function render() {
    const list = visible();
    const q = norm(state.q);
    const ids = new Set(list.map((l) => l.id));

    // FIRST: posiciones actuales
    const first = new Map();
    nodes.forEach((li, id) => { if (li.isConnected) first.set(id, li.getBoundingClientRect()); });

    // quitar los que ya no se muestran
    nodes.forEach((li, id) => {
      if (!ids.has(id) && li.isConnected) { if (io) io.unobserve(li); li.remove(); }
    });

    // agregar / reordenar
    const frag = document.createDocumentFragment();
    const fresh = [];
    list.forEach((l) => {
      let li = nodes.get(l.id);
      if (!li) { li = makeCard(l); nodes.set(l.id, li); }
      if (!li.isConnected) {
        li.classList.remove('in'); li.classList.add('enter');
        fresh.push(li);
      }
      li.querySelector('.name').innerHTML = highlight(l.nombre, q);
      frag.appendChild(li);
    });
    els.grid.appendChild(frag);

    // LAST + INVERT + PLAY
    if (!reduced) {
      list.forEach((l) => {
        const li = nodes.get(l.id);
        const a = first.get(l.id);
        if (!a || li.classList.contains('enter')) return;
        const b = li.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (!dx && !dy) return;
        li.style.transition = 'none';
        li.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          li.style.transition = 'transform .6s cubic-bezier(.22,1,.36,1)';
          li.style.transform = '';
          li.addEventListener('transitionend', function done(ev) {
            if (ev.propertyName !== 'transform') return;
            li.style.transition = ''; li.removeEventListener('transitionend', done);
          });
        });
      });
    }
    fresh.forEach(observe);

    els.empty.hidden = list.length > 0 || !state.locales.length;
    if (!state.locales.length) els.status.textContent = 'Todavía no hay locales cargados.';
  }

  /* ---------- ventana emergente ---------- */
  let lastFocus = null;
  function openModal(l, li) {
    lastFocus = li.querySelector('button');
    els.mTitle.textContent = l.nombre;
    const logo = logoDe(l);
    els.mRubro.textContent = rubrosDe(l).join(' · ');
    els.mLogo.className = 'modal-logo' + (logo ? ' has-logo' : '');
    els.mLogo.innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : `<span class="mono">${esc(initials(l.nombre))}</span>`;
    const promos = l.promos || [];
    els.mPromos.innerHTML = promos.length
      ? promos.map((p, i) => `<li class="promo" style="--i:${i}"><h3>${esc(p.titulo)}</h3>${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}</li>`).join('')
      : `<li class="promo-none">Este local no tiene promociones vigentes por el momento.</li>`;
    els.modal.classList.remove('closing');
    els.modal.hidden = false;
    document.body.classList.add('lock');
    const body = $('.modal-body', els.modal);
    body.scrollTop = 0;
    requestAnimationFrame(() => updateMask(body));
    $('.modal-x', els.modal).focus({ preventScroll: true });
  }

  function closeModal() {
    if (els.modal.hidden || els.modal.classList.contains('closing')) return;
    els.modal.classList.add('closing');
    setTimeout(() => {
      els.modal.hidden = true;
      els.modal.classList.remove('closing');
      document.body.classList.remove('lock');
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    }, reduced ? 0 : 240);
  }

  function updateMask(body) {
    body.classList.toggle('at-end', body.scrollHeight - body.scrollTop - body.clientHeight < 8);
  }

  /* ---------- barra pegajosa ---------- */
  function measure() {
    document.documentElement.style.setProperty('--hdr-h', els.hdr.offsetHeight + 'px');
    onScroll();
  }
  function onScroll() {
    const top = els.toolbar.getBoundingClientRect().top;
    els.toolbar.classList.toggle('stuck', top <= els.hdr.offsetHeight + 1 && window.scrollY > 4);
  }

  /* ---------- acceso de administrador ---------- */
  async function adminLogin(ev) {
    ev.preventDefault();
    const pin = els.pin.value.trim();
    els.adminMsg.textContent = '';
    if (!pin) { shake(); return; }
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'PIN incorrecto');
      sessionStorage.setItem('bbps_admin_pin', pin);
      location.href = '/admin';
    } catch (e) {
      els.adminMsg.textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message;
      shake();
    }
  }
  function shake() {
    els.adminForm.classList.remove('shake'); void els.adminForm.offsetWidth; els.adminForm.classList.add('shake');
  }

  /* ---------- eventos ---------- */
  let t;
  els.q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = els.q.value;
      render();
    }, 120);
  });
  els.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.q.blur(); });

  els.filterBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFilter(); });
  els.filterPop.addEventListener('click', (e) => {
    const b = e.target.closest('.filter-opt');
    if (b) setRubro(b.dataset.val);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.filter')) toggleFilter(false); });

  els.sortBtn.addEventListener('click', () => {
    state.dir *= -1;
    const desc = state.dir < 0;
    els.sortBtn.classList.toggle('desc', desc);
    els.sortBtn.title = desc ? 'Orden Z → A' : 'Orden A → Z';
    els.sortBtn.setAttribute('aria-label', desc ? 'Ordenar de la A a la Z' : 'Ordenar de la Z a la A');
    els.sortBtn.classList.remove('bump'); void els.sortBtn.offsetWidth; els.sortBtn.classList.add('bump');
    render();
  });

  els.clearBtn.addEventListener('click', () => {
    els.q.value = ''; state.q = '';
    setRubro('');
  });

  els.topBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    setTimeout(() => els.q.focus({ preventScroll: true }), reduced ? 0 : 600);
  });

  els.modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  $('.modal-body', els.modal).addEventListener('scroll', (e) => updateMask(e.currentTarget), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); toggleFilter(false); }
    if (e.key === 'Tab' && !els.modal.hidden) {
      // mantiene el foco dentro de la ventana
      const f = [...els.modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')];
      const body = $('.modal-body', els.modal);
      if (body.scrollHeight > body.clientHeight) { body.tabIndex = 0; f.push(body); }
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  els.adminForm.addEventListener('submit', adminLogin);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(els.hdr);

  measure();
  load();
})();

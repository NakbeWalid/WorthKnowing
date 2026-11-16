// Boîte à outils d'interface commune aux deux applications : icônes, logos, fenêtres, notifications,
// graphiques (Chart.js), jauge de dérive et portraits de personas. Aucune logique métier ici.

const UI = (() => {
  // ---------------------------------------------------------------- Icônes (traits 2 px, style Lucide)
  const PATHS = {
    arrowUp: '<path d="M7 17 17 7M8 7h9v9"/>',
    arrowDown: '<path d="M17 7 7 17M16 17H7V8"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    wallet: '<path d="M20 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M20 17v5H6.5a2.5 2.5 0 0 1 0-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    unlink: '<path d="m18.8 13.4 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 10.6l-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
    spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.2.3 1.6 1.4 2.7 2.5 2.7z"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    radio: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/><circle cx="12" cy="12" r="2"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;

  // ---------------------------------------------------------------- Logos
  /** Boréal : trois traits qui montent, comme une aurore et comme un cours. */
  const borealMark = (light = false) => `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="${light ? '#fff' : 'var(--a1)'}"/>
    <rect x="8" y="17" width="4" height="8" rx="2" fill="${light ? 'var(--a1)' : '#fff'}" opacity=".6"/>
    <rect x="14" y="12" width="4" height="13" rx="2" fill="${light ? 'var(--a1)' : '#fff'}" opacity=".8"/>
    <rect x="20" y="7" width="4" height="18" rx="2" fill="${light ? 'var(--a1)' : '#fff'}"/></svg>`;
  /** WorthKnowing : un cercle coupé par un axe ; à gauche ce que vous dites, à droite ce que vous faites. */
  const wkMark = (light = false) => `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="none" stroke="${light ? '#fff' : 'var(--ink)'}" stroke-width="2"/>
    <path d="M16 3a13 13 0 0 1 0 26z" fill="${light ? '#fff' : 'var(--a1)'}"/>
    <path d="M16 1v30" stroke="${light ? '#fff' : 'var(--ink)'}" stroke-width="2"/></svg>`;
  const logo = (app, { href = '/', light = false, size = '' } = {}) => app === 'boreal'
    ? `<a class="logo ${light ? 'light' : ''} ${size}" href="${href}" aria-label="Boréal Courtage">${borealMark(light)}<span class="logo-word">Boréal <i>Courtage</i></span></a>`
    : `<a class="logo ${light ? 'light' : ''} ${size}" href="${href}" aria-label="WorthKnowing">${wkMark(light)}<span class="logo-word">Worth<i>Knowing</i></span></a>`;

  // ---------------------------------------------------------------- Fenêtres
  function mountOverlay(inner, { onClose } = {}) {
    // Une fenêtre en train de se fermer disparaît tout de suite : jamais deux fenêtres superposées pendant le fondu.
    document.querySelectorAll('.overlay.closing').forEach((o) => o.remove());
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = inner;
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    const previous = document.activeElement;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      overlay.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        overlay.remove();
        if (!document.querySelector('.overlay')) document.body.style.overflow = '';
        previous?.focus?.();
      }, 200);
      onClose?.(value);
    };
    // Échap ne ferme que la fenêtre du dessus (un tiroir peut en ouvrir un autre).
    const onKey = (e) => { if (e.key === 'Escape' && [...document.querySelectorAll('.overlay:not(.closing)')].at(-1) === overlay) close(undefined); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(undefined); });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(undefined)));
    return { el: overlay, close };
  }

  /**
   * Fenêtre modale. `actions` = [{ label, value, kind }] ; résout à la `value` du bouton cliqué
   * (undefined si fermée par Échap ou un clic à l'extérieur).
   */
  function modal({ title = '', body = '', actions = [], wide = false, icon: ico = '' } = {}) {
    return new Promise((resolve) => {
      const m = mountOverlay(`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]+>/g, '')}">
        <div class="modal-head"><div>${ico}${title ? `<h2>${title}</h2>` : ''}</div>
          <button class="close-x" data-close aria-label="Fermer">${icon('x', 'sm')}</button></div>
        <div class="modal-body">${body}</div>
        ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.kind ?? 'ghost'}" data-action="${i}">${a.label}</button>`).join('')}</div>` : ''}
      </div>`, { onClose: resolve });
      m.el.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => m.close(actions[b.dataset.action].value)));
      (m.el.querySelector('.btn.primary, .btn:not(.ghost)') ?? m.el.querySelector('.close-x'))?.focus();
    });
  }
  /** Modale personnalisable : renvoie { el, close } pour la piloter (formulaires, mises à jour en direct). */
  const sheet = (html, opts = {}) => mountOverlay(`<div class="modal ${opts.size ?? (opts.wide ? 'wide' : '')}" role="dialog" aria-modal="true">${html}</div>`, opts);
  const confirm = (title, body, { ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) =>
    modal({ title, body: `<p class="muted">${body}</p>`, actions: [{ label: cancel, value: false }, { label: ok, value: true, kind: danger ? 'primary' : '' }] }).then(Boolean);
  const alert = (title, body) => modal({ title, body: `<p class="muted">${body}</p>`, actions: [{ label: 'Compris', value: true, kind: '' }] });

  function toast(message, kind = '') {
    let box = document.querySelector('.toasts');
    if (!box) { box = Object.assign(document.createElement('div'), { className: 'toasts' }); document.body.append(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon(kind === 'ok' ? 'check' : 'info')}<span>${message}</span>`;
    box.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 5200);
  }

  /** Change le contenu d'un conteneur avec une petite animation d'entrée. */
  function swap(el, html) {
    el.innerHTML = html;
    el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter');
  }

  /** Fait défiler un nombre jusqu'à sa valeur (une seule fois par valeur). */
  function countUp(el, to, format = (v) => Math.round(v).toLocaleString('fr-CA'), ms = 900) {
    if (!el) return;
    const from = Number(el.dataset.value ?? 0);
    el.dataset.value = to;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.innerHTML = format(to); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 4);
      el.innerHTML = format(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const initials = (name = '') => name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·';

  // ---------------------------------------------------------------- Jauge de dérive
  /** Demi-cercle 0–100 avec repère du seuil. */
  function gauge(score, threshold = 60, { dark = true } = {}) {
    const r = 80, c = Math.PI * r;
    const v = Math.max(0, Math.min(100, score));
    const color = v >= threshold ? 'var(--loss)' : v >= threshold * 0.66 ? 'var(--amber)' : (dark ? 'var(--a2)' : 'var(--a1)');
    const a = Math.PI * (1 - threshold / 100);
    const tx = 100 + r * Math.cos(a), ty = 100 - r * Math.sin(a);
    const tx2 = 100 + (r + 14) * Math.cos(a), ty2 = 100 - (r + 14) * Math.sin(a);
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    return `<div class="gauge" role="img" aria-label="Score de dérive ${v} sur 100, seuil ${threshold}">
      <svg viewBox="0 0 200 116">
        <path class="g-track" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke-width="14" stroke-linecap="round"/>
        <path class="g-value" id="${id}" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - v / 100)}"/>
        <line x1="${tx}" y1="${ty}" x2="${tx2}" y2="${ty2}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" opacity=".5"/>
        <text x="${tx2 + (tx2 > 100 ? 4 : -4)}" y="${ty2 - 2}" font-size="9" fill="var(--ink)" opacity=".5" text-anchor="${tx2 > 100 ? 'start' : 'end'}" font-family="Inter">seuil ${threshold}</text>
      </svg>
      <div class="g-center"><div class="g-score">${v}</div><div class="g-of">sur 100</div></div>
    </div>`;
  }
  /** Lance l'animation des jauges présentes dans `root`. */
  function animateGauges(root = document) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.g-value[data-target]').forEach((p) => {
      p.style.strokeDashoffset = p.dataset.target;
    })));
  }

  // ---------------------------------------------------------------- Graphiques (Chart.js)
  // Couleurs des graphiques : lues dans le thème de la page (canvas n'accepte pas var(--…)).
  const css = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
  const C = { inkrgb: css('--ink-rgb'), red: css('--a1'), ink: css('--ink'), plum: css('--a2'), gain: css('--gain'), amber: css('--amber'), gold: css('--a1'), teal: css('--a2'), loss: css('--loss'), bg: css('--bg'), a1rgb: css('--a1-rgb'), grid: `rgba(${css('--ink-rgb')},.08)`, muted: `rgba(${css('--ink-rgb')},.55)` };
  /** Recalcule les couleurs d'après le canvas lui-même : un graphique posé sur une carte sombre lit l'encre claire, même en mode clair. */
  const paint = (el) => {
    if (!el) return C;
    C.red = css('--a1', el); C.ink = css('--ink', el); C.plum = css('--a2', el); C.gain = css('--gain', el); C.loss = css('--loss', el); C.bg = css('--bg', el);
    C.a1rgb = css('--a1-rgb', el); C.inkrgb = css('--ink-rgb', el);
    C.grid = `rgba(${C.inkrgb},.08)`; C.muted = `rgba(${C.inkrgb},.55)`;
    return C;
  };
  const charts = new WeakMap();
  const hasChart = () => typeof window.Chart !== 'undefined';
  if (hasChart()) {
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.grid;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.animation.duration = 900;
    Chart.defaults.animation.easing = 'easeOutQuart';
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: css('--cream-3'), titleColor: css('--ink'), bodyColor: css('--ink'), padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { weight: '600' }, caretSize: 5,
    });
  }

  /** Repères : ligne verticale (index) et/ou horizontale (valeur), avec une étiquette. */
  const refLines = {
    id: 'refLines',
    afterDatasetsDraw(chart, _args, opts) {
      const { ctx, chartArea: a, scales } = chart;
      if (!opts) return;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      const ik = css('--ink-rgb', chart.canvas);
      ctx.strokeStyle = `rgba(${ik},.4)`;
      ctx.fillStyle = `rgba(${ik},.65)`;
      ctx.font = "500 11px Inter, sans-serif";
      if (opts.x != null) {
        const x = scales.x.getPixelForValue(opts.x);
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
        if (opts.xLabel) { ctx.textAlign = 'left'; ctx.fillText(opts.xLabel, x + 6, a.top + 11); }
      }
      if (opts.y != null) {
        const y = scales.y.getPixelForValue(opts.y);
        ctx.strokeStyle = `rgba(${css('--loss-rgb')},.7)`; ctx.fillStyle = css('--loss');
        ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
        if (opts.yLabel) { ctx.textAlign = 'right'; ctx.fillText(opts.yLabel, a.right, y - 6); }
      }
      ctx.restore();
    },
  };
  /** Ligne verticale qui suit le curseur. */
  const crosshair = {
    id: 'crosshair',
    afterDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.();
      if (!active?.length) return;
      const { ctx, chartArea: a } = chart;
      const x = active[0].element.x;
      ctx.save(); ctx.strokeStyle = `rgba(${css('--ink-rgb', chart.canvas)},.22)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
    },
  };

  function chart(canvas, config) {
    if (!hasChart() || !canvas) return null;
    charts.get(canvas)?.destroy();
    paint(canvas);
    config.options = { color: C.muted, borderColor: C.grid, ...config.options };
    // Couleurs explicites par axe : les valeurs par défaut globales de Chart.js ne suivent pas le thème d'une carte sombre.
    for (const axis of Object.values(config.options.scales ?? {})) {
      axis.ticks = { color: C.muted, ...axis.ticks };
      axis.grid = { color: C.grid, ...axis.grid };
    }
    const c = new Chart(canvas, config);
    charts.set(canvas, c);
    return c;
  }
  const rgbOf = (hex) => { if (/^rgb/.test(hex)) return hex.match(/[\d.]+/g).slice(0, 3).join(','); const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h; return [0, 2, 4].map((k) => parseInt(f.slice(k, k + 2), 16)).join(','); };
  const fade = (color, top = .22) => (ctx) => {
    const { chart: ch } = ctx;
    if (!ch.chartArea) return 'transparent';
    const g = ch.ctx.createLinearGradient(0, ch.chartArea.top, 0, ch.chartArea.bottom);
    g.addColorStop(0, `rgba(${rgbOf(color)},${top})`); g.addColorStop(1, `rgba(${rgbOf(color)},0)`);
    return g;
  };

  /** Courbe à aire dégradée. `opts`: { color, format, height, ref, showX, minimal } */
  function area(canvas, labels, values, opts = {}) {
    paint(canvas);
    const color = opts.color ?? C.red;
    return chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: color, borderWidth: opts.width ?? 2.2, fill: true, backgroundColor: fade(color, opts.fill ?? .22), pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: color, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, tension: .35 }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 6 } },
        scales: {
          x: { display: !opts.minimal && opts.showX !== false, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 24, ...(opts.tick ? { color: opts.tick } : {}) } },
          y: { display: !opts.minimal, position: 'right', grid: { color: opts.grid ?? C.grid }, border: { display: false }, ticks: { maxTicksLimit: 4, callback: opts.format ?? ((v) => v), ...(opts.tick ? { color: opts.tick } : {}) }, grace: '8%' },
        },
        plugins: { tooltip: { enabled: !opts.minimal, callbacks: { label: (c) => (opts.format ?? ((v) => v))(c.parsed.y) } }, refLines: opts.ref },
      },
      plugins: [refLines, crosshair],
    });
  }

  /** Courbe d'une mise en situation : le passé en encre, la suite réelle en rouge après la décision. */
  function scenario(canvas, context, forward = []) {
    paint(canvas);
    const all = context.concat(forward.slice(1));
    const labels = all.map((_, i) => i - (context.length - 1));
    const past = all.map((v, i) => (i < context.length ? v : null));
    const after = all.map((v, i) => (i >= context.length - 1 && forward.length ? v : null));
    return chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { data: past, borderColor: C.ink, borderWidth: 2, pointRadius: 0, tension: .25, fill: true, backgroundColor: fade(C.ink, .08) },
        { data: after, borderColor: C.red, borderWidth: 2.6, pointRadius: 0, tension: .25, fill: true, backgroundColor: fade(C.red, .14) },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 6, callback: function (v) { const d = this.getLabelForValue(v); return d === 0 ? 'décision' : (d > 0 ? '+' : '') + d + ' j'; } } },
          y: { position: 'right', grid: { color: C.grid }, border: { display: false }, ticks: { maxTicksLimit: 4 } },
        },
        plugins: {
          tooltip: { callbacks: { title: (items) => { const d = Number(items[0].label); return d === 0 ? 'Jour de la décision' : d < 0 ? `${-d} séances avant` : `${d} séances après`; }, label: (c) => `Base 100 : ${c.parsed.y.toFixed(1)}` }, filter: (i) => i.raw != null },
          refLines: forward.length ? { x: context.length - 1, xLabel: 'votre décision' } : undefined,
        },
      },
      plugins: [refLines, crosshair],
    });
  }

  const RADAR_LABELS = ['Risque', 'Pertes', '« Hype »', 'Concentration', 'Impulsivité', 'Nouvelles'];
  const KEYS = ['riskTolerance', 'lossAversion', 'fomo', 'concentration', 'impulsivity', 'newsSensitivity'];
  /** Radar 6 axes : `a` en pointillé encre, `b` en rouge plein. */
  function radar(canvas, a, b, { aLabel = 'Ce que vous dites', bLabel = 'Ce que vous faites' } = {}) {
    paint(canvas);
    return chart(canvas, {
      type: 'radar',
      data: { labels: RADAR_LABELS, datasets: [
        { label: aLabel, data: KEYS.map((k) => a?.[k] ?? 50), borderColor: C.ink, borderWidth: 1.6, borderDash: [5, 4], backgroundColor: `rgba(${C.inkrgb},.05)`, pointRadius: 3, pointBackgroundColor: C.ink, pointBorderWidth: 0 },
        { label: bLabel, data: KEYS.map((k) => b?.[k] ?? 50), borderColor: C.red, borderWidth: 2.2, backgroundColor: `rgba(${C.a1rgb},.24)`, pointRadius: 3.5, pointBackgroundColor: C.red, pointBorderColor: C.bg, pointBorderWidth: 1.5 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: `rgba(${C.inkrgb},.10)` }, angleLines: { color: `rgba(${C.inkrgb},.10)` }, pointLabels: { font: { size: 11.5, weight: '600' }, color: `rgba(${C.inkrgb},.78)` } } },
        plugins: { tooltip: { displayColors: true, callbacks: { label: (c) => ` ${c.dataset.label} : ${c.parsed.r}` } } },
      },
    });
  }

  /** Anneau de répartition. */
  function donut(canvas, labels, values, colors) {
    paint(canvas);
    return chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: C.bg, borderWidth: 3, hoverOffset: 6, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '74%', plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label} : ${(c.parsed * 100 / c.dataset.data.reduce((s, v) => s + v, 0)).toFixed(0)} %` } } } },
    });
  }

  /** Évolution de la dérive ordre après ordre, avec le seuil. */
  function driftLine(canvas, labels, values, threshold, flags = [], opts = {}) {
    paint(canvas);
    const hot = (v, i) => flags[i] || v >= threshold;
    const sel = opts.selected;
    return chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{
        data: values, borderColor: C.plum, borderWidth: 2, cubicInterpolationMode: 'monotone', fill: true, backgroundColor: fade(C.plum, .10),
        pointRadius: values.map((_, i) => (i === sel ? 7 : flags[i] ? 5 : 3.5)), pointHoverRadius: 7,
        pointBackgroundColor: values.map((v, i) => (hot(v, i) ? C.red : C.bg)), pointBorderColor: values.map((v, i) => (hot(v, i) ? C.red : C.plum)),
        pointBorderWidth: values.map((_, i) => (i === sel ? 3 : 1.8)),
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onClick: (_e, els) => { if (els.length && opts.onSelect) opts.onSelect(els[0].index); },
        onHover: (e, els) => { if (opts.onSelect) e.native.target.style.cursor = els.length ? 'pointer' : ''; },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkipPadding: 24 } },
          y: { min: 0, max: 100, position: 'right', grid: { color: C.grid }, border: { display: false }, ticks: { stepSize: 25 } },
        },
        plugins: { refLines: { y: threshold, yLabel: `seuil ${threshold}` }, tooltip: { callbacks: { label: (c) => `Dérive : ${c.parsed.y}${flags[c.dataIndex] ? ' · règle outrepassée' : ''}` } } },
      },
      plugins: [refLines, crosshair],
    });
  }

  // ---------------------------------------------------------------- Les agents de l'enquête
  /** L'équipe d'agents de WorthKnowing, dans l'ordre où ils travaillent sur un ordre. */
  const AGENTS = {
    marche: { name: 'Marché', role: 'Prix et volatilité', icon: 'chart', color: 'var(--a1)' },
    nouvelles: { name: 'Nouvelles', role: 'Manchettes · 7 jours', icon: 'news', color: 'var(--a1)' },
    gouvernance: { name: 'Gouvernance', role: 'Vos règles', icon: 'shield', color: 'var(--a1)' },
    comportement: { name: 'Comportement', role: 'Écarts au profil', icon: 'activity', color: 'var(--a1)' },
    influence: { name: 'Influence', role: 'IA · Amazon Bedrock', icon: 'spark', color: 'var(--a2)', ai: true },
    profil: { name: 'Profil', role: 'Mise à jour', icon: 'target', color: 'var(--a1)' },
    explication: { name: 'Explicabilité', role: 'Synthèse et sources', icon: 'book', color: 'var(--a1)' },
  };
  /** Retrouve l'agent à partir du libellé d'une étape renvoyée par le serveur (« Agent marché », …). */
  const agentKey = (label = '') => {
    const t = label.toLowerCase();
    return t.includes('march') ? 'marche' : t.includes('nouvelle') ? 'nouvelles' : t.includes('gouvern') ? 'gouvernance'
      : t.includes('comportement') ? 'comportement' : t.includes('influence') ? 'influence' : t.includes('profil') ? 'profil' : 'explication';
  };
  /**
   * Rangée d'agents reliés. mode 'done' : ils rendent leur rapport l'un après l'autre (coche) ;
   * mode 'working' : ils s'allument à tour de rôle. `clickable` en fait des onglets (data-agent).
   */
  function agents(keys = Object.keys(AGENTS), { mode = 'done', selected = null, size = '', clickable = false, dark = false } = {}) {
    return `<div class="agents ${mode === 'working' ? 'working' : 'play'} ${size} ${dark ? 'on-dark' : ''}" ${clickable ? 'role="tablist"' : 'role="img"'} aria-label="Agents de l’enquête">${keys.map((k, i) => {
      const a = AGENTS[k];
      const tag = clickable ? 'button' : 'div';
      return `<${tag} class="agent" style="--c:${a.color};--i:${i}" ${clickable ? `type="button" role="tab" data-agent="${k}" aria-selected="${k === selected}"` : ''}>
        <span class="agent-orb">${icon(a.icon)}${a.ai ? '<span class="agent-ai">IA</span>' : ''}<span class="agent-check">${icon('check')}</span></span>
        <b>${a.name}</b><small>${a.role}</small></${tag}>`;
    }).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Portraits de personas
  /**
   * Caractère d'investisseur, déduit du profil actuel : le trait le plus marqué l'emporte.
   * Sert uniquement à regrouper visuellement les personas dans la vue admin.
   */
  const ARCHETYPES = {
    audacieux: { name: 'L’Audacieux', line: 'Cherche le rendement, accepte la volatilité', color: '#d7001f', tint: '#fbe3e6', glyph: 'flame' },
    prudent: { name: 'Le Prudent', line: 'Protège son capital avant tout', color: '#2f5d50', tint: '#e2ece6', glyph: 'shield' },
    tendance: { name: 'Le Chasseur de tendances', line: 'Suit l’engouement du marché', color: '#c25a00', tint: '#f8e7d6', glyph: 'trend' },
    concentre: { name: 'Le Convaincu', line: 'Mise gros sur peu de titres', color: '#7a1f3d', tint: '#f1e0e6', glyph: 'target' },
    impulsif: { name: 'L’Impulsif', line: 'Décide vite, parfois trop', color: '#e0533d', tint: '#fbe6e0', glyph: 'zap' },
    reactif: { name: 'Le Réactif', line: 'Réagit fort aux nouvelles', color: '#355c8a', tint: '#e2e9f2', glyph: 'radio' },
    equilibre: { name: 'L’Équilibré', line: 'Aucun trait ne domine', color: '#6b6157', tint: '#ece7e0', glyph: 'scale' },
    attente: { name: 'En évaluation', line: 'Profil pas encore établi', color: '#9b9187', tint: '#efebe5', glyph: 'hourglass' },
  };
  const TRAIT_TO_ARCH = { riskTolerance: 'audacieux', lossAversion: 'prudent', fomo: 'tendance', concentration: 'concentre', impulsivity: 'impulsif', newsSensitivity: 'reactif' };
  function archetypeOf(profile) {
    if (!profile) return { key: 'attente', ...ARCHETYPES.attente };
    let best = null, bestScore = -Infinity;
    for (const [k, v] of Object.entries(profile)) {
      if (!(k in TRAIT_TO_ARCH)) continue;
      // La prudence se lit aussi dans un faible appétit pour le risque.
      const s = k === 'lossAversion' ? Math.max(v, 100 - (profile.riskTolerance ?? 50)) - 50 : v - 50;
      if (s > bestScore) { bestScore = s; best = k; }
    }
    const key = bestScore < 14 ? 'equilibre' : TRAIT_TO_ARCH[best];
    return { key, ...ARCHETYPES[key] };
  }
  const hash = (s = '') => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const SKIN = ['#f1d5bd', '#e2b48f', '#c58c63', '#8f5e3c', '#f6dfcb'];
  const HAIR = ['#2a1d16', '#5a3a22', '#1d1420', '#8a5a33', '#b9b2a8'];
  /** Portrait illustré : buste dans la couleur du caractère, coiffure et teint propres à la personne, emblème du caractère. */
  function portrait(seed, arch, size = 72) {
    const h = hash(seed);
    const skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 3) % HAIR.length], style = (h >> 6) % 4;
    const hairs = [
      `<path d="M38 50c0-14 10-22 22-22s22 8 22 22c-4-6-10-9-22-9s-18 3-22 9z" fill="${hair}"/>`,
      `<path d="M37 54c-2-18 9-28 23-28s25 10 23 28c-3-9-6-13-11-14-6 4-17 5-27 2-4 3-6 7-8 12z" fill="${hair}"/>`,
      `<path d="M36 58c-3-20 8-32 24-32s27 12 24 32l-3-10c-6-6-14-8-21-8s-15 2-21 8z" fill="${hair}"/><path d="M36 58c-1 10 0 18 2 24l4-2c-2-8-3-15-2-22z" fill="${hair}"/><path d="M84 58c1 10 0 18-2 24l-4-2c2-8 3-15 2-22z" fill="${hair}"/>`,
      `<path d="M39 47c3-12 12-18 21-18 11 0 19 7 21 18-6-4-13-6-21-6s-15 2-21 6z" fill="${hair}"/>`,
    ];
    const g = arch.glyph;
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${arch.name}">
      <defs><clipPath id="pc${h}"><circle cx="60" cy="60" r="60"/></clipPath></defs>
      <g clip-path="url(#pc${h})">
        <rect width="120" height="120" fill="${arch.tint}"/>
        <circle cx="60" cy="60" r="44" fill="${arch.color}" opacity=".08"/>
        <path d="M18 124c0-26 18-42 42-42s42 16 42 42z" fill="${arch.color}"/>
        <path d="M50 82h20l-10 12z" fill="#fffdf9" opacity=".9"/>
        <rect x="53" y="66" width="14" height="18" rx="6" fill="${skin}"/>
        <ellipse cx="60" cy="54" rx="20" ry="23" fill="${skin}"/>
        ${hairs[style]}
      </g>
      <circle cx="96" cy="96" r="17" fill="#fffdf9"/>
      <circle cx="96" cy="96" r="14" fill="${arch.color}"/>
      <g transform="translate(86 86) scale(.84)" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${PATHS[g]}</g>
    </svg>`;
  }

  // Chaque graphique retient comment il a été construit : au changement de thème, il est refait avec les nouvelles couleurs.
  const rebuilders = new Map();
  const remember = (fn) => (canvas, ...args) => { if (canvas) rebuilders.set(canvas, () => fn(canvas, ...args)); return fn(canvas, ...args); };
  function repaintCharts() {
    Object.assign(C, { inkrgb: css('--ink-rgb'), red: css('--a1'), ink: css('--ink'), plum: css('--a2'), gain: css('--gain'), amber: css('--amber'), gold: css('--a1'), teal: css('--a2'), loss: css('--loss'), bg: css('--bg') });
    for (const [canvas, rebuild] of [...rebuilders]) {
      if (!canvas.isConnected) { rebuilders.delete(canvas); continue; }
      try { rebuild(); } catch { /* graphique retiré entre-temps */ }
    }
  }

  return {
    repaintCharts,
    icon, logo, borealMark, wkMark, modal, sheet, confirm, alert, toast, swap, countUp, initials,
    gauge, animateGauges, chart, area: remember(area), scenario: remember(scenario), radar: remember(radar), donut: remember(donut), driftLine: remember(driftLine), AGENTS, agentKey, agents, paths: PATHS, archetypeOf, portrait, ARCHETYPES, KEYS, C,
  };
})();

/* ---------------------------------------------------------------- Mode sombre / mode clair
   Choix mémorisé dans le navigateur, séparément pour chaque application ; clair par défaut.
   La bascule est immédiate, sans rechargement : la page garde son état (questionnaire en cours, ordre en préparation…).
   Les graphiques sont reconstruits avec les couleurs du nouveau thème ; l'événement « themechange » prévient les pages. */
(function () {
  const KEY = 'wk-theme';
  const read = () => {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  };
  // Chaque application garde son propre thème (stockage propre à son origine) ; l'ancien témoin partagé est effacé.
  try { document.cookie = `${KEY}=; path=/; max-age=0`; } catch { /* ignoré */ }
  let theme = read();
  document.documentElement.dataset.theme = theme;
  const dress = (b) => {
    b.title = theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = UI.icon(theme === 'light' ? 'moon' : 'sun', 'sm');
  };
  const apply = (next) => {
    theme = next;
    try { localStorage.setItem(KEY, theme); } catch { /* ignoré */ }
    document.documentElement.dataset.theme = theme;
    const b = document.getElementById('themeToggle');
    if (b) dress(b);
    UI.repaintCharts();
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  };
  const place = () => {
    const out = document.getElementById('logout');
    if (!out || document.getElementById('themeToggle')) return !!out;
    const b = document.createElement('button');
    b.id = 'themeToggle'; b.className = 'btn soft icon-only'; b.type = 'button';
    dress(b);
    b.onclick = () => apply(theme === 'light' ? 'dark' : 'light');
    out.before(b);
    return true;
  };
  if (!place()) new MutationObserver((_, obs) => { if (place()) obs.disconnect(); }).observe(document.body, { childList: true, subtree: true });
  // Le thème choisi dans un autre onglet de la même application est repris au retour sur la page.
  const sync = () => { const t = read(); if (t !== theme) apply(t); };
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
})();

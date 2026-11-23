/* ============================================================================
   Koivikko page translations (no dependencies)

   - The HTML is written in English. For other languages, every text and label
     whose English wording is listed in lang/<code>.js ("static") is swapped.
   - Text built by the scripts uses KoivikkoI18n.t('key', {vars}) ("ui").
   - To add a language: create lang/<code>.js, add it to LANGS below,
     add a flag in assets/img/flags/, and load the file in each page <head>.
   Loaded WITHOUT defer in <head> so the language is known before the page shows.
   ============================================================================ */
(() => {
  'use strict';
  const LANGS = [
    { code: 'en', name: 'English', flag: 'assets/img/flags/au.svg', locale: 'en' },
    { code: 'fi', name: 'Suomi', flag: 'assets/img/flags/fi.svg', locale: 'fi' },
  ];
  const PACKS = window.KOIVIKKO_LANG || {};
  const valid = (c) => LANGS.some((l) => l.code === c);

  // Pick the language: ?lang= → /fi or /en path → saved choice → browser language → English
  function detect() {
    try {
      const q = (new URLSearchParams(location.search).get('lang') || '').toLowerCase();
      if (valid(q)) { localStorage.setItem('k_lang', q); return q; }
    } catch { /* storage blocked */ }
    const p = (location.pathname.match(/^\/(en|fi)(\/|$)/) || [])[1];
    if (valid(p)) return p;
    try { const s = localStorage.getItem('k_lang'); if (valid(s)) return s; } catch { /* ignore */ }
    const nav = (navigator.languages || [navigator.language || '']).map((l) => (l || '').slice(0, 2).toLowerCase());
    return nav.find(valid) || 'en';
  }
  const lang = detect();
  const meta = LANGS.find((l) => l.code === lang);
  const pack = PACKS[lang] || {};
  document.documentElement.lang = lang;
  // Hide the page for a moment while a non-English page is translated (no flash of English)
  if (lang !== 'en') {
    document.documentElement.classList.add('i18n-pending');
    setTimeout(() => document.documentElement.classList.remove('i18n-pending'), 1500); // safety net
  }

  // ---------------------------------------------------------------- ui strings (built by scripts)
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // English defaults live in EN below; other languages override them in their pack's "ui"
  const EN = window.KOIVIKKO_LANG_EN || {};
  function fill(str, vars, html) {
    return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? (html ? esc(vars[k]) : String(vars[k])) : m));
  }
  const raw = (key) => (pack.ui && key in pack.ui ? pack.ui[key] : EN[key] != null ? EN[key] : key);
  const t = (key, vars) => fill(raw(key), vars, false);
  // For strings that contain our own markup (<strong> etc.): variables are HTML-escaped
  const tHtml = (key, vars) => fill(raw(key), vars, true);

  // ---------------------------------------------------------------- static page text
  const ATTRS = ['aria-label', 'alt', 'placeholder', 'title'];
  const SKIP = 'script,style,noscript,code,[data-i18n-skip]';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function translateStatic(root) {
    const map = pack.static;
    if (!map) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      if (!n.parentElement || n.parentElement.closest(SKIP)) return;
      const key = norm(n.nodeValue);
      if (!key || !(key in map)) return;
      const lead = n.nodeValue.match(/^\s*/)[0]; const trail = n.nodeValue.match(/\s*$/)[0];
      n.nodeValue = lead + map[key] + trail;
    });
    root.querySelectorAll('*').forEach((el) => {
      if (el.closest(SKIP)) return;
      ATTRS.forEach((a) => { const v = el.getAttribute(a); if (v && norm(v) in map) el.setAttribute(a, map[norm(v)]); });
    });
    // Language-specific links (e.g. koivikko.org/en → Finnish homepage)
    if (pack.links) root.querySelectorAll('a[href]').forEach((a) => { const h = a.getAttribute('href'); if (h in pack.links) a.setAttribute('href', pack.links[h]); });
    // <title> and meta description
    if (map[norm(document.title)]) document.title = map[norm(document.title)];
    document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').forEach((m) => {
      const v = norm(m.getAttribute('content') || ''); if (map[v]) m.setAttribute('content', map[v]);
    });
  }

  // ---------------------------------------------------------------- flag dropdown
  function buildDropdown() {
    const host = document.getElementById('langMenu');
    if (!host) return;
    host.textContent = '';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'lang-btn'; btn.id = 'langBtn';
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', t('lang.button', { name: meta.name }));
    const flag = (src) => { const i = document.createElement('img'); i.src = src; i.alt = ''; i.width = 22; i.height = 15; i.className = 'lang-flag'; return i; };
    const code = document.createElement('span'); code.className = 'lang-code'; code.textContent = lang.toUpperCase();
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('aria-hidden', 'true'); chev.classList.add('lang-chev');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M7 10l5 5 5-5z'); chev.append(path);
    btn.append(flag(meta.flag), code, chev);

    const list = document.createElement('ul');
    list.className = 'lang-list'; list.id = 'langList'; list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('lang.list')); list.hidden = true;
    LANGS.forEach((l) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.dataset.lang = l.code; li.tabIndex = -1;
      li.setAttribute('aria-selected', String(l.code === lang)); li.lang = l.code;
      const name = document.createElement('span'); name.textContent = l.name;
      li.append(flag(l.flag), name);
      if (l.code === lang) { const tick = document.createElement('span'); tick.className = 'lang-tick'; tick.setAttribute('aria-hidden', 'true'); tick.textContent = '✓'; li.append(tick); }
      list.append(li);
    });
    host.append(btn, list);

    const items = () => [...list.querySelectorAll('[role=option]')];
    const open = () => { list.hidden = false; btn.setAttribute('aria-expanded', 'true'); (items().find((i) => i.dataset.lang === lang) || items()[0]).focus(); };
    const close = (focusBtn) => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); };
    const choose = (c) => { close(true); setLang(c); };
    btn.addEventListener('click', () => (list.hidden ? open() : close(false)));
    btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } });
    list.addEventListener('click', (e) => { const li = e.target.closest('[role=option]'); if (li) choose(li.dataset.lang); });
    list.addEventListener('keydown', (e) => {
      const all = items(); const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); all[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); all[all.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(all[i].dataset.lang); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    document.addEventListener('click', (e) => { if (!host.contains(e.target)) close(false); });
  }

  // Switching reloads the page in the new language (the donor's country is remembered)
  function setLang(c) {
    if (!valid(c) || c === lang) return;
    try { localStorage.setItem('k_lang', c); } catch { /* ignore */ }
    (window.dataLayer = window.dataLayer || []).push({ event: 'lang_switch', to: c });
    const u = new URL(location.href);
    u.searchParams.set('lang', c);
    if (/^\/(en|fi)\/?$/.test(u.pathname)) u.pathname = '/';
    location.replace(u.toString());
  }

  // Translate as soon as the HTML has been read ("interactive"), which is BEFORE the deferred
  // scripts run, so a Finnish page is hidden only for that moment, not until app.js has
  // downloaded and run. A second pass at DOMContentLoaded picks up any English the scripts
  // added. (Running it twice is safe: no Finnish text is also an English key.)
  let applied = false;
  function apply() {
    if (applied) return;
    applied = true;
    translateStatic(document.body);
    buildDropdown();
    document.documentElement.classList.remove('i18n-pending');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') apply(); });
    document.addEventListener('DOMContentLoaded', () => { apply(); if (lang !== 'en') translateStatic(document.body); });
  } else apply();

  window.KoivikkoI18n = { lang, locale: meta.locale, langs: LANGS, t, tHtml, setLang, translate: translateStatic };
})();

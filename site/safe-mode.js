/* ============================================================================
   Safe mode for the donation form (no dependencies). Loaded in <head> on index.html.

   If a key file (config.js, api.js, country.js or app.js) fails to load or stops with
   an error, the Donate button would otherwise do a plain form submit: the page just
   reloads and nothing is explained. Instead, giving is paused with a clear message,
   a "Refresh the page" link and a link to the bank transfer details (which need no
   scripts). app.js sets window.KoivikkoAppReady = true at the very end of a good start.
   ============================================================================ */
(() => {
  'use strict';
  const ready = () => window.KoivikkoAppReady === true;
  const t = (k, en) => { try { const I = window.KoivikkoI18n; const v = I ? I.t(k) : k; return v === k ? en : v; } catch { return en; } };

  // Until app.js is running, the Donate form never submits the old-fashioned way
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'donateForm' && !ready()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  function safeMode() {
    const form = document.getElementById('donateForm');
    if (!form || ready() || document.getElementById('safeModeNote')) return;
    const btn = document.getElementById('donateBtn');
    if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
    const note = document.createElement('p');
    note.id = 'safeModeNote'; note.className = 'safe-note'; note.setAttribute('role', 'alert');
    note.append(t('safe.note', 'Online giving is paused because part of this page didn’t load. Nothing was charged.') + ' ');
    const refresh = document.createElement('a');
    refresh.href = location.pathname + location.search; refresh.id = 'safeModeRefresh';
    refresh.textContent = t('safe.link', 'Refresh the page');
    const bank = document.createElement('a');
    bank.href = '#ways'; bank.textContent = t('err.altBank', 'Or give by bank transfer instead');
    note.append(refresh, '. ', bank);
    (btn || form).after(note);
    (window.dataLayer = window.dataLayer || []).push({ event: 'safe_mode', reason: 'scripts_missing' });
  }
  // Deferred scripts (config, api, country, app) have all run, or failed, by DOMContentLoaded
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeMode);
  else safeMode();
})();

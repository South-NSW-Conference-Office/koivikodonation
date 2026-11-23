/* Thank-you page (PRD 6.11) */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const CFG = window.KOIVIKKO_CONFIG || {};
  const I18N = window.KoivikkoI18n || { lang: 'en', locale: 'en', t: (k) => k, tHtml: (k) => k };
  const id = new URLSearchParams(location.search).get('session_id');
  const base = CFG.campaignUrl || location.href.replace(/thank-you(\.html)?.*$/, '');
  const shareUrl = base + '?utm_source=share&utm_medium=referral&utm_campaign=koivikko_give';
  const msg = I18N.t('ty.shareMsg');
  // Events for analytics.js; printed to the console only on this computer (localhost), never live
  const DEBUG = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const track = (event, props = {}) => { (window.dataLayer = window.dataLayer || []).push({ event, ...props }); if (DEBUG) console.info('[track]', { event, ...props }); };

  $('wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg + ' ' + shareUrl);
  $('fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl);
  $('em').href = 'mailto:?subject=' + encodeURIComponent(I18N.t('ty.shareSubject')) + '&body=' + encodeURIComponent(msg + '\n\n' + shareUrl);
  $('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = I18N.t('ty.copied'); } catch { e.target.textContent = shareUrl; }
  });
  document.querySelectorAll('[data-share]').forEach((el) => el.addEventListener('click', () => track('share_click', { channel: el.dataset.share })));
  // Tour of the main website, and a way back to give again
  if ($('tourLink')) $('tourLink').addEventListener('click', () => track('tour_click'));
  if ($('giveAgain')) $('giveAgain').addEventListener('click', () => track('give_again_click'));

  if (!id) return;
  // Take the gift's id out of the address bar and the browser history, so a shared
  // computer or a copied link cannot be used to open this donor's gift.
  try { history.replaceState(null, '', location.pathname); } catch { /* keep the address as it is */ }
  KoivikkoApi.session(id).catch(() => null).then((s) => {
    // Validate session data; fall back to the generic message if anything looks wrong
    if (!s || s.paid !== true || !(typeof s.amount === 'number' && s.amount > 0) || !/^[A-Z]{3}$/.test(s.currency || '')) return;
    let a;
    try { a = new Intl.NumberFormat(I18N.locale, { style: 'currency', currency: s.currency }).format(s.amount); } catch { return; }
    // Our own sentence with the amount HTML-escaped (tHtml), so nothing from the server becomes markup
    $('gift').innerHTML = I18N.tHtml(s.frequency === 'monthly' ? 'ty.monthly' : 'ty.once', { amount: a });
    track('donation_success', { amount: s.amount, frequency: s.frequency, currency: s.currency });
    if (s.frequency !== 'monthly' || KoivikkoApi.isMock) return;
    // Monthly supporters get a direct link to Stripe's page for cancelling or changing the card
    $('manageWrap').hidden = false;
    $('manage').addEventListener('click', async () => {
      try {
        const u = new URL((await KoivikkoApi.portal(id)).url);
        if (u.protocol !== 'https:' || u.hostname !== 'billing.stripe.com' || u.port || u.username || u.password) throw new Error('bad address');
        location.href = u.href;
      } catch { $('manage').textContent = I18N.t('manage.unavailable'); }
    });
  });
})();

/* US donor hand-off page: links out to OCI once config.js has ociUrl (Q8) */
(() => {
  'use strict';
  const url = (window.KOIVIKKO_CONFIG || {}).ociUrl;
  const go = document.getElementById('go');
  // Only allow an https link, so a typo in config can never become a javascript: URL
  const ok = typeof url === 'string' && /^https:\/\//i.test(url);
  if (ok) go.href = url;
  go.addEventListener('click', (e) => {
    (window.dataLayer = window.dataLayer || []).push({ event: 'us_oci_continue' });
    if (!ok) { e.preventDefault(); document.getElementById('pending').hidden = false; }
  });
})();

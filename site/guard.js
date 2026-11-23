/* Console scam warning (shown to anyone who opens the browser's developer tools).
   Protects donors who are tricked into pasting code there ("paste this to get your receipt").
   It blocks nothing and does not get in the way of developers. Loaded after i18n.js. */
(() => {
  'use strict';
  try {
    const I = window.KoivikkoI18n;
    const t = (k, en) => { const v = I ? I.t(k) : k; return v === k ? en : v; };
    const title = t('console.title', 'Stop!');
    const body = t('console.body', 'This part of the browser is for developers. If someone told you to copy or paste something here, it is a scam. Koivikko will never ask you to do this.');
    console.log('%c' + title, 'color:#c62828;font:700 42px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;');
    console.log('%c' + body, 'color:inherit;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;');
  } catch { /* console not available: nothing to do */ }
})();

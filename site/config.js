/* ============================================================================
   Koivikko donation page: FRONT-END SETTINGS
   This is the only file most people need to edit.
   ============================================================================ */
window.KOIVIKKO_CONFIG = {
  // --- Backend hand-off -----------------------------------------------------
  // true  = the page uses built-in demo data (no backend needed)
  // false = the page calls the real backend at `apiBase` (contract: backend/README.md)
  // Opened as a file (double-click) it stays a demo; served from a web address it is real.
  // Adding ?demo=1 to the address also switches to demo data (remembered for that browser tab,
  // so checkout preview and thank-you pages stay in demo too). Handy for reviewing on localhost.
  // Only on localhost and the sandbox: on the live site ?demo=1 is ignored, so nobody can
  // share a link that shows demo numbers or a preview checkout.
  mockApi: location.protocol === 'file:' || (() => {
    try {
      const reviewHost = ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.includes('sandbox');
      if (!reviewHost) { sessionStorage.removeItem('k_demo'); return false; }
      if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('k_demo', '1');
      return sessionStorage.getItem('k_demo') === '1';
    } catch { return false; }
  })(),
  // The backend (Cloudflare Worker), picked by where the page runs:
  //   localhost / 127.0.0.1      -> local backend (npm run dev)
  //   the sandbox copy (workers.dev, name contains "sandbox") -> sandbox backend, Stripe TEST mode
  //   anywhere else (give.koivikko.org) -> LIVE backend, real payments
  // Each address must be listed under "connect-src" in the Content-Security-Policy line at the
  // top of index.html and thank-you.html.
  apiBase: ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8787'
    : location.hostname.includes('sandbox') ? 'https://koivikko-donate-sandbox.koivikko-donate-backend.workers.dev'
    : 'https://koivikko-donate.koivikko-donate-backend.workers.dev',
  // Cloudflare Turnstile site key (spam check). Live widget "Koivikko donation page (live)" only
  // works on give.koivikko.org; the sandbox widget covers the sandbox copy and localhost.
  turnstileSiteKey: location.hostname === 'give.koivikko.org' ? '0x4AAAAAAGOhErPDj8QX797n' : '0x4AAAAAAGIk6iUJR8Z0rDFv',
  // true = also run the spam check before a gift can start (stops stolen-card testing).
  // Must match TURNSTILE_ON_CHECKOUT in backend/wrangler.toml: "true" for production, "false" for the sandbox.
  spamCheckOnGift: location.hostname === 'give.koivikko.org',
  // true = show the spam check in the "Choose your country" popup. Continue unlocks when it passes.
  // Its token is reused for the gift button (if fresh), so donors are not checked twice.
  // If Turnstile cannot load (ad blocker, offline), Continue unlocks anyway: the server is the real gate.
  // OFF: on its own it protects nothing (the server only checks at checkout, see spamCheckOnGift),
  // its token expires after ~5 minutes, and it slows the page and adds a step before giving.
  spamCheckOnCountry: false,

  // --- Bank transfer details --------------------------------------------------------
  // The page shows these and the Copy button copies them. Keep index.html's fallback text
  // (#bankRecipient, #iban) the same, for visitors whose browser blocks scripts.
  bank: {
    recipient: 'Koivikko Elämäntapa Instituutti sr',
    iban: 'FI11 5271 0420 4946 51',
  },
  // Contact email, for reference only: the scripts no longer use it. The address shown is
  // written in the pages themselves (search for "mailto:").
  contactEmail: 'koivikkolife@gmail.com',

  // --- Analytics + Google Ads (only with the visitor's consent) ---------------------
  // Empty googleTagId = switched off: no banner, nothing loads. To switch on, fill in:
  //   googleTagId:    your Google tag, e.g. 'G-ABC123XYZ' (GA4) or 'AW-123456789' (Google Ads)
  //   adsId:          Google Ads account tag if different from googleTagId, e.g. 'AW-123456789'
  //   adsConversion:  the donation conversion's "send_to", e.g. 'AW-123456789/AbCdEfGhIj'
  // Also update the privacy policy to mention Google Analytics / Ads cookies before switching on.
  analytics: {
    googleTagId: '',
    adsId: '',
    adsConversion: '',
    previewBannerInDemo: true, // show the banner in ?demo=1 so it can be reviewed (loads nothing)
  },

  // --- Pathway links (PRD 6.6) -----------------------------------------------
  // OCI donate page (confirmed 19 Nov 2026). Koivikko is listed there as "Koivikko Lifestyle Institute".
  ociUrl: 'https://www.outpostcenters.org/en/oci-website/donate',

  // --- Campaign ---------------------------------------------------------------
  supporterGoal: 100,    // Q2: monthly-supporter goal for the progress bar. 0 or null hides the bar
  // Below this many monthly supporters, the counter says "Be one of our first 100 monthly supporters"
  // instead of showing small numbers ("2 people…"). Set to 1 to always show the numbers. (Content decision.)
  counterMinDonors: 20,
  // How often the counter updates while the page is open, in seconds (0 = only when the page loads)
  counterRefreshSeconds: 60,
  // Visitors arriving from a Google Ads click are not stopped by the country popup (the guess is used;
  // "Change" stays available). Set to false to always ask.
  skipCountryPopupForAds: true,

  // --- Live counter currency ----------------------------------------------------
  // The counter always shows its total in this currency (agreed 20 Nov 2026: AUD).
  // The backend sends the total in AUD already, converted at the ECB rate
  // (COUNTER_CURRENCY in backend/wrangler.toml), so normally nothing is converted here.
  counterCurrency: 'AUD',
  // FALLBACK ONLY (demo data, or a backend that could not get an AUD rate and sent EUR).
  // 1 unit of each currency = this many AUD. Approximate.
  toAUD: { AUD: 1, EUR: 1.75, USD: 1.53 },

  // --- Donation form (PRD 6.5): PLACEHOLDERS, confirm with Kyle/Kevin (Q4, Q5) ---
  currencies: ['EUR', 'AUD', 'USD'],
  presets: {
    monthly:    { EUR: [10, 25, 50, 100, 250], AUD: [15, 40, 80, 150, 400], USD: [10, 25, 50, 100, 250] },
    'one-time': { EUR: [25, 50, 100, 250, 500], AUD: [40, 80, 150, 400, 800], USD: [25, 50, 100, 250, 500] },
  },
  defaultPresetIndex: 1, // pre-selected and tagged "Popular"
  limits: { EUR: [2, 10000], AUD: [3, 15000], USD: [2, 10000] },
  coverFeesRate: 0.03,   // "cover card fees" add-on (rounded to 0.05, min 0.30)

  // Impact line shown under the amount buttons, one per preset (Q3)
  impact: [
    'helps keep Koivikko’s doors open for guests seeking rest and renewal.',
    'helps sustain health courses that change people’s lives.',
    'helps care for the forest, lakefront and historic buildings.',
    'helps carry the whole mission through the year ahead.',
    'makes you a cornerstone supporter of Koivikko’s mission.',
  ],

  // --- Live feed toasts (PRD 6.7) ---------------------------------------------
  toasts: { firstDelayMs: 6000, minGapMs: 8000, maxGapMs: 15000, visibleMs: 5200, maxPerVisit: 5 },
};

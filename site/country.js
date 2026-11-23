/* ============================================================================
   Donor country → gift currency
   Rule (agreed 19 Nov 2026): Australia → AUD · any European country → EUR · rest of the world → USD
   ============================================================================ */
(() => {
  'use strict';

  // ISO 3166-1 alpha-2 codes (country names come from the browser via Intl.DisplayNames)
  const CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ '
    + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
    + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG '
    + 'KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU '
    + 'MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
    + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG '
    + 'US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');

  // Europe = EUR. Includes non-euro European countries (UK, Sweden, Norway…) as agreed.
  // Transcontinental Türkiye, Georgia, Armenia, Azerbaijan, Kazakhstan → USD (change here if needed).
  const EUROPE = new Set(('AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI '
    + 'LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK').split(' '));

  const currencyFor = (code) => (code === 'AU' ? 'AUD' : EUROPE.has(code) ? 'EUR' : 'USD');

  let names;
  // Country names in the page language (i18n.js), falling back to English
  const LANG = (window.KoivikkoI18n && window.KoivikkoI18n.lang) || 'en';
  try { names = new Intl.DisplayNames([LANG, 'en'], { type: 'region' }); } catch { names = null; }
  const nameOf = (code) => (names && names.of(code)) || code;
  const isValid = (code) => typeof code === 'string' && CODES.includes(code.toUpperCase());

  // Best guess for the pre-filled answer: time zone first (more reliable than "en-US",
  // which many browsers use worldwide), then the browser language's region.
  const TZ = {
    'Europe/Helsinki': 'FI', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Berlin': 'DE',
    'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
    'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES', 'Europe/Lisbon': 'PT',
    'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
    'Europe/Athens': 'GR', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT', 'Europe/Kiev': 'UA',
    'Europe/Kyiv': 'UA', 'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI', 'Europe/Bratislava': 'SK',
    'Europe/Luxembourg': 'LU', 'Europe/Malta': 'MT', 'Atlantic/Reykjavik': 'IS', 'Pacific/Auckland': 'NZ',
    'Asia/Manila': 'PH', 'Africa/Nairobi': 'KE', 'Africa/Lagos': 'NG', 'Asia/Singapore': 'SG', 'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
  };
  function guess() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
    if (tz.startsWith('Australia/')) return 'AU';
    if (TZ[tz]) return TZ[tz];
    const regions = (navigator.languages || [navigator.language || '']).map((l) => (l.split('-')[1] || '').toUpperCase());
    const fromLang = regions.find(isValid);
    if (tz.startsWith('Europe/')) return fromLang && EUROPE.has(fromLang) ? fromLang : 'FI';
    if (tz.startsWith('America/') && (!fromLang || fromLang === 'US')) return 'US';
    return fromLang || null;
  }

  // Sorted list for the <select>; Intl may not know a code in older browsers, then it is skipped
  const list = () => CODES.map((c) => ({ code: c, name: nameOf(c) }))
    .filter((x) => x.name && x.name !== x.code)
    .sort((a, b) => a.name.localeCompare(b.name, LANG));

  const KEY = 'k_country';
  const saved = () => { try { const c = localStorage.getItem(KEY); return isValid(c) ? c : null; } catch { return null; } };
  const save = (c) => { try { localStorage.setItem(KEY, c); } catch { /* private mode etc. */ } };

  window.KoivikkoCountry = { currencyFor, nameOf, isValid, guess, list, saved, save, EUROPE };
})();

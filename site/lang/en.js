/* English wording for text that the scripts build (buttons, pop-ups, messages).
   Page text written in the HTML is already English and is not repeated here.
   {name} parts are filled in by the page. Keep any <strong>/<br> tags. */
window.KOIVIKKO_LANG_EN = {
  // language menu
  'lang.button': 'Language: {name}',
  'lang.list': 'Choose language',

  // gift form
  'amount.other': 'Other',
  'amount.popular': 'Popular',
  'give.monthly': 'Give {amount} monthly',
  'give.once': 'Give {amount}',
  'give.choose': 'Choose an amount',
  'give.opening': 'Opening secure checkout…',
  'impact.monthly': '<strong>{amount} a month</strong> {impact}',
  'impact.once': '<strong>{amount}</strong> {impact}',
  'nudge.button': 'Yes — make it {amount} a month instead',
  'err.range': 'Please choose an amount between {min} and {max}.',
  'err.checkout': 'Could not open secure checkout.',
  'err.nothingCharged': '{message} Nothing was charged. Please try again.',
  'err.notConfigured': 'Online giving is not switched on yet. Please come back soon.',

  // country popup
  'country.give': 'You’ll give in {currency}',
  'cur.AUD': 'A$ AUD (Australian dollars)',
  'cur.EUR': '€ EUR (euros)',
  'cur.USD': '$ USD (US dollars)',

  // live counter
  'counter.people': 'people are',
  'counter.person': 'person is',
  'progress.of': '{n} of {goal}',
  'progress.reached': '{n} monthly supporters: goal of {goal} reached',
  'progress.reached1': '{n} monthly supporter: goal of {goal} reached',
  'sticky': '<strong>{n}</strong> monthly supporters<br>and counting',

  // "someone just pledged" pop-ups
  'toast.someoneFrom': 'Someone from <strong>{country}</strong>',
  'toast.someone': 'Someone',
  'toast.justPledged': 'just pledged <strong>{money} a month</strong>',
  'toast.pledged': 'pledged <strong>{money} a month</strong>',
  'toast.justGave': 'just gave <strong>{money}</strong>',
  'toast.gave': 'gave <strong>{money}</strong>',
  'toast.dismiss': 'Dismiss',
  'ago.now': 'just now',
  'ago.minutes': '{n} minutes ago',
  'ago.hour': 'an hour ago',
  'ago.hours': '{n} hours ago',
  'ago.yesterday': 'yesterday',
  'ago.days': '{n} days ago',

  // other buttons and messages
  'au.sendFail': 'Could not send. Please try again.',
  'manage.unavailable': 'Not available right now. Please email us instead.',
  'iban.copy': 'Copy',
  'iban.copied': 'Copied',
  'iban.select': 'Select & copy',

  // messages from the server
  'api.noAnswer': 'We could not reach our server. Please check your connection.',
  'api.generic': 'Something went wrong on our side.',
  'api.invalid_amount': 'That amount is outside what we can accept.',
  'api.invalid_currency': 'That currency is not available.',
  'api.invalid_input': 'Please add your name and a valid email.',
  'api.rate_limited': 'Too many attempts. Please wait a minute.',
  'api.spam_check_failed': 'We could not confirm you are a person. Please tick the check again.',
  'api.too_large': 'That message is too long. Please shorten it.',
  'api.email_failed': 'We could not send your message just now. What you typed is still here: please try again in a minute.',

  // thank-you page
  'ty.monthly': 'Your <strong>{amount} monthly</strong> gift makes you part of the circle keeping Koivikko going.',
  'ty.once': 'Your <strong>{amount}</strong> gift is on its way to Koivikko.',
  'ty.shareMsg': 'I just became a supporter of Koivikko, a non-profit place of rest and renewal in Finland. Will you join me?',
  'ty.shareSubject': 'Join me in supporting Koivikko',
  'ty.copied': 'Copied!',

  // monthly fee and currency-change notice
  'fee.monthly': 'each month',
  'cur.changed': 'Your gift is now in {currency}. Please check the amount before giving.',

  // early counter, connection and field messages
  'counter.early': 'Be one of our first {goal} monthly supporters. Every gift this month helps build the circle that keeps Koivikko going.',
  'counter.earlyNoGoal': 'Be one of our first monthly supporters. Every gift this month helps build the circle that keeps Koivikko going.',
  'sticky.early': 'Be one of our first<br><strong>monthly supporters</strong>',
  'give.slow': 'Still working… this is taking longer than usual',
  'err.amountFormat': 'Please type the amount as a number, for example 25 or 12.50.',
  'err.offline': 'You seem to be offline. Please check your connection and try again. Nothing was charged.',
  'err.altBank': 'Or give by bank transfer instead',
  'net.offline': 'You’re offline. Reconnect to give by card, or use the bank transfer details below.',
  // safe-mode.js: part of the page didn't load (followed by "Refresh the page" and err.altBank)
  'safe.note': 'Online giving is paused because part of this page didn’t load. Nothing was charged.',
  'safe.link': 'Refresh the page',
  'au.sending': 'Sending…',
  'field.nameRequired': 'Please enter your name.',
  'field.emailInvalid': 'Please enter a valid email address, like name@example.com.',
  'field.phoneInvalid': 'Please enter a valid phone number, or leave it empty.',

  // cookie consent banner (analytics.js)
  'consent.title': 'Cookies',
  'consent.text': 'We’d like to use cookies to see which ads and pages help people find Koivikko. Nothing is used unless you agree.',
  'consent.more': 'Privacy policy',
  'consent.accept': 'Accept',
  'consent.decline': 'Decline',

  // security: console warning (guard.js) and payment-detail guard (app.js)
  'console.title': 'Stop!',
  'console.body': 'This part of the browser is for developers. If someone told you to copy or paste something here, for example to "unlock" a gift, get a receipt or a refund, it is a scam: it could give them access to your accounts or send your money elsewhere. Koivikko will never ask you to do this. If you are unsure, close this window and email koivikkolife@gmail.com.',

  // checkout preview (demo page only)
  'co.monthlyLabel': 'Monthly gift to Koivikko Foundation',
  'co.onceLabel': 'One-time gift to Koivikko Foundation',
  'co.perMonth': 'per month',
  'co.monthlyGift': 'Monthly gift',
  'co.gift': 'Gift',
  'co.fees': 'Card fees covered',
  'co.feesSub': 'Thank you, so 100% of your gift reaches Koivikko',
  'co.total': 'Total due today',
  'co.renew': 'Then {total} every month, next on {date}. Change or cancel anytime from your receipt email.',
  'co.payMonthly': 'Start monthly gift · {total}',
  'co.payOnce': 'Donate {total}',
  'co.termsMonthly': 'By confirming, you allow Koivikko Foundation to charge your card {total} now and every month until you cancel.',
  'co.termsOnce': 'By confirming, you allow Koivikko Foundation to charge your card {total} once.',
  'co.processing': 'Processing…',
};

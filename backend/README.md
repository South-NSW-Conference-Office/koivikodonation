# Koivikko donation backend

A small Cloudflare Worker that sits between the donation page (on give.koivikko.org) and the
Koivikko Foundation's Stripe account. Stripe is the source of truth; nothing personal is stored here.

## Endpoints

| Endpoint | Used by | Notes |
|---|---|---|
| `POST /checkout` | Donate button | Body: `{ giftAmount, currency, frequency, coverFees, showCountry, donorCountry, lang, utm, attemptId, turnstileToken }`. `utm` is optional: `{ utm_source, utm_medium, utm_campaign, utm_content }` copied from the page's link tags, stored on the gift in Stripe. Returns `{ url }`; redirect the donor there. |
| `GET /stats` | Counter | `{ activeMonthlyDonors, monthlyPledgedTotal, oneTimeThisMonth, combinedThisMonth, currency: "AUD", supporterGoal, updatedAt }` |
| `GET /recent` | Pop-ups | `{ items: [{ country, countryName, amount, currency, frequency, minutesAgo }] }` |
| `GET /session?session_id=cs_...` | Thank-you page | `{ paid, amount, giftAmount, feeAmount, currency, frequency }`. `amount` is what the donor was charged. |
| `POST /portal` | "Manage my gift" link | Body: `{ sessionId }` (optional). Returns `{ url, direct }`. With a monthly donor's session id from the last hour, `url` opens Stripe's customer portal for that donor. Otherwise `url` is Stripe's portal login page, where the donor enters their email and Stripe emails them a link. |
| `POST /contact` | AU family-trust form | Body: `{ name, email, phone, message, leaveBlank, turnstileToken }` (`leaveBlank` is the hidden honeypot field; it is not named `company` because browsers autofill that). |
| `POST /stripe-webhook` | Stripe | Verifies the signature, then refreshes the cached counter. |

Rules the front end should know:

- These names match the page in `../site` (its `api.js` is the only file that calls this backend).
- `giftAmount` is the gift before any card fee, in the chosen currency, cents allowed. The page also sends `amount` (its displayed total) and `feeAmount`; both are ignored.
- `currency` is `EUR`, `AUD` or `USD` (any case). `frequency` is `monthly` or `one-time`.
- The card-fee amount is recalculated on the server: `FEE_PERCENT`, rounded to 0.05, minimum 0.30 (`feeCents` in `src/rules.js`), the same rule as `feeFor` in the page's `app.js`. The counter counts the gift only.
- Amount limits (`CURRENCIES` in `src/rules.js`) must match `limits` in the page's `config.js`, and `FEE_PERCENT` must match its `coverFeesRate`. `npm test` fails if the page and the backend disagree on limits or fees.
- Errors come back as `{ error: "code" }`; the page turns the codes into sentences in `api.js`. A body over 10,000 characters returns `413 too_large`.
- The counter total is in `COUNTER_CURRENCY` (AUD; set in `wrangler.toml`). Gifts are added up in EUR, then converted, all with the European Central Bank's daily reference rates (fetched at most twice a day). `FX_TO_EUR` is only the fallback if those cannot be fetched. Without a rate for `COUNTER_CURRENCY`, the counter stays in EUR and says so in `currency`.
- The counter counts people, not gifts: one donor with two monthly gifts counts once (both amounts are added). A gift whose card failed stays counted while Stripe is still retrying it. "This month" follows Finnish time.
- `/contact` tries the email twice. If it still fails it returns `502 email_failed`; the page keeps what the visitor typed and asks them to try again.
- While `apiBase` in `config.js` still holds the placeholder address, the page disables the gift button and says giving is not switched on yet. With JavaScript off, the form shows a short notice.
- Pop-up amounts are in the currency the donor gave in. `country` is the one the donor picked on the page (`donorCountry` on `/checkout`). It is `null` unless the donor ticked "show my country" (unticked by default), and always `null` for a gift worth 250 EUR or more, so a donor cannot be picked out.
- `/session` for a just-paid gift triggers a recount, so the donor sees their gift when they return to the page.
- If `/stats` or `/recent` returns anything but 200, hide the counter / pop-ups.

## Abuse protection

- **Rate limits** per visitor IP address, per endpoint, per minute: 300 for `/stats` and `/recent`; 30 for `/checkout`, `/portal` and `/session`; 5 for `/contact`. They are set high enough for a room of people giving from one shared Wi-Fi. Over the limit returns `429` with `Retry-After: 60`. Limits are set in `wrangler.toml` (`[[ratelimits]]`). They are counted per Cloudflare location, so treat them as approximate.
- **Spam check (Cloudflare Turnstile)** on `/contact`: the page shows the Turnstile widget and sends its token as `turnstileToken`. A missing or bad token returns `403 spam_check_failed`. Set `TURNSTILE_ON_CHECKOUT = "true"` to require the same token on `/checkout`.
- The check is skipped in the sandbox while `TURNSTILE_SECRET_KEY` is empty. In production the Worker refuses `/contact` without it.
- Every response carries security headers (HSTS, a deny-all Content-Security-Policy, no framing, no sniffing, no referrer).
- Also in place: the hidden `leaveBlank` honeypot field, an origin check on every write endpoint, a 10,000-character body cap, and signature checking on the webhook (which is not rate limited).

## Busy periods, repeats and outages

- **Counter and pop-ups** are answered from a saved copy, never by asking Stripe while a visitor waits. A copy older than 5 minutes is refreshed in the background. If Stripe cannot be reached, the last good copy keeps being served for up to a day.
- **After a gift**, Stripe's events trigger a refresh, at most once every 15 seconds however many events arrive. The webhook answers Stripe immediately and does the work afterwards.
- **What the counter leaves out**: paused monthly gifts; one-time gifts that were fully refunded or are disputed (a part refund counts the part kept). A monthly amount changed in the Stripe dashboard is counted at its new amount. A gift in a currency missing from `FX_TO_EUR` is left out of the totals and logged, instead of stopping the refresh.
- **Recounting, not adding**: every refresh recounts from Stripe, so repeated, late or out-of-order events cannot double-count.
- **Retry-safe checkout**: the page sends an `attemptId` with each gift attempt and repeats it when a call got no answer (lost connection, time limit); Stripe returns the same payment page instead of a second one. After an answered error the next press uses a new id. The gift button is disabled while the call is in flight.
- **Time limits**: calls to Stripe stop after 8 seconds and are retried twice; calls to Turnstile and the email service stop after 8 seconds; the page's own calls stop after 10 seconds (30 for checkout) and show "Nothing was charged. Please try again."
- **Card data** never touches the page or this Worker, so an interruption can never leave a half-made charge here.

## Payment standards checklist

In place in code:

- Card details handled only by Stripe's hosted page (the lowest card-security scope, PCI SAQ A).
- Strong customer authentication (3-D Secure) handled by Stripe; tested with Stripe's test cards.
- Prices and fees decided on the server; the browser's figures are ignored.
- Webhook signatures checked; secrets kept out of the code; test and live keys cannot be mixed up.
- HTTPS only, security headers, origin check, rate limits, spam check, body size cap.
- No personal data stored or logged here; only country, amount and frequency are public.
- Idempotent checkout, time limits and retries (see above).

To do in dashboards before launch (cannot be set from code):

- Stripe: use a **restricted key** for the live Worker instead of the full secret key, limited to Checkout Sessions (write), Subscriptions (read), Customers (read), Refunds (read), Disputes (read), Customer portal (write).
- Stripe: turn on emailed receipts, failed-payment retries and the "payment failed" emails for monthly gifts.
- Stripe: turn on Radar's default rules and email alerts for failed webhooks and disputes.
- Stripe: two-step login for everyone with access to the account.
- Turn on the spam check for gifts at launch (`TURNSTILE_ON_CHECKOUT = "true"` here and `spamCheckOnGift: true` in the page's `config.js`). Donation pages are a common target for testing stolen cards.
- Cloudflare: check the plan's daily limits against expected traffic; the free plan caps requests and cache writes per day.
- Link the privacy policy from the page (GDPR). Refunds and disputes go to the admin (see "Still to confirm").

Not done: a load test against a deployed sandbox, and a real Stripe webhook delivery. Both need the Worker deployed.

## Rules for the donation page

Lessons from reviewing the OCI donate page, kept to what fits Pastor Kyle's brief and the PRD.

Do:

- Send card details only to Stripe. The page redirects to Stripe's hosted checkout; it never has a card field of its own.
- Let the server decide the price. Send the chosen amount, currency and options; never send a total or a fee.
- Show the "cover card fees" option and the "show my country" option; both are already handled here.
- Pass link tags through: read `utm_source`, `utm_medium`, `utm_campaign` from the page URL and send them as `utm` to `/checkout`, so Kevin can see which email or ad brought each gift.
- Put a "Manage my gift" link on the thank-you page and in the FAQ; both call `/portal`. The thank-you page removes `session_id` from the address bar once it has read it.
- Support older browsers: no `AbortSignal.timeout` or `crypto.randomUUID` without a fallback.
- Show the Turnstile widget on the enquiry form and include the hidden `leaveBlank` field.
- Send the page's own security headers from its host: `Strict-Transport-Security` and a `Content-Security-Policy` that allows only the page itself, this API, Turnstile and the analytics tool.
- Self-host fonts and scripts where possible. Pin an exact version for anything loaded from a CDN.
- Show a cookie consent banner if the analytics tool sets cookies (Finnish organisation, GDPR applies).

Do not:

- Do not look donors up by email or prefill their details. OCI's lookup returns a name and address for any email typed in.
- Do not add donor accounts, logins or PINs. Stripe's portal covers cancelling and card changes.
- Do not show donor names anywhere. Only country, amount and frequency are public, as Kyle asked.
- Do not load general-purpose libraries (jQuery UI, table or PDF tools) on the page. Every extra script on a donation page is extra risk.
- Do not add yearly gifts, multiple recipients or a cart. Kyle asked for monthly and one-off gifts to one recipient.

## Run locally (sandbox)

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Put the Stripe **sandbox** secret key in `.dev.vars`, then:

```bash
npm run dev
```

To try the real page against it, serve the page in a second terminal and open http://localhost:3000:

```bash
python3 -m http.server 3000 --directory ../site
```

Served from localhost the page calls `http://localhost:8787`; opened as a file (double-click) it stays a demo with made-up numbers. `.dev.vars` sends the donor back to `localhost:3000` after paying. Pay with Stripe's test card 4242 4242 4242 4242.

To receive webhooks locally, run the Stripe CLI and copy the `whsec_...` it prints into `.dev.vars`:

```bash
stripe listen --forward-to localhost:8787/stripe-webhook
```

## Deploy the sandbox

1. `npx wrangler kv namespace create CACHE` and paste the id into `wrangler.toml`.
2. `npx wrangler secret put STRIPE_SECRET_KEY` (sandbox key), then the same for `STRIPE_WEBHOOK_SECRET`.
3. `npm run deploy:sandbox`
4. In the Stripe sandbox, add a webhook endpoint pointing at `<worker-url>/stripe-webhook` with these events:
   `checkout.session.completed`, `invoice.paid`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed`.
5. Add the preview URL of the donation page to `ALLOWED_ORIGINS`.

## Go live

Same steps with `--env production` (own KV namespace, live Stripe key, live webhook secret).
The Worker refuses to run if a live key is used in the sandbox or a test key in production.

## Page settings to change before launch

- `site/config.js`: put the deployed Worker address in `apiBase` and the Turnstile site key in `turnstileSiteKey`.
- `site/index.html` and `site/thank-you.html`: in the Content-Security-Policy line, replace `http://localhost:8787` with the Worker address.
- Delete `site/checkout-mock.html`, `site/checkout-mock.js` and the yellow mockup bar at the top of `site/index.html`.
- The page links to `/en`, `/fi`, `/thank-you` and `/donate-cancelled` without `.html`; the host must serve those (Cloudflare Pages does).

## Still to confirm before launch

- **Decided: the Stripe name becomes the Foundation.** The checkout and portal pages still show "Koivikko Lifestyle Center". Change it in the Stripe dashboard (sandbox and live): Settings > Business > Public details > "Public business name" and "Statement descriptor". This cannot be set from code.
- **Decided: refunds go to the admin by email.** A donor who wants a refund emails the admin, who issues it in the Stripe dashboard; the counter then drops the gift by itself. The page's FAQ says this and gives the footer address (`koivikkolife@gmail.com`); change it there if the admin uses another address.
- **Decided: tax wording stays as the page has it** (the "Need a tax-deductible receipt?" link to the other giving routes). Nothing more is promised.
- **On hold: the fundraising permit question** (whether it covers online and international giving).

- `FX_TO_EUR` is now only a fallback for when the ECB rates cannot be fetched. Set it to roughly current rates.
- Minimum/maximum amounts in `src/rules.js` (`CURRENCIES`) are placeholders.
- `FEE_PERCENT` (3) against the Foundation's actual Stripe pricing for AUD and USD cards.
- `SUPPORTER_GOAL` (100).
- DNS for koivikko.org is at Namecheap, not Cloudflare, so this Worker cannot sit on the subdomain itself. The page takes the subdomain (CNAME to its host); the Worker stays on its workers.dev URL.
- Customer portal: the sandbox settings exist (cancel immediately, no refund; update card; invoice history). For live, create the same settings in the live Stripe account and put its id and login URL in `PORTAL_CONFIGURATION_ID` / `PORTAL_LOGIN_URL` under `[env.production.vars]`.
- Enquiry email: recipient (`CONTACT_TO_EMAIL`), sender address and a Resend API key.
- Receipts: switch on Stripe's emailed receipts for successful payments in the Stripe dashboard (PRD FR-6). This cannot be set from code.
- US pathway: the "Give via OCI" button should open https://www.outpostcenters.org/en/oci-website/donate. That page accepts `?ministry=` to preselect a recipient; ask Kyle or OCI whether Koivikko is listed and what its value is.
- Turnstile: create a widget in the Cloudflare dashboard for `give.koivikko.org`, give the site key to the page and set the secret with `npx wrangler secret put TURNSTILE_SECRET_KEY` (sandbox and production).

## Sandbox deployment (19 Nov 2026)

| What | Where |
|---|---|
| Test page | https://koivikko-give-sandbox.koivikko-donate-backend.workers.dev |
| Backend (Worker `koivikko-donate-sandbox`) | https://koivikko-donate-sandbox.koivikko-donate-backend.workers.dev |
| Stripe webhook (sandbox) | `we_1UdTXvAYwPZpnTlfsIClag4f` -> `/stripe-webhook`, eight events |
| Saved counter (KV) | `koivikko-donate-sandbox-cache` |

- Redeploy the backend: `npm run deploy:sandbox`. Redeploy the page: `npm run deploy:site:sandbox` (settings in `../wrangler.site.toml`).
- Secrets set on the Worker: `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET`. `TURNSTILE_SECRET_KEY`. Not set yet: `RESEND_API_KEY`, `CONTACT_TO_EMAIL`.
- The page's `apiBase` in `site/config.js` and the `connect-src` lines in `index.html` and `thank-you.html` point at the sandbox backend. Change all three at launch.
- Spam check: Turnstile widget "Koivikko donation page (sandbox)" in the same Cloudflare account, allowed on the test page, `localhost` and `127.0.0.1`. Its site key is `turnstileSiteKey` in `site/config.js`. It guards the enquiry form only (`TURNSTILE_ON_CHECKOUT` is `false`). Make a separate widget for `give.koivikko.org` at launch.

## Production deployment (23 Nov 2026)

| What | Where |
|---|---|
| Live page | https://give.koivikko.org (snswserver, see `../deploy/snsw/README.md`) |
| Backend (Worker `koivikko-donate`) | https://koivikko-donate.koivikko-donate-backend.workers.dev |
| Saved counter (KV) | `production-CACHE` (`ccb7a5a40920408c9c1f3ed76cdf039b`) |
| Stripe webhook (live) | `we_1UetZlAYwPZpnTlflo1EJhgj` -> `/stripe-webhook`, eight events |
| Spam check | Turnstile widget "Koivikko donation page (live)", domain `give.koivikko.org`; required at checkout |

- Redeploy the backend: `npm run deploy:live`. The page deploys itself on every push to `main`.
- Secrets set: `STRIPE_SECRET_KEY` (restricted `rk_live_` key: Checkout Sessions and Customer portal write;
  Subscriptions, Customers, Refunds, Payment disputes read), `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`.
  Not set: `RESEND_API_KEY`, `CONTACT_TO_EMAIL` (the family-trust form is switched off on the live site,
  `familyTrustForm` in `site/config.js`; its buttons open an email instead).
- Stripe customer portal: `bpc_1UetnzAYwPZpnTlfS7QZJDio`, login link in `PORTAL_LOGIN_URL`.
- Stripe settings checked 23 Nov 2026: receipts and refund emails on; expiring-card and failed-payment
  emails on, with a portal link; Smart Retries (4 tries / 3 weeks, then cancel); Radar risk controls active;
  public name "Koivikko Foundation", statement descriptor "KOIVIKKO FOUNDATION", privacy policy link set.
  Card-update link in billing emails: Stripe-hosted page (switched 23 Nov 2026 from the legacy koivikko.link
  setup, whose site was offline; Stripe does not allow switching back).
  Left for the account owner: "Require two-step authentication for your team" (Settings > Team and security).
- Uptime: `.github/workflows/uptime.yml` checks the page, the backend and the certificate every 15 minutes.
- `site/config.js` picks the backend by address: localhost -> local, "sandbox" in the name -> sandbox, else live.

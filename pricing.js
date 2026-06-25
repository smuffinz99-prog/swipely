/* Swipely — shows the visitor's local currency (approximate).
 *
 * IMPORTANT: this only changes the DISPLAYED price. The real charge currency is
 * set by Stripe at checkout. Enable Stripe "Adaptive Pricing" for true local
 * billing. Rates below are static and will drift over time — update occasionally.
 *
 * Usage in HTML:
 *   <span data-usd="6"></span>            -> filled with local price, e.g. "A$9"
 *   <span data-ccy-note></span>           -> "approx, billed in USD" note (hidden for US)
 */
(function () {
  'use strict';
  var BASE_USD = 6;

  // currency code -> [symbol, approx units per 1 USD]
  var CCY = {
    USD: ['$', 1], AUD: ['A$', 1.5], NZD: ['NZ$', 1.65], GBP: ['£', 0.8],
    EUR: ['€', 0.92], CAD: ['C$', 1.36], INR: ['₹', 83], JPY: ['¥', 150],
    SGD: ['S$', 1.34], ZAR: ['R', 18], BRL: ['R$', 5], MXN: ['MX$', 17],
    AED: ['AED ', 3.67], SEK: ['kr ', 10.5], CHF: ['CHF ', 0.88], PHP: ['₱', 56],
    PLN: ['zł ', 4], NOK: ['kr ', 10.8], DKK: ['kr ', 6.9]
  };

  // country/region code -> currency code
  var REGION = {
    US: 'USD', AU: 'AUD', NZ: 'NZD', GB: 'GBP', CA: 'CAD', IN: 'INR', JP: 'JPY',
    SG: 'SGD', ZA: 'ZAR', BR: 'BRL', MX: 'MXN', AE: 'AED', SE: 'SEK', CH: 'CHF',
    PH: 'PHP', PL: 'PLN', NO: 'NOK', DK: 'DKK',
    IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR',
    AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR'
  };

  function detectRegion() {
    var langs = navigator.languages || [navigator.language || 'en-US'];
    for (var i = 0; i < langs.length; i++) {
      var parts = (langs[i] || '').split('-');
      if (parts[1]) return parts[1].toUpperCase();
    }
    return 'US';
  }

  function localPrice(usd) {
    var ccy = REGION[detectRegion()] || 'USD';
    var c = CCY[ccy] || CCY.USD;
    var val = usd * c[1];
    var rounded = c[1] >= 20 ? Math.round(val / 10) * 10 : Math.round(val);
    return { ccy: ccy, isUSD: ccy === 'USD', text: c[0] + rounded.toLocaleString() };
  }

  function apply() {
    var anyLocal = false;
    var price = localPrice(BASE_USD);
    [].forEach.call(document.querySelectorAll('[data-usd]'), function (el) {
      var usd = parseFloat(el.getAttribute('data-usd')) || BASE_USD;
      var p = localPrice(usd);
      el.textContent = (el.getAttribute('data-prefix') || '') + p.text + (el.getAttribute('data-suffix') || '');
      if (!p.isUSD) anyLocal = true;
    });
    [].forEach.call(document.querySelectorAll('[data-ccy-note]'), function (el) {
      el.textContent = price.isUSD ? '' : '≈ converted from US$' + BASE_USD + ' · billed in USD';
    });
  }

  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
})();

/* Cloudflare Web Analytics — privacy-friendly, cookieless pageview tracking.
 * Loaded here because every page already includes pricing.js. To change the
 * tracked site, replace the token below with the one from your Cloudflare
 * Web Analytics dashboard. View stats at dash.cloudflare.com. */
(function () {
  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', '{"token": "666e4835ac074d82939dfeb2c4113077"}');
  (document.head || document.documentElement).appendChild(s);
})();

import { useState, useMemo, useEffect } from 'react';
import providerData from './providers.json';
import rateHistory from './rates-history.json';

const TODAY = '2026-06-22';
const FALLBACK_MID_RATE = 3645;

const DEFAULT_PROVIDERS = providerData.providers;

const PRESETS = [50, 100, 200, 500, 1000];
const UGX_PRESETS = [500000, 1000000, 2000000, 3500000, 5000000];

// Uganda mobile money cash-out cost: 0.5% government withdrawal levy plus a tiered
// agent fee. Tiers below are approximate and vary by network and agent — treat as an
// estimate, not a quote. Verified against published MTN/Airtel tariff bands, Jul 2026.
const WITHDRAWAL_LEVY = 0.005;
const AGENT_FEE_TIERS = [
  [5000, 330], [15000, 440], [30000, 700], [45000, 880], [60000, 1000],
  [125000, 1650], [250000, 2750], [500000, 4400], [1000000, 7150],
  [2000000, 12500], [4000000, 15000], [Infinity, 20000],
];

function agentFee(ugx) {
  for (const [ceiling, fee] of AGENT_FEE_TIERS) if (ugx <= ceiling) return fee;
  return 20000;
}
function cashOutCost(ugx) {
  if (ugx <= 0) return 0;
  return ugx * WITHDRAWAL_LEVY + agentFee(ugx);
}
// Solve for the wallet amount needed so `target` survives cash-out. Fees are
// monotonic and small, so a few fixed-point passes converge tightly.
function grossUpForCashOut(target) {
  let gross = target;
  for (let i = 0; i < 12; i++) gross = target + cashOutCost(gross);
  return gross;
}

// Destinations reachable from Uganda. `mapped` means pricing has been field-verified;
// unmapped ones show what the telco menus advertise, with pricing still to collect.
const DESTINATIONS = [
  { code: 'US', name: 'United States', cur: 'USD', sym: '$',   mapped: true  },
  { code: 'UK', name: 'United Kingdom', cur: 'GBP', sym: '\u00A3', mapped: true  },
  { code: 'CA', name: 'Canada',         cur: 'CAD', sym: 'C$',  mapped: false },
  { code: 'KE', name: 'Kenya',          cur: 'KES', sym: 'KSh', mapped: true  },
  { code: 'AE', name: 'UAE',            cur: 'AED', sym: 'AED', mapped: true  },
  { code: 'EU', name: 'Euro area',      cur: 'EUR', sym: '\u20AC', mapped: true  },
];

// URL routing. Each corridor gets its own path so it can be linked, shared and indexed.
const ROUTES = [
  { path: '/',                corridor: 'c1', dest: 'US',
    title: 'Send money US to Uganda: real fees compared | Remittance Ledger',
    desc: 'What your recipient in Uganda actually receives after fees and exchange-rate markups. Every provider checked by hand in Kampala. Free, no signup.' },
  { path: '/us-to-uganda',    corridor: 'c1', dest: 'US',
    title: 'Send money US to Uganda: real fees compared | Remittance Ledger',
    desc: 'What your recipient in Uganda actually receives after fees and exchange-rate markups. Every provider checked by hand in Kampala. Free, no signup.' },
  { path: '/uganda-to-us',    corridor: 'c2', dest: 'US',
    title: 'Send money Uganda to USA: what it actually costs | Remittance Ledger',
    desc: 'Almost every route from Uganda to America ends at a counter. Two apps do it from your phone. Hand-verified field research from Kampala.' },
  { path: '/uganda-to-kenya', corridor: 'c2', dest: 'KE',
    title: 'Send money Uganda to Kenya: cheapest routes compared | Remittance Ledger',
    desc: 'Eversend, Airtel, MTN and Chipper compared for Uganda to Kenya transfers. The cheapest corridor out of Uganda at roughly 2%. Verified by hand.' },
  { path: '/uganda-to-uk',    corridor: 'c2', dest: 'UK',
    title: 'Send money Uganda to UK: real costs compared | Remittance Ledger',
    desc: 'Uganda to Britain is one of the most expensive corridors out of Uganda. Eversend and MTN via Juba Express compared, hand-verified in Kampala.' },
  { path: '/uganda-to-uae',   corridor: 'c2', dest: 'AE',
    title: 'Send money Uganda to UAE: the only working route | Remittance Ledger',
    desc: 'Airtel lists the UAE but returns service not live. MTN via Juba Express is the only quotable route from Uganda to the Emirates.' },
  { path: '/uganda-to-europe',corridor: 'c2', dest: 'EU',
    title: 'Send money Uganda to Europe: real fees compared | Remittance Ledger',
    desc: 'MTN routes Europe through Thunes and will not show a rate until funds are in your wallet. Compared against Eversend, hand-verified in Kampala.' },
  { path: '/about',           corridor: 'about', dest: 'US',
    title: 'How this map is made | Remittance Ledger',
    desc: 'Who built this, how every rate is verified by hand in Kampala, how readers correct it, and how it is funded. The methodology behind the Remittance Ledger.' },
  { path: '/compare',         corridor: 'c3', dest: 'US',
    title: 'What it costs to send money out of Uganda | Remittance Ledger',
    desc: 'The same 2 million shillings, five destinations. Kenya costs a third of what Britain does. Hand-verified corridor comparison from Kampala.' },
];

function routeFor(corridor, dest) {
  if (corridor === 'about') return ROUTES.find(r => r.path === '/about');
  if (corridor === 'c3') return ROUTES.find(r => r.path === '/compare');
  if (corridor === 'c1') return ROUTES.find(r => r.path === '/us-to-uganda');
  return ROUTES.find(r => r.corridor === 'c2' && r.dest === dest) || ROUTES[0];
}
function routeFromPath(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  return ROUTES.find(r => r.path === clean) || ROUTES[0];
}

// What the telco menus advertise per destination, from the *165# / *185# menu walks.
// Pricing for unmapped destinations is not yet collected.
const MENU_AVAILABILITY = {
  UK: { mtn: 'Bank transfer listed', airtel: 'Listed but "service not live"',
        note: 'A reader completed a Uganda\u2192UK Airtel transfer in Sept 2025 at roughly 5% below mid-market, so this corridor was live and has since gone dark.' },
  CA: { mtn: 'Bank transfer listed \u2014 but no rate shown until you enter recipient bank details',
        airtel: 'Listed in Rest of World, returns "service not live"',
        note: 'The only rich-world destination MTN reaches by bank while the US is absent \u2014 and you cannot price it before committing. MTN will not quote a rate until recipient bank details are entered, so there is no way to compare before you send. That is the finding.' },
  KE: { mtn: 'Africa mobile networks + bank transfer', airtel: 'East Africa tier \u2014 mobile + bank',
        note: 'The best-served corridor on both networks. East African rails work in a way the rich-world ones do not.' },
  AE: { mtn: 'Bank transfer listed', airtel: 'Listed but "service not live"',
        note: 'Significant Ugandan labour migration to the Gulf; almost nothing published on what this corridor costs.' },
  EU: { mtn: 'Euro banks listed \u2014 pricing not yet collected',
        airtel: 'Germany, Denmark and Ireland tested: all return "service not live"',
        note: 'Diaspora traffic to this map already comes from Belgium, the Netherlands, France, Spain and Sweden. Airtel\u2019s European corridors are dead buttons like the rest of its rich-world tier; MTN\u2019s Euro banks option remains unquoted.' },
};

// Uganda → US routes. effRate = UGX actually surrendered per USD delivered,
// derived from real field quotes (fees + FX bundled). Verified Kampala, Jul 2026.
// Chipper deposit tariff: 2.5% of the band ceiling (published tariff sheet, Oct 2024).
const CHIPPER_DEPOSIT_BANDS = [
  [2500,65],[5000,125],[15000,375],[30000,750],[45000,1125],[60000,1500],[125000,3125],
  [250000,6250],[500000,12500],[1000000,25000],[2000000,50000],[4000000,100000],[5000000,125000],
];
function chipperDeposit(ugx) {
  for (const [ceiling, fee] of CHIPPER_DEPOSIT_BANDS) if (ugx <= ceiling) return fee;
  return 125000;
}
// Eversend deposit: flat 37,103 UGX + 0.49%. Fitted exactly to five in-app quotes
// (200k / 500k / 1M / 2M / 5M), Kampala, Aug 2026.
function eversendDeposit(ugx) { return ugx > 0 ? 37103 + 0.0049 * ugx : 0; }

// Uganda → US routes. effRate = UGX surrendered per USD delivered once the money is
// already in the wallet. fundMobile/fundBank add the cost of getting it there.
// TODO confirm: Eversend's public site. Left as a constant so it is changed in one place.
const EVERSEND_URL = 'https://eversend.co';

// Providers running a publisher affiliate programme we've joined. Marked openly on every
// row. Ranking is computed from verified rates and ignores this list entirely — the
// cheapest routes on this map (Eversend, Chipper, LemFi) pay nothing.
const AFFILIATE_PARTNERS = ['Wise', 'Remitly', 'WorldRemit'];

// When each corridor's rates were last re-checked by hand. The site grades itself on these:
// past 35 days it warns, past 60 it says the numbers should not be trusted. Update these
// whenever a corridor is re-verified — they are the only thing keeping the map honest.
const VERIFIED = {
  US: '2026-07-27',
  KE: '2026-08-16',
  UK: '2026-08-18',
  AE: '2026-08-18',
  EU: '2026-08-17',
};
// Rate readings are append-only. Current values come from the latest entry; once a route
// has two or more, the site can show which way the cost has moved. Overwriting an entry
// destroys the only copy of that reading in existence — always append.
const READINGS = rateHistory.readings || {};

function latestReading(id) {
  const r = READINGS[id];
  return r && r.length ? r[r.length - 1] : null;
}
function previousReading(id) {
  const r = READINGS[id];
  return r && r.length > 1 ? r[r.length - 2] : null;
}
// Movement in effective rate between the last two readings. Positive means it got worse.
function rateMovement(id) {
  const now = latestReading(id), before = previousReading(id);
  if (!now || !before || !now.effRate || !before.effRate) return null;
  const pct = ((now.effRate - before.effRate) / before.effRate) * 100;
  if (Math.abs(pct) < 0.05) return { pct: 0, since: before.date, flat: true };
  return { pct, since: before.date, flat: false };
}
// Resolve a route's live rate from history, falling back to the value in the definition.
function resolveRate(id, fallback) {
  const r = latestReading(id);
  return r && typeof r.effRate === 'number' ? r.effRate : fallback;
}

const FRESH_DAYS = 35;
const STALE_DAYS = 60;

function daysSince(dateStr) {
  const then = new Date(dateStr + 'T00:00:00');
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}
function freshness(dateStr) {
  const d = daysSince(dateStr);
  if (d <= FRESH_DAYS) return { level: 'ok', days: d };
  if (d <= STALE_DAYS) return { level: 'aging', days: d };
  return { level: 'stale', days: d };
}
const isAffiliate = (name) => AFFILIATE_PARTNERS.includes(name);

const OUT_ROUTES_US = [
  { id: 'p2p',      name: 'P2P crypto (USDT)', effRate: resolveRate('p2p', 3770.0),  kind: 'informal',
    note: 'Binance P2P · scam risk, murky rules · MoMo send charge not modelled',
    fundMobile: () => 0, fundBank: null },
  { id: 'chipper',  name: 'Chipper Cash',      effRate: resolveRate('chipper', 3802.5),  kind: 'digital', action: { href: 'https://chippercash.com' },
    note: 'In-app · US bank or free Chipper tag',
    fundMobile: chipperDeposit, fundBank: () => 0 },
  { id: 'eversend', name: 'Eversend',          effRate: resolveRate('eversend', 3843.93), kind: 'digital', action: { href: EVERSEND_URL },
    note: 'In-app · US bank · no transfer fee',
    fundMobile: eversendDeposit, fundBank: () => 0 },
  { id: 'mg-out',   name: 'MoneyGram',         effRate: resolveRate('mg-out', 3883.5),  kind: 'counter', action: { href: 'https://www.moneygram.com' },
    note: 'Agent desk · cash in hand · national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
  { id: 'wu-out',   name: 'Western Union',     effRate: resolveRate('wu-out', 3921.6),  kind: 'counter', action: { href: 'https://www.westernunion.com' },
    note: 'Agent desk · cash in hand · national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
];

const OUT_ROUTES_KE = [
  { id: 'ke-ever',   name: 'Eversend',      effRate: resolveRate('ke-ever', 29.56),  kind: 'digital', action: { href: EVERSEND_URL },
    note: 'In-app \u00b7 M-Pesa or bank \u00b7 1,989 UGX fee on top',
    fundMobile: eversendDeposit, fundBank: () => 0 },
  { id: 'ke-airtel', name: 'Airtel Money',  effRate: resolveRate('ke-airtel', 30.36),  kind: 'telco', action: { ussd: '*185#' },
    note: '*185# \u00b7 Airtel Kenya or M-Pesa \u00b7 1,000 UGX fee, rest hidden in the rate',
    fundMobile: () => 0, fundBank: null },
  { id: 'ke-chip',   name: 'Chipper Cash',  effRate: resolveRate('ke-chip', 30.50),  kind: 'digital', action: { href: 'https://chippercash.com' },
    note: 'Chipper tag only \u2014 no bank or mobile money payout to Kenya',
    fundMobile: chipperDeposit, fundBank: () => 0 },
  { id: 'ke-mtn',    name: 'MTN MoMo',      effRate: resolveRate('ke-mtn', 30.70),  kind: 'telco', action: { ussd: '*165#' },
    note: '*165# \u00b7 Africa mobile networks \u00b7 1,000 UGX fee, rest hidden in the rate',
    fundMobile: () => 0, fundBank: null },
];

const OUT_ROUTES_UK = [
  { id: 'uk-ever', name: 'Eversend',            effRate: resolveRate('uk-ever', 5250.1), kind: 'digital', action: { href: EVERSEND_URL },
    note: 'In-app \u00b7 bank transfer only \u00b7 14,718 UGX fee on top',
    fundMobile: eversendDeposit, fundBank: () => 0 },
  { id: 'uk-wu',   name: 'Western Union',        effRate: resolveRate('uk-wu', 5363.2), kind: 'counter', action: { href: 'https://www.westernunion.com' },
    note: 'Agent desk \u00b7 cash in hand \u00b7 national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
  { id: 'uk-mg',   name: 'MoneyGram',            effRate: resolveRate('uk-mg', 5383.3), kind: 'counter', action: { href: 'https://www.moneygram.com' },
    note: 'Agent desk \u00b7 cash in hand \u00b7 national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
  { id: 'uk-juba', name: 'MTN via Juba Express', effRate: resolveRate('uk-juba', 5370.0), kind: 'telco', action: { ussd: '*165#' },
    note: '*165# \u2192 More countries \u00b7 bank transfer only',
    fundMobile: () => 0, fundBank: null },
];

const OUT_ROUTES_AE = [
  { id: 'ae-juba', name: 'MTN via Juba Express', effRate: resolveRate('ae-juba', 1067.24), kind: 'telco', action: { ussd: '*165#' },
    note: '*165# \u2192 More countries \u00b7 the only quotable route found \u00b7 Airtel lists the UAE but returns "service not live"',
    fundMobile: () => 0, fundBank: null },
];

const OUT_ROUTES_EU = [
  { id: 'eu-mtn',  name: 'MTN MoMo (via Thunes)', effRate: resolveRate('eu-mtn', 4506.9), kind: 'telco', action: { ussd: '*165#' },
    note: '*165# \u00b7 Euro banks \u00b7 flat 1,000 UGX network fee up to 5M \u00b7 rate only visible once the funds are in your wallet',
    fundMobile: () => 0, fundBank: null },
  { id: 'eu-ever', name: 'Eversend',              effRate: resolveRate('eu-ever', 4520.1), kind: 'digital', action: { href: EVERSEND_URL },
    note: 'In-app \u00b7 bank transfer \u00b7 better headline rate, but a 13,983 UGX fee on top cancels it out',
    fundMobile: eversendDeposit, fundBank: () => 0 },
];

const OUT_ROUTES_AE_EXTRA = [
  { id: 'ae-wu', name: 'Western Union', effRate: resolveRate('ae-wu', 1081.67), kind: 'counter', action: { href: 'https://www.westernunion.com' },
    note: 'Agent desk \u00b7 cash in hand \u00b7 national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
  { id: 'ae-mg', name: 'MoneyGram',     effRate: resolveRate('ae-mg', 1084.88), kind: 'counter', action: { href: 'https://www.moneygram.com' },
    note: 'Agent desk \u00b7 cash in hand \u00b7 national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
];
OUT_ROUTES_AE.push(...OUT_ROUTES_AE_EXTRA);

const OUT_ROUTES = { US: OUT_ROUTES_US, KE: OUT_ROUTES_KE, UK: OUT_ROUTES_UK, AE: OUT_ROUTES_AE, EU: OUT_ROUTES_EU };

// Corridors where the agent counters (Western Union, MoneyGram) have not been quoted yet.
const COUNTERS_PENDING = ['KE', 'EU'];

function fmtDest(n, d) {
  if (!isFinite(n)) return '\u2014';
  const dp = n >= 1000 ? 0 : 2;
  return d.sym + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtUGXShort(n) {
  return n >= 1000000 ? (n / 1000000) + 'M' : (n / 1000) + 'K';
}

function formatUpdated(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatVerified(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const METHODS = [
  { key: 'cash',   label: 'Cash pickup' },
  { key: 'bank',   label: 'Bank account' },
  { key: 'mobile', label: 'Mobile money' },
];

// Every change readers have forced. The map is only as good as its corrections.
const CORRECTIONS = [
  { date: '2026-07-04', who: 'u/moistandwarm1', what: 'Wise had been marked as not offering mobile money to Uganda. It had supported it for months. Corrected, with the 5,000,000 UGX per-transfer cap added.' },
  { date: '2026-07-11', who: 'u/brygad', what: 'Pointed out that people walk into banks asking the reverse question — "what do I send so they receive exactly X?" Built the "They need" mode because of this comment.' },
  { date: '2026-07-27', who: 'u/Long-Definition7091', what: 'Named Eversend, which the Uganda→US research had missed entirely. It works: no fee, roughly 4.4% below mid-market. It changed the conclusion of the published findings.' },
  { date: '2026-07-27', who: 'u/Available-Way-8534', what: 'Flagged Chipper Cash as fast but weak on rates. Verified: about 3.5% all-in — which makes it the cheapest formal route on the map. The rate criticism was accurate.' },
  { date: '2026-07-27', who: 'u/Feeling_Abrocoma502', what: 'Suggested Dahabshiil. Checked it — Uganda is not a sender country in their app. Mapped as a dead end rather than dropped.' },
  { date: '2026-07-28', who: 'u/ParticularAd1705', what: 'Reported a completed Uganda→UK transfer via Airtel Money in September 2025. That corridor was live and has since gone dark, rather than never having launched. Finding rewritten.' },
];

function fmtUSD(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUGX(n) {
  return Math.round(n).toLocaleString('en-US') + ' UGX';
}

export default function RemittanceLedger() {
  const [amount, setAmount] = useState(500);
  const initialRoute = typeof window !== 'undefined' ? routeFromPath(window.location.pathname) : ROUTES[0];
  const [corridor, setCorridor] = useState(initialRoute.corridor); // 'c1' US→UG calculator | 'c2' UG→US research
  const [mode, setMode] = useState('send'); // 'send' | 'receive'
  const [targetUGX, setTargetUGX] = useState(2000000);
  const [outUGX, setOutUGX] = useState(2000000);
  const [funding, setFunding] = useState('mobile'); // 'mobile' | 'bank'
  const [dest, setDest] = useState(initialRoute.dest);
  const [fxRates, setFxRates] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [method, setMethod] = useState('mobile');
  const [cashOut, setCashOut] = useState(false);
  const [midRate, setMidRate] = useState(FALLBACK_MID_RATE);
  // 'checking' while we fetch, 'live' if the API answered, 'fallback' if it
  // didn't, 'manual' once the user edits the rate themselves.
  const [rateSource, setRateSource] = useState('checking');
  const [providers, setProviders] = useState(DEFAULT_PROVIDERS);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const SHARE_URL = 'https://remittance-ledger.vercel.app';
  const SHARE_TEXT = 'Compare US → Uganda money transfer services after fees:';

  // Fetch the live USD→UGX mid-market rate once on load. Free endpoint, no
  // key. If it fails for any reason we quietly keep the fallback constant.
  useEffect(() => {
    let cancelled = false;
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const ugx = d?.rates?.UGX;
        if (typeof ugx === 'number' && ugx > 0) {
          setMidRate(Math.round(ugx));
          setFxRates(d.rates);
          setRateSource('live');
        } else {
          setRateSource('fallback');
        }
      })
      .catch(() => { if (!cancelled) setRateSource('fallback'); });
    return () => { cancelled = true; };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const updateProvider = (id, field, value) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  // Oldest "lastUpdated" across providers = the honest freshness claim for
  // the dataset as a whole.
  const dataVerified = useMemo(() => {
    return providers.reduce(
      (oldest, p) => (p.lastUpdated < oldest ? p.lastUpdated : oldest),
      providers[0]?.lastUpdated ?? TODAY,
    );
  }, [providers]);

  const rows = useMemo(() => {
    const amt = Number(amount) || 0;
    return providers
      .map(p => {
        const available = p[method];
        const totalFeeUSD = p.flatFee + amt * (p.percentFee / 100);
        const netUSD = Math.max(amt - totalFeeUSD, 0);
        const effectiveRate = midRate * (1 - p.fxMarkup / 100);
        const walletUGX = netUSD * effectiveRate;
        const applyCashOut = cashOut && method === 'mobile';
        const cashOutFee = applyCashOut ? cashOutCost(walletUGX) : 0;
        const recipientUGX = Math.max(walletUGX - cashOutFee, 0);
        const usdEquivalent = midRate > 0 ? recipientUGX / midRate : 0;
        const percentLost = amt > 0 ? ((amt - usdEquivalent) / amt) * 100 : 0;
        // Inverse: what USD must be sent so the recipient gets targetUGX?
        // With cash-out on, gross up so the target survives the levy and agent fee.
        const tgtRaw = Number(targetUGX) || 0;
        const tgt = applyCashOut ? grossUpForCashOut(tgtRaw) : tgtRaw;
        const pct = p.percentFee / 100;
        const usdNeeded = effectiveRate > 0 && pct < 1
          ? (tgt / effectiveRate + p.flatFee) / (1 - pct)
          : Infinity;
        const feeReceive = usdNeeded === Infinity ? 0 : p.flatFee + usdNeeded * pct;
        const percentLostReceive = usdNeeded > 0 && usdNeeded !== Infinity && midRate > 0
          ? ((usdNeeded - tgtRaw / midRate) / usdNeeded) * 100
          : 0;
        return { ...p, available, totalFeeUSD, walletUGX, cashOutFee, recipientUGX, effectiveRate, percentLost, usdNeeded, feeReceive, percentLostReceive };
      })
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return mode === 'send'
          ? b.recipientUGX - a.recipientUGX
          : a.usdNeeded - b.usdNeeded;
      });
  }, [providers, amount, method, midRate, mode, targetUGX, cashOut]);

  // Keep the URL, page title and description in step with the visible corridor.
  useEffect(() => {
    const r = routeFor(corridor, dest);
    if (window.location.pathname !== r.path) {
      window.history.pushState({ corridor, dest }, '', r.path);
    }
    document.title = r.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', r.desc);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', 'https://remittance-ledger.vercel.app' + r.path);
  }, [corridor, dest]);

  useEffect(() => {
    const onPop = () => {
      const r = routeFromPath(window.location.pathname);
      setCorridor(r.corridor);
      setDest(r.dest);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const FreshnessBar = ({ code }) => {
    const date = VERIFIED[code];
    if (!date) return null;
    const f = freshness(date);
    const label = f.level === 'ok'
      ? `Rates re-checked by hand ${f.days} ${f.days === 1 ? 'day' : 'days'} ago.`
      : f.level === 'aging'
        ? `These rates are ${f.days} days old and due a re-check. Treat them as indicative and confirm in the app before sending.`
        : `These rates are ${f.days} days old. They are past the point where they should be trusted \u2014 confirm every figure with the provider before sending.`;
    return (
      <div className={'fresh-bar fresh-' + f.level}>
        <span className="fresh-dot" />
        <span>{label} Last verified {formatUpdated(date)}. This map is re-checked monthly.</span>
      </div>
    );
  };

  const midFor = (cur) => cur === 'USD'
    ? midRate
    : (fxRates && fxRates[cur] ? midRate / fxRates[cur] : null);

  const comparison = useMemo(() => {
    const amt = Number(outUGX) || 0;
    return DESTINATIONS
      .filter(d => d.mapped && (OUT_ROUTES[d.code] || []).length > 0)
      .map(d => {
        const ref = midFor(d.cur);
        const scored = OUT_ROUTES[d.code].map(r => {
          const fn = funding === 'bank' ? r.fundBank : r.fundMobile;
          if (fn === null) return null;
          const got = Math.max(amt - fn(amt), 0) / r.effRate;
          return { name: r.name, got };
        }).filter(Boolean);
        if (!scored.length || !ref) return null;
        const best = scored.reduce((a, b) => (b.got > a.got ? b : a));
        const lost = amt > 0 ? (1 - best.got / (amt / ref)) * 100 : 0;
        return { ...d, best, lost };
      })
      .filter(Boolean)
      .sort((a, b) => a.lost - b.lost);
  }, [outUGX, funding, midRate, fxRates]);

  const destInfo = DESTINATIONS.find(d => d.code === dest) || DESTINATIONS[0];
  // UGX per unit of the destination currency, derived from the same USD-based feed.
  const destMid = destInfo.cur === 'USD'
    ? midRate
    : (fxRates && fxRates[destInfo.cur] ? midRate / fxRates[destInfo.cur] : null);

  const bestId = rows.find(r => r.available)?.id;

  const rateLabel =
    rateSource === 'live'     ? 'Live mid-market rate: 1 USD ='
  : rateSource === 'manual'   ? 'Your mid-market rate: 1 USD ='
  : rateSource === 'checking' ? 'Mid-market rate (updating…): 1 USD ='
  :                             'Mid-market rate (offline estimate): 1 USD =';

  return (
    <div className="ledger-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .ledger-root {
          --paper: #F6F1E7;
          --paper-deep: #EFE7D8;
          --ink: #2B2620;
          --ink-light: #8A8074;
          --rule: #D8CDB8;
          --stamp: #B0392B;
          --gold: #C0902F;
          --teal: #1F3D3A;
          --good-bg: #EAF1E7;

          font-family: 'IBM Plex Sans', system-ui, sans-serif;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum' 1, 'lnum' 1;
          color: var(--ink);
          background: var(--paper);
          background-image:
            repeating-linear-gradient(transparent, transparent 27px, var(--rule) 28px);
          border: 1px solid var(--rule);
          border-radius: 4px;
          max-width: 1060px;
          width: 100%;
          margin: 0 auto;
          padding: 0;
          box-shadow: 0 1px 3px rgba(43,38,32,0.08), 0 8px 24px rgba(43,38,32,0.06);
          overflow: hidden;
        }

        .ledger-header {
          background: var(--teal);
          color: var(--paper);
          padding: 30px 44px 26px;
          position: relative;
        }
        .ledger-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--gold);
          margin: 0 0 6px;
        }
        .ledger-title {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 34px;
          letter-spacing: -0.015em;
          font-weight: 600;
          margin: 0;
          letter-spacing: 0.01em;
        }
        .ledger-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: rgba(246,241,231,0.65);
          margin: 6px 0 0;
        }

        .ledger-body {
          padding: 30px 44px 10px;
        }

        .amount-row {
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .amount-label {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 18px;
          color: var(--ink-light);
        }
        .amount-input-wrap {
          display: flex;
          align-items: baseline;
          border-bottom: 2px solid var(--ink);
          padding-bottom: 2px;
        }
        .amount-prefix {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 38px;
          color: var(--ink-light);
          margin-right: 4px;
        }
        .amount-input {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 38px;
          font-weight: 600;
          color: var(--ink);
          background: transparent;
          border: none;
          outline: none;
          width: 160px;
        }

        .preset-row {
          display: flex;
          gap: 6px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .preset-btn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          padding: 4px 10px;
          border: 1px solid var(--rule);
          border-radius: 12px;
          background: transparent;
          color: var(--ink-light);
          cursor: pointer;
        }
        .preset-btn:hover { border-color: var(--ink-light); }
        .preset-btn.active {
          background: var(--ink);
          color: var(--paper);
          border-color: var(--ink);
        }

        .rate-line {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: var(--ink-light);
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .rate-live-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #3F7D4E;
          margin-right: 2px;
        }
        .rate-input {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          width: 64px;
          border: none;
          border-bottom: 1px dotted var(--ink-light);
          background: transparent;
          color: var(--ink);
        }

        .verified-line {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--ink-light);
          margin-top: 6px;
        }
        .verified-line button {
          font-family: inherit;
          font-size: inherit;
          color: var(--teal);
          background: none;
          border: none;
          border-bottom: 1px dotted var(--teal);
          padding: 0;
          cursor: pointer;
        }

        .method-row {
          display: flex;
          gap: 0;
          margin-top: 20px;
          border: 1px solid var(--ink);
          border-radius: 3px;
          overflow: hidden;
          width: fit-content;
        }
        .method-btn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 8px 14px;
          background: transparent;
          border: none;
          border-right: 1px solid var(--ink);
          cursor: pointer;
          color: var(--ink);
        }
        .method-btn:last-child { border-right: none; }
        .method-btn.active {
          background: var(--ink);
          color: var(--paper);
        }

        .perforation {
          margin: 24px 0 4px;
          border-top: 2px dashed var(--rule);
          position: relative;
          height: 0;
        }
        .perforation::before, .perforation::after {
          content: '';
          position: absolute;
          top: -7px;
          width: 14px;
          height: 14px;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 50%;
        }
        .perforation::before { left: -35px; }
        .perforation::after { right: -35px; }

        .rows-wrap {
          padding: 20px 44px 10px;
        }

        .ledger-row {
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr) 150px 190px;
          align-items: center;
          gap: 18px;
          padding: 16px 12px;
          border-radius: 4px;
          position: relative;
          margin-bottom: 4px;
        }
        .ledger-row.unavailable {
          opacity: 0.35;
        }
        .ledger-row.winner {
          background: var(--good-bg);
        }
        .row-index {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: var(--ink-light);
        }
        .row-name-wrap { min-width: 0; }
        .row-name {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 17px;
          font-weight: 600;
          margin: 0;
        }
        .row-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          color: var(--ink-light);
          margin: 2px 0 0;
        }
        .row-fee {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: var(--ink-light);
          text-align: right;
          white-space: nowrap;
        }
        .row-amount {
          font-variant-numeric: tabular-nums;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 19px;
          font-weight: 600;
          text-align: right;
          white-space: nowrap;
          min-width: 110px;
        }

        .stamp {
          position: absolute;
          top: -8px;
          right: 8px;
          transform: rotate(-9deg);
          border: 2px solid var(--stamp);
          color: var(--stamp);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 4px;
          pointer-events: none;
          mix-blend-mode: multiply;
          background: var(--paper);
          display: none;
        }
        @media (min-width: 520px) {
          .stamp { display: block; }
          .ledger-row { grid-template-columns: 28px 1fr auto auto; }
        }

        .unavailable-tag {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--ink-light);
          text-align: right;
        }

        .footer {
          padding: 24px 44px 32px;
        }
        .edit-toggle {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--teal);
          background: none;
          border: 1px solid var(--rule);
          border-radius: 3px;
          padding: 6px 12px;
          cursor: pointer;
        }
        .edit-toggle:hover { border-color: var(--teal); }

        .edit-panel {
          margin-top: 16px;
          overflow-x: auto;
          border: 1px solid var(--rule);
          border-radius: 4px;
          background: var(--paper-deep);
          padding: 14px 16px;
        }
        .edit-panel-title {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 10px;
        }
        .edit-grid {
          display: grid;
          min-width: 520px;
          grid-template-columns: 1fr 70px 70px 70px 1fr 90px;
          gap: 8px;
          align-items: center;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
        }
        .edit-grid-head {
          color: var(--ink-light);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 10px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--rule);
        }
        .edit-grid input[type="number"] {
          width: 60px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          border: 1px solid var(--rule);
          border-radius: 2px;
          padding: 3px 4px;
          background: var(--paper);
          color: var(--ink);
        }
        .edit-grid .methods-cell {
          display: flex;
          gap: 8px;
          font-size: 10px;
          align-items: center;
        }
        .edit-grid .methods-cell label {
          display: flex;
          align-items: center;
          gap: 3px;
          cursor: pointer;
        }

        .disclaimer {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--ink-light);
          line-height: 1.6;
          margin-top: 16px;
          border-top: 1px solid var(--rule);
          padding-top: 12px;
        }

        .feedback-row {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--rule);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--ink-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .feedback-link {
          color: var(--teal);
          text-decoration: none;
          border-bottom: 1px dotted var(--teal);
          padding-bottom: 1px;
          font-weight: 500;
        }
        .feedback-link:hover {
          color: var(--stamp);
          border-bottom-color: var(--stamp);
        }

        .corridor-note {
          margin-top: 14px;
          padding: 10px 12px;
          background: var(--paper-deep);
          border: 1px dashed var(--rule);
          border-radius: 3px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--ink-light);
          line-height: 1.5;
        }
        .corridor-note strong {
          color: var(--ink);
          font-weight: 600;
        }
        .corridor-note a {
          color: var(--teal);
          text-decoration: none;
          border-bottom: 1px dotted var(--teal);
        }

        .share-row {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--rule);
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .share-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--ink-light);
          letter-spacing: 0.04em;
        }
        .share-btn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          padding: 5px 12px;
          border: 1px solid var(--rule);
          border-radius: 14px;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          transition: all 0.15s ease;
        }
        .share-btn:hover {
          border-color: var(--ink);
          background: var(--paper-deep);
        }
        .share-btn.copied {
          border-color: var(--teal);
          color: var(--teal);
        }

        .corridor-tabs {
          display: flex;
          background: var(--teal);
          padding: 0 44px;
          gap: 0;
        }
        .corridor-tab {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 10px 14px 12px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: rgba(246,241,231,0.55);
          cursor: pointer;
        }
        .corridor-tab.active {
          color: var(--gold);
          border-bottom-color: var(--gold);
        }

        .research-wrap { padding: 26px 44px 10px; }
        .research-headline {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 19px;
          font-weight: 600;
          line-height: 1.4;
          margin: 0 0 6px;
        }
        .research-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          color: var(--ink-light);
          line-height: 1.6;
          margin: 0 0 18px;
        }
        .rail-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 4px;
          border-bottom: 1px solid var(--rule);
          flex-wrap: wrap;
        }
        .rail-name {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 15px;
          font-weight: 600;
          margin: 0;
        }
        .rail-note {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--ink-light);
          margin: 2px 0 0;
          width: 100%;
          line-height: 1.5;
        }
        .rail-status {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 3px;
          border: 1.5px solid;
          white-space: nowrap;
        }
        .st-agent   { color: var(--teal);  border-color: var(--teal); }
        .st-dead    { color: var(--stamp); border-color: var(--stamp); }
        .st-dormant { color: var(--gold);  border-color: var(--gold); }
        .quote-card {
          background: var(--good-bg);
          border: 1px solid var(--rule);
          border-radius: 4px;
          padding: 12px 14px;
          margin: 14px 0 0;
        }
        .quote-title {
          font-family: 'IBM Plex Serif', Georgia, serif;
          font-size: 15px;
          font-weight: 700;
          margin: 0 0 6px;
        }
        .quote-line {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          line-height: 1.7;
          margin: 0;
        }
        .quote-loss { color: var(--stamp); font-weight: 600; }
        .research-section-title {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ink-light);
          margin: 22px 0 4px;
        }

        .st-works { color: #2E6B2E; border-color: #2E6B2E; background: var(--good-bg); }

        .out-calc { margin: 4px 0 22px; }
        .out-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 120px 190px;
          align-items: center;
          gap: 18px;
          padding: 15px 12px;
          border-bottom: 1px solid var(--rule);
          border-radius: 3px;
        }
        .out-row.best { background: var(--good-bg); }
        .out-name { font-family: 'IBM Plex Serif', Georgia, serif; font-size: 17px; font-weight: 600; margin: 0; }
        .out-note { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light); margin: 2px 0 0; }
        .out-kind {
          font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em;
          text-transform: uppercase; padding: 2px 6px; border-radius: 3px; border: 1px solid; white-space: nowrap;
        }
        .k-digital  { color: #2E6B2E; border-color: #2E6B2E; }
        .k-counter  { color: var(--stamp); border-color: var(--stamp); }
        .k-informal { color: var(--gold); border-color: var(--gold); }
        .k-telco    { color: var(--ink-light); border-color: var(--ink-light); }
        .out-usd { font-family: 'IBM Plex Mono', monospace; font-size: 19px; font-weight: 600; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
        .out-lost { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--ink-light); text-align: right; }

        .log-panel {
          margin-top: 16px; border: 1px solid var(--rule); border-radius: 4px;
          background: var(--paper-deep); padding: 14px 16px;
        }
        .log-entry { padding: 10px 0; border-bottom: 1px solid var(--rule); }
        .log-entry:last-child { border-bottom: none; }
        .log-meta {
          font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.06em;
          color: var(--ink-light); margin: 0 0 3px;
        }
        .log-who { color: var(--teal); font-weight: 500; }
        .log-what { font-family: 'IBM Plex Mono', monospace; font-size: 11px; line-height: 1.65; margin: 0; }

        .cashout-row {
          display: flex; align-items: center; gap: 8px; margin-top: 12px;
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light);
          flex-wrap: wrap;
        }
        .cashout-switch {
          display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
          border: 1px solid var(--rule); border-radius: 14px; padding: 4px 11px;
          background: transparent; color: var(--ink); font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
        }
        .cashout-switch.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
        .cashout-hint { font-size: 10px; line-height: 1.5; width: 100%; margin: 2px 0 0; }
        .row-cashout {
          font-family: 'IBM Plex Mono', monospace; font-size: 9.5px;
          color: var(--stamp); margin: 2px 0 0; text-align: right;
        }

        .dest-row { display: flex; align-items: baseline; gap: 8px; margin: 4px 0 14px; flex-wrap: wrap; }
        .dest-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light); }
        .dest-select {
          font-family: 'IBM Plex Serif', Georgia, serif; font-size: 17px; font-weight: 600; color: var(--ink);
          background: transparent; border: none; border-bottom: 2px solid var(--ink);
          padding: 2px 20px 2px 2px; cursor: pointer; outline: none;
          appearance: none; -webkit-appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, var(--ink) 50%), linear-gradient(135deg, var(--ink) 50%, transparent 50%);
          background-position: right 8px top 55%, right 3px top 55%;
          background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
        }
        .pending-card {
          border: 1px dashed var(--rule); border-radius: 4px; background: var(--paper-deep);
          padding: 16px 18px; margin: 6px 0 20px;
        }
        .pending-title { font-family: 'IBM Plex Serif', Georgia, serif; font-size: 16px; font-weight: 600; margin: 0 0 8px; }
        .pending-line {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; line-height: 1.7; margin: 0 0 4px;
        }
        .pending-key { color: var(--ink-light); }

        @media (max-width: 760px) {
          .fresh-bar { font-size: 10px; }
          .ledger-header { padding: 22px 20px 18px; }
          .ledger-title { font-size: 26px; }
          .corridor-tabs { padding: 0 20px; }
          .ledger-body { padding: 22px 20px 8px; }
          .rows-wrap { padding: 16px 20px 8px; }
          .research-wrap { padding: 20px 20px 8px; }
          .footer { padding: 18px 20px 24px; }
          .ledger-row { grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; padding: 12px 4px; }
          .ledger-row .row-fee { grid-column: 2 / -1; text-align: left; }
          .out-row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 12px 4px; }
          .out-row .out-kind { grid-row: 2; justify-self: start; }
          .amount-input, .amount-prefix { font-size: 30px; }
          .row-amount, .out-usd { font-size: 17px; }
        }

        .cmp-wrap { padding: 26px 44px 10px; }
        .cmp-row {
          display: grid; grid-template-columns: minmax(0,1fr) 190px;
          gap: 18px; align-items: baseline; padding: 16px 12px;
          border-bottom: 1px solid var(--rule);
        }
        .cmp-row.best { box-shadow: inset 2px 0 0 var(--teal); }
        .cmp-dest { font-family: 'IBM Plex Serif', Georgia, serif; font-size: 18px; font-weight: 600; margin: 0; }
        .cmp-via { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light); margin: 2px 0 8px; }
        .cmp-bar { height: 7px; background: var(--paper-deep); border: 1px solid var(--rule); border-radius: 2px; overflow: hidden; }
        .cmp-fill { height: 100%; background: var(--teal); }
        .cmp-fill.hi { background: var(--stamp); }
        .cmp-amt { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; text-align: right; margin: 0; font-variant-numeric: tabular-nums; }
        .cmp-lost { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light); text-align: right; margin: 2px 0 0; }
        @media (max-width: 760px) {
          .cmp-wrap { padding: 20px 20px 8px; }
          .cmp-row { grid-template-columns: minmax(0,1fr) auto; gap: 12px; padding: 14px 4px; }
          .cmp-amt { font-size: 17px; }
        }

        .row-action {
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em;
          color: var(--teal); text-decoration: none; border-bottom: 1px dotted var(--teal);
          padding-bottom: 1px; white-space: nowrap;
        }
        .row-action:hover { color: var(--stamp); border-bottom-color: var(--stamp); }
        .row-ussd {
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em;
          color: var(--ink); background: var(--paper-deep); border: 1px solid var(--rule);
          border-radius: 2px; padding: 1px 6px; white-space: nowrap;
        }

        .aff-tag {
          font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink-light); border: 1px solid var(--rule);
          border-radius: 2px; padding: 1px 5px; margin-left: 6px; white-space: nowrap;
        }
        .disclosure {
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; line-height: 1.65;
          color: var(--ink-light); border: 1px solid var(--rule); border-radius: 3px;
          background: var(--paper-deep); padding: 11px 13px; margin-top: 14px;
        }
        .disclosure strong { color: var(--ink); font-weight: 600; }

        .fresh-bar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; line-height: 1.6;
          border: 1px solid var(--rule); border-radius: 3px;
          padding: 8px 11px; margin: 0 0 16px;
        }
        .fresh-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
        .fresh-ok     { background: var(--paper-deep); color: var(--ink-light); }
        .fresh-ok    .fresh-dot { background: #3E7A3E; }
        .fresh-aging  { background: #FBF3E2; border-color: #D9B45E; color: #7A5A16; }
        .fresh-aging .fresh-dot { background: #C0902F; }
        .fresh-stale  { background: #FBEDEB; border-color: #D89A92; color: #8C2F26; }
        .fresh-stale .fresh-dot { background: var(--stamp); }

        .about-wrap { padding: 30px 44px 12px; max-width: 680px; }
        .about-wrap h2 {
          font-family: 'IBM Plex Serif', Georgia, serif; font-size: 18px; font-weight: 600;
          margin: 26px 0 8px;
        }
        .about-wrap h2:first-of-type { margin-top: 4px; }
        .about-wrap p {
          font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 14px;
          line-height: 1.75; margin: 0 0 12px; color: var(--ink);
        }
        .about-wrap p.small {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-light);
          line-height: 1.7;
        }
        .about-wrap a { color: var(--teal); }
        .about-lede {
          font-family: 'IBM Plex Serif', Georgia, serif !important; font-size: 17px !important;
          line-height: 1.6 !important; font-style: italic; color: var(--ink-light) !important;
          border-left: 2px solid var(--rule); padding-left: 14px; margin-bottom: 22px !important;
        }
        @media (max-width: 760px) { .about-wrap { padding: 22px 20px 10px; } }
      `}</style>

      <div className="ledger-header">
        <p className="ledger-eyebrow">{corridor === 'about' ? 'Methodology · how this map is made' : corridor === 'c1' ? 'Corridor 01 · United States → Uganda' : corridor === 'c3' ? 'All corridors · sending out of Uganda' : `Corridor 02 · Uganda \u2192 ${destInfo.name}`}</p>
        <h1 className="ledger-title">Remittance Ledger</h1>
        <p className="ledger-sub">
          {corridor === 'c1'
            ? (mode === 'send' ? 'Estimate what arrives, before you send' : 'Estimate what to send, from what they need')
            : 'Field research from Kampala · what actually exists'}
        </p>
      </div>

      <div className="corridor-tabs">
        <button className={'corridor-tab' + (corridor === 'c1' ? ' active' : '')} onClick={() => setCorridor('c1')}>
          US → Uganda
        </button>
        <button className={'corridor-tab' + (corridor === 'c2' ? ' active' : '')} onClick={() => setCorridor('c2')}>
          Uganda → world
        </button>
        <button className={'corridor-tab' + (corridor === 'c3' ? ' active' : '')} onClick={() => setCorridor('c3')}>
          Compare corridors
        </button>
        <button
          className={'corridor-tab' + (corridor === 'about' ? ' active' : '')}
          style={{ marginLeft: 'auto' }}
          onClick={() => setCorridor('about')}
        >
          About
        </button>
      </div>

      {corridor === 'c1' && (<>
      <div className="ledger-body">
        <div className="corridor-note">
          <strong>Sending from outside the US?</strong> Currently only US → Uganda. Uganda → US is next, and UK/UAE/other corridors are on the radar based on early traffic. <a href="https://forms.gle/LHbTy2PEEWL2Utdc7" target="_blank" rel="noopener noreferrer">Let me know your corridor</a> — it shapes what I build next.
        </div>

        <div className="method-row" style={{ marginTop: '18px', marginBottom: '4px' }}>
          <button
            className={'method-btn' + (mode === 'send' ? ' active' : '')}
            onClick={() => setMode('send')}
          >
            I'm sending
          </button>
          <button
            className={'method-btn' + (mode === 'receive' ? ' active' : '')}
            onClick={() => setMode('receive')}
          >
            They need
          </button>
        </div>

        {mode === 'send' ? (
          <div className="amount-row" style={{ marginTop: '14px' }}>
            <span className="amount-label">Send</span>
            <div className="amount-input-wrap">
              <span className="amount-prefix">$</span>
              <input
                className="amount-input"
                type="number"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
            <span className="amount-label">from the US to Uganda</span>
          </div>
        ) : (
          <div className="amount-row" style={{ marginTop: '14px' }}>
            <span className="amount-label">They need</span>
            <div className="amount-input-wrap">
              <input
                className="amount-input"
                type="number"
                min="0"
                style={{ width: '190px' }}
                value={targetUGX}
                onChange={e => setTargetUGX(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="amount-prefix" style={{ fontSize: '20px', marginLeft: '6px', marginRight: 0 }}>UGX</span>
            </div>
            <span className="amount-label">in Uganda</span>
          </div>
        )}

        <div className="preset-row">
          {mode === 'send'
            ? PRESETS.map(p => (
                <button
                  key={p}
                  className={'preset-btn' + (Number(amount) === p ? ' active' : '')}
                  onClick={() => setAmount(p)}
                >
                  ${p}
                </button>
              ))
            : UGX_PRESETS.map(p => (
                <button
                  key={p}
                  className={'preset-btn' + (Number(targetUGX) === p ? ' active' : '')}
                  onClick={() => setTargetUGX(p)}
                >
                  {fmtUGXShort(p)}
                </button>
              ))}
        </div>

        <div className="rate-line">
          {rateSource === 'live' && <span className="rate-live-dot" aria-hidden="true" />}
          {rateLabel}
          <input
            className="rate-input"
            type="number"
            value={midRate}
            onChange={e => {
              setMidRate(Number(e.target.value) || 0);
              setRateSource('manual');
            }}
          />
          UGX
        </div>

        <p className="verified-line">
          Provider fees verified {formatVerified(dataVerified)} ·{' '}
          <button onClick={() => setEditing(true)}>adjust assumptions</button> if stale
        </p>

        <div className="method-row">
          {METHODS.map(m => (
            <button
              key={m.key}
              className={'method-btn' + (method === m.key ? ' active' : '')}
              onClick={() => setMethod(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {method === 'mobile' && (
          <div className="cashout-row">
            <button
              className={'cashout-switch' + (cashOut ? ' on' : '')}
              onClick={() => setCashOut(c => !c)}
            >
              {cashOut ? '\u2713 Cash-out included' : 'Add cash-out cost'}
            </button>
            <span>{cashOut ? 'showing what lands in hand' : 'showing what lands in the wallet'}</span>
            <p className="cashout-hint">
              Withdrawing mobile money as cash costs a 0.5% levy plus a tiered agent fee.
              Spending straight from the wallet — school fees, merchants, airtime, sending
              onward — costs nothing extra. Agent tiers are approximate and vary by network.
            </p>
          </div>
        )}
      </div>

      <div style={{ padding: '0 44px' }}><FreshnessBar code="US" /></div>

      <div className="perforation" />

      <div className="rows-wrap">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={'ledger-row' + (!r.available ? ' unavailable' : '') + (r.id === bestId ? ' winner' : '')}
          >
            <span className="row-index">{String(i + 1).padStart(2, '0')}</span>
            <div className="row-name-wrap">
              <p className="row-name">{r.name}</p>
              <p className="row-meta">{r.speed} · rates checked {formatUpdated(r.lastUpdated)}</p>
            </div>
            {r.available ? (
              <>
                <span className="row-fee">
                  fee {fmtUSD(mode === 'send' ? r.totalFeeUSD : r.feeReceive)}<br />
                  {(mode === 'send' ? r.percentLost : r.percentLostReceive).toFixed(1)}% lost
                </span>
                <div>
                  <p className="row-amount" style={{ margin: 0 }}>
                    {mode === 'send' ? fmtUGX(r.recipientUGX) : fmtUSD(r.usdNeeded)}
                  </p>
                  {cashOut && method === 'mobile' && mode === 'send' && r.cashOutFee > 0 && (
                    <p className="row-cashout">−{fmtUGX(r.cashOutFee)} to cash out</p>
                  )}
                </div>
              </>
            ) : (
              <span className="unavailable-tag" style={{ gridColumn: '3 / span 2' }}>
                Not offered for {METHODS.find(m => m.key === method).label.toLowerCase()}
              </span>
            )}
            {r.id === bestId && r.available && <span className="stamp">Best estimate</span>}
          </div>
        ))}
      </div>
      </>)}

      {corridor === 'c2' && (
        <div className="research-wrap">
          <p className="research-headline">
            Almost every way to send money from Uganda to the USA ends at a physical counter. Readers helped us find two digital doors.
          </p>
          <p className="research-sub">
            The telcos omit or haven't switched on the US. Ria blocks Ugandan signups. The bank's "international" rail is a WU counter.
            The two apps that work — Chipper Cash and Eversend — were both pointed out by readers after we published; nobody we asked in Kampala had named either.
            Field-verified in Kampala, July 2026.
          </p>

          <div className="dest-row">
            <span className="dest-label">Sending from Uganda to</span>
            <select className="dest-select" value={dest} onChange={e => setDest(e.target.value)}>
              {DESTINATIONS.map(d => (
                <option key={d.code} value={d.code}>{d.name}{d.mapped ? '' : ' \u2014 pricing pending'}</option>
              ))}
            </select>
          </div>

          {destInfo.mapped && <FreshnessBar code={dest} />}

          <p className="research-section-title">{destInfo.mapped ? `What arrives in ${destInfo.name}` : 'What we know so far'}</p>

          <div className="out-calc">
            {destInfo.mapped && <div className="amount-row" style={{ marginTop: '6px' }}>
              <span className="amount-label">Send</span>
              <div className="amount-input-wrap">
                <input
                  className="amount-input"
                  type="number"
                  min="0"
                  style={{ width: '180px' }}
                  value={outUGX}
                  onChange={e => setOutUGX(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <span className="amount-prefix" style={{ fontSize: '20px', marginLeft: '6px', marginRight: 0 }}>UGX</span>
              </div>
            </div>}

            {destInfo.mapped && <div className="method-row" style={{ marginTop: '12px', marginBottom: '10px' }}>
              <button className={'method-btn' + (funding === 'mobile' ? ' active' : '')} onClick={() => setFunding('mobile')}>
                From mobile money
              </button>
              <button className={'method-btn' + (funding === 'bank' ? ' active' : '')} onClick={() => setFunding('bank')}>
                From bank
              </button>
            </div>}

            {destInfo.mapped && <p className="research-sub" style={{ margin: '0 0 10px' }}>
              {funding === 'mobile'
                ? 'Instant, but loading a wallet from MTN or Airtel carries a deposit fee — Chipper charges 2.5%, Eversend a flat 37,103 UGX plus 0.49%. Counters take cash, so they are unaffected.'
                : 'Bank deposits carry no platform fee on either app \u2014 Chipper from Absa or Stanbic, Eversend from Stanbic \u2014 but take 1\u20132 days to clear. Counters and telco menus take cash or wallet balance directly and are unaffected.'}
            </p>}

            {destInfo.mapped && <div className="preset-row" style={{ marginBottom: '14px' }}>
              {UGX_PRESETS.map(p => (
                <button
                  key={p}
                  className={'preset-btn' + (Number(outUGX) === p ? ' active' : '')}
                  onClick={() => setOutUGX(p)}
                >
                  {fmtUGXShort(p)}
                </button>
              ))}
            </div>}

            {destInfo.mapped && (OUT_ROUTES[dest] || []).length > 0 ? (OUT_ROUTES[dest])
              .map(r => {
                const amt = Number(outUGX) || 0;
                const fn = funding === 'bank' ? r.fundBank : r.fundMobile;
                const unverified = fn === null;
                const fundFee = unverified ? 0 : fn(amt);
                const usd = Math.max(amt - fundFee, 0) / r.effRate;
                const ref = destMid || midRate;
                const lost = amt > 0 && ref > 0 ? (1 - usd / (amt / ref)) * 100 : 0;
                return { ...r, usd, lost, fundFee, unverified };
              })
              .sort((a, b) => (a.unverified === b.unverified ? b.usd - a.usd : a.unverified ? 1 : -1))
              .map((r, i) => (
                <div key={r.id} className={'out-row' + (i === 0 ? ' best' : '')}>
                  <div>
                    <p className="out-name">{r.name}</p>
                    <p className="out-note">{r.note}</p>
                    {r.action && (
                      <p style={{ margin: '5px 0 0' }}>
                        {r.action.ussd
                          ? <span className="row-ussd">Dial {r.action.ussd}</span>
                          : <>
                              <a className="row-action" href={r.action.href} target="_blank" rel="noopener noreferrer">Open {r.name} →</a>
                              {isAffiliate(r.name) && <span className="aff-tag">paid link</span>}
                            </>}
                      </p>
                    )}
                  </div>
                  <span className={'out-kind k-' + r.kind}>{r.kind}</span>
                  <div>
                    {r.unverified ? (
                      <p className="out-lost" style={{ margin: 0 }}>not verified</p>
                    ) : (
                      <>
                        <p className="out-usd" style={{ margin: 0 }}>{fmtDest(r.usd, destInfo)}</p>
                        <p className="out-lost" style={{ margin: 0 }}>
                          {r.lost.toFixed(1)}% lost
                          {r.fundFee > 0 && <><br />{'\u2212'}{fmtUGX(r.fundFee)} to fund</>}
                        </p>
                        {(() => {
                          const mv = rateMovement(r.id);
                          if (!mv) return null;
                          const cls = mv.flat ? 'move-flat' : mv.pct > 0 ? 'move-worse' : 'move-better';
                          const txt = mv.flat
                            ? 'unchanged since ' + formatUpdated(mv.since)
                            : (mv.pct > 0 ? '\u2191 ' : '\u2193 ') + Math.abs(mv.pct).toFixed(1) + '% since ' + formatUpdated(mv.since);
                          return <p className={'rate-move ' + cls}>{txt}</p>;
                        })()}
                      </>
                    )}
                  </div>
                </div>
              )) : (
              <div className="pending-card">
                <p className="pending-title">{destInfo.name}: rails known, pricing not yet collected</p>
                {MENU_AVAILABILITY[dest] && (
                  <>
                    <p className="pending-line"><span className="pending-key">MTN MoMo:</span> {MENU_AVAILABILITY[dest].mtn}</p>
                    <p className="pending-line"><span className="pending-key">Airtel Money:</span> {MENU_AVAILABILITY[dest].airtel}</p>
                    <p className="pending-line" style={{ marginTop: '8px' }}>{MENU_AVAILABILITY[dest].note}</p>
                  </>
                )}
                <p className="pending-line" style={{ marginTop: '10px' }}>
                  {destMid
                    ? `Mid-market reference today: 1 ${destInfo.cur} \u2248 ${Math.round(destMid).toLocaleString('en-US')} UGX.`
                    : 'Mid-market reference unavailable right now.'}{' '}
                  Sent from Uganda to {destInfo.name} recently?{' '}
                  <a href="https://forms.gle/LHbTy2PEEWL2Utdc7" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>
                    Send the numbers
                  </a>{' '}and this corridor gets mapped sooner.
                </p>
              </div>
            )}

            {destInfo.mapped && COUNTERS_PENDING.includes(dest) && (
              <p className="research-sub" style={{ marginTop: '10px', marginBottom: 0 }}>
                <strong style={{ color: 'var(--ink)' }}>Not yet quoted for this corridor:</strong> the Western Union
                and MoneyGram agent counters. They are the default option most people reach for, so treat this
                ranking as covering the app and telco routes only until those are collected.
                {dest === 'UK' && ' The GBP mid-market rate also moved about 3% across sources on the day these were checked, so the UK percentages carry a wider error bar than the rest of the map.'}
                {dest === 'EU' && ' MTN quotes this corridor through Thunes and warns the markup can reach 5% on volatile days, so treat the EU figures as a snapshot of a moving number rather than a standing rate.'}
              </p>
            )}

            {destInfo.mapped && <p className="research-sub" style={{ marginTop: '10px', marginBottom: 0 }}>
              Rates verified by hand in Kampala, {dest === 'US' ? 'July' : 'August'} 2026 — fees and FX bundled into one effective rate,
              calibrated to real 2,000,000 UGX quotes. "% lost" is measured against today's live mid-market rate,
              so it moves as the shilling moves. Agent quotes vary by bureau. Confirm before you send.
            </p>}
          </div>

          <p className="research-section-title">The rails, checked one by one</p>

          <div className="rail-row">
            <p className="rail-name">MTN MoMo</p>
            <span className="rail-status st-dead">US absent</span>
            <p className="rail-note">Outbound reaches 22 countries by bank (UK, Canada, UAE, India…) plus wallets & AliPay/WeChat — the US is not on any list. Verified via *165#, Jul 2026.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Airtel Money</p>
            <span className="rail-status st-dormant">Went dark</span>
            <p className="rail-note">USA appears in the Rest-of-World menu — tapping it returns "service not live." So do England, UAE, Germany, Japan, Denmark and Ireland. But a reader reports a completed Uganda→UK transfer via Airtel Money in September 2025 at roughly 5% below mid-market — so this corridor was live and has since gone dark, rather than never having launched. Whatever switched it off is unexplained. Verified via *185#, Jul 2026.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Ria (app)</p>
            <span className="rail-status st-dead">Geo-blocked</span>
            <p className="rail-note">"Based on current location, we can only register an account to send money from this country." No Ugandan self-serve registration. Agent counters only.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Dahabshiil</p>
            <span className="rail-status st-dead">Receive only</span>
            <p className="rail-note">The hawala-rooted network: sender countries are Europe, UK and US only — not one African country can originate. Uganda receives (cash pickup: Kampala, Gulu, Arua; USD or UGX) while Kenya gets M-Pesa and bank options. Inbound pricing quirk: $30 fee on $500 but only $3 on the $10k max — the fee curve rewards the biggest senders. Verified in-app, Jul 2026.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Dahabshiil</p>
            <span className="rail-status st-dead">No Uganda send</span>
            <p className="rail-note">The East African specialist — but Uganda isn't a sender country in its app (same location wall as Ria). Inbound US→UG works: rate above mid-market (+1.5%) but ~6% fees at typical amounts, cash pickup only (Kampala, Gulu, Arua) — while Kenya gets M-Pesa and banks. Built for big transfers: $10,000 costs $3.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">WorldRemit</p>
            <span className="rail-status st-dead">Exited 2022</span>
            <p className="rail-note">Ceased all outbound services from Uganda in June 2022. Receiving still works; sending out does not.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Chipper Cash</p>
            <span className="rail-status st-works">Works · digital · best rate</span>
            <p className="rail-note">Reader-sourced lead #2, verified in-app: UGX → USA at rate 3,793.04 (≈ 3.2% vs mid-market) — the best formal rate found. Free via Chipper tag (both need accounts), or bank account payout. Oddly, its inbound US→UG rate (3,554.80, ≈ 3.2% markup) is mediocre — Chipper is cheap out of Uganda, expensive into it. Eversend is the exact mirror.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Chipper Cash</p>
            <span className="rail-status st-works">Works · digital · cheapest</span>
            <p className="rail-note">The second digital door — and the cheapest formal route found. UGX → US in-app: rate 3,793.04 (≈ 3.2% spread) + 0.25% fee ≈ 3.5% total. US side receives to bank, or free via Chipper tag (recipient needs the app). Reader-sourced ("works well and fast, downside is the exchange rates" — confirmed accurate), verified in-app Jul 2026. Inbound US→UG rate is weak (3,554.80) — best used outbound.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Eversend</p>
            <span className="rail-status st-works">Works · digital</span>
            <p className="rail-note">The one that actually works — found via a reader comment, not by any of the people we asked in Kampala. UGX wallet → US bank account: no fee, rate 3,843.93 vs mid-market ~3,674 (≈ 4.4% spread). For 2M UGX ≈ $520 arrives — cheaper than both counters, no trip required. Load via mobile money, Stanbic, or card (3% via Flutterwave). Verified in-app, Jul 2026.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Wendi (Pearl Bank wallet)</p>
            <span className="rail-status st-dormant">Buggy / in limbo</span>
            <p className="rail-note">The one app that advertises in-app Western Union sends abroad. Registered and tested: the WU flow asks for an address, then goes nowhere. Support says it's fee-free at standard WU rates "when it works." A would-be third digital door, still under construction with the lights on.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Bank (DTB)</p>
            <span className="rail-status st-agent">Counter only</span>
            <p className="rail-note">The mobile banking app doesn't send internationally — DTB's international rail IS Western Union at the branch, national ID in person, both directions. The bank layer collapses into the agent layer.</p>
          </div>

          <div className="rail-row">
            <p className="rail-name">Western Union · MoneyGram · Ria</p>
            <span className="rail-status st-agent">Agent only</span>
            <p className="rail-note">Working Uganda → US transfers exist — but only by walking to a forex bureau / agent with cash and national ID, plus stating purpose & source of funds. US payout: cash pickup or bank deposit.</p>
          </div>

          <p className="research-section-title">Real quotes · 2,000,000 UGX to the US · Kampala agent desk, Jul 2026</p>

          <div className="quote-card">
            <p className="quote-title">MoneyGram — $515 arrives</p>
            <p className="quote-line">Fee 19,773 UGX · rate 3,846 · <span className="quote-loss">≈ 5.4% lost</span> vs mid-market (~$544 at 3,674)</p>
          </div>
          <div className="quote-card">
            <p className="quote-title">Western Union — $510 arrives</p>
            <p className="quote-line">Fee 22,738 UGX · rate 3,759 · <span className="quote-loss">≈ 6.3% lost</span> vs mid-market</p>
          </div>

          <div className="quote-card">
            <p className="quote-title">Chipper Cash (app) — ≈ $527 arrives · fully digital, best formal rate</p>
            <p className="quote-line">UGX → US: rate 3,793.04, free via Chipper tag · <span className="quote-loss">≈ 3.2% lost</span> vs mid-market — cheapest formal route found. Reader-sourced, verified in-app.</p>
          </div>

          <div className="quote-card">
            <p className="quote-title">Chipper Cash (app) — ≈ $526 arrives · cheapest formal route</p>
            <p className="quote-line">UGX → US in-app: rate 3,793.04 + 0.25% fee · <span className="quote-loss">≈ 3.5% lost</span> vs mid-market — fully digital, reader-sourced, verified in-app.</p>
          </div>

          <div className="quote-card">
            <p className="quote-title">Eversend (app) — ≈ $520 arrives · fully digital</p>
            <p className="quote-line">UGX wallet → US bank: no fee, rate 3,843.93 · <span className="quote-loss">≈ 4.4% lost</span> vs mid-market — beats both counters, no trip. Reader-sourced, then verified in-app.</p>
          </div>

          <div className="quote-card" style={{ background: 'var(--paper-deep)' }}>
            <p className="quote-title">The invisible route: P2P crypto — ≈ 2.5% spread</p>
            <p className="quote-line">Binance P2P order book (Jul 23): Ugandans buying USDT pay 3,764–3,774 UGX/$ vs mid-market ~3,674 — <span className="quote-loss">≈ 2.5% to exit UGX</span>, funded by the same MTN/Airtel wallets that can't send to the US directly. Roughly half the cost of the counters. Nobody we asked in Kampala mentioned it. (Documented as what exists, not a recommendation — P2P carries scam risk and Uganda's crypto rules are ambiguous.)</p>
          </div>

          <p className="research-sub" style={{ marginTop: '16px' }}>
            For comparison: sending the other direction (US → Uganda) costs ~1–1.5% with the best apps.
            Sending out of Uganda through the counters costs 4–5× more — and requires a physical trip.
            Every formal route we tested — the telcos, the bank, the app — ends at the same place: a counter, a national ID, and 5–6%.
          </p>

          <p className="research-section-title">Notes & caveats</p>
          <p className="research-sub">
            Ria runs ~280 pickup/partner locations (mostly Kampala) but its app blocks Ugandan registration — outbound is agent-only.
            Asked around Kampala, everyone names the same three: WU, MoneyGram, slow bank transfers — nobody names Wendi or P2P.
            Agent quotes are point-in-time and vary by bureau — a snapshot, not live pricing. Field research, Kampala, Jul 2026.
          </p>

          <p className="research-sub">
            <strong style={{ color: 'var(--ink)' }}>In Uganda? Help map this.</strong> Got a quote from your own bureau or bank?{' '}
            <a href="https://forms.gle/LHbTy2PEEWL2Utdc7" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>
              Send it in
            </a> — every real quote makes the map sharper.
          </p>
        </div>
      )}

      {corridor === 'c3' && (
        <div className="cmp-wrap">
          <p className="research-headline" style={{ marginBottom: '4px' }}>
            The same 2 million shillings buys very different amounts depending on where it lands.
          </p>
          <p className="research-sub">
            Best available route per corridor, hand-verified in Kampala. Kenya costs roughly a third of what
            Britain does for an identical transfer — the destination sets the price far more than the provider does.
          </p>

          {(() => {
            const codes = comparison.map(c => c.code).filter(c => VERIFIED[c]);
            if (!codes.length) return null;
            const oldest = codes.reduce((a, b) => (daysSince(VERIFIED[a]) > daysSince(VERIFIED[b]) ? a : b));
            return <FreshnessBar code={oldest} />;
          })()}

          <div className="amount-row" style={{ marginTop: '10px' }}>
            <span className="amount-label">Send</span>
            <div className="amount-input-wrap">
              <input
                className="amount-input"
                type="number"
                min="0"
                style={{ width: '190px' }}
                value={outUGX}
                onChange={e => setOutUGX(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="amount-prefix" style={{ marginLeft: '6px', marginRight: 0 }}>UGX</span>
            </div>
          </div>

          <div className="preset-row" style={{ marginBottom: '10px' }}>
            {UGX_PRESETS.map(p => (
              <button key={p} className={'preset-btn' + (Number(outUGX) === p ? ' active' : '')} onClick={() => setOutUGX(p)}>
                {fmtUGXShort(p)}
              </button>
            ))}
          </div>

          <div className="method-row" style={{ marginBottom: '18px' }}>
            <button className={'method-btn' + (funding === 'mobile' ? ' active' : '')} onClick={() => setFunding('mobile')}>
              From mobile money
            </button>
            <button className={'method-btn' + (funding === 'bank' ? ' active' : '')} onClick={() => setFunding('bank')}>
              From bank
            </button>
          </div>

          {comparison.map((c, i) => (
            <div key={c.code} className={'cmp-row' + (i === 0 ? ' best' : '')}>
              <div>
                <p className="cmp-dest">{c.name}</p>
                <p className="cmp-via">cheapest via {c.best.name}</p>
                <div className="cmp-bar">
                  <div
                    className={'cmp-fill' + (c.lost >= 6 ? ' hi' : '')}
                    style={{ width: Math.min(Math.max(c.lost, 0) / 10 * 100, 100) + '%' }}
                  />
                </div>
              </div>
              <div>
                <p className="cmp-amt">{fmtDest(c.best.got, c)}</p>
                <p className="cmp-lost">{c.lost.toFixed(1)}% lost</p>
              </div>
            </div>
          ))}

          <p className="research-sub" style={{ marginTop: '14px' }}>
            Bars are scaled to a 10% loss. Canada is absent because MTN will not quote a rate until recipient
            bank details are entered — you cannot price that corridor before committing to it. Agent counter
            quotes are still missing outside the US corridor, so these are the app and telco routes only.
          </p>
        </div>
      )}

      {corridor === 'about' && (
        <div className="about-wrap">
          <p className="about-lede">
            My mum is in Kampala. I am usually in the US. For years money moved between us and
            neither of us knew what we were losing to get it there. This map is the answer to that.
          </p>

          <h2>What this is</h2>
          <p>
            A free comparison of what money actually costs to move between Uganda and five other
            places. Not the advertised fee \u2014 the amount that lands in someone's hands after the
            fee, the exchange-rate markup, the cost of loading a wallet, and the cost of taking
            it out again. Those four things are usually quoted separately, or not at all.
          </p>

          <h2>How the rates are collected</h2>
          <p>
            By hand, in Kampala. I walk into forex bureaus and ask for a quote on 2,000,000
            shillings. I dial *165# and *185# and step through the menus. I install the apps,
            register, and take the numbers off the confirmation screen before sending. Where I
            have sent money myself, I have used my own.
          </p>
          <p>
            Nothing here is scraped from a marketing page, because marketing pages leave out the
            part that costs you money. Western Union quoting above mid-market, Remitly's rate
            dropping after your first $500, Chipper charging 2.5% just to load the wallet, MTN
            refusing to show a rate until the funds are already in your account \u2014 none of that
            appears anywhere except at the counter or inside the app.
          </p>

          <h2>How the numbers are calculated</h2>
          <p>
            Each route is reduced to one effective rate: the shillings you surrender per unit of
            currency delivered, with every fee folded in. That figure is compared against the live
            mid-market rate, fetched fresh each time the page loads. The difference is what you
            lose. Because the reference rate is live and the quotes are dated, the percentages
            shift slightly as currencies move \u2014 which is honest, and shows you when a snapshot
            is going stale.
          </p>
          <p className="small">
            Every corridor carries the date it was last checked. Past 35 days the page says so.
            Past 60 it tells you not to trust the numbers. The map is re-verified monthly.
          </p>
          <p>
            Nothing is overwritten. Every reading is kept with the date it was taken, so the record
            grows rather than being replaced. Once a route has been checked twice, the page shows
            which way the cost has moved. Over time that becomes something that cannot be
            reconstructed after the fact — a running account of what these corridors actually
            charged, month by month.
          </p>

          <h2>How it gets corrected</h2>
          <p>
            Readers correct it, and the record is public \u2014 there is a log of every change in the
            footer. Someone caught that Wise had supported mobile money for months while this map
            said otherwise. Two people named apps I had missed entirely, one of which turned out
            to be the cheapest route out of Uganda and reversed a conclusion I had already
            published. Another reported a completed transfer on a corridor I had written off as
            never having launched.
          </p>
          <p>
            If something here is wrong, tell me and it gets fixed with your name on it.{' '}
            <a href="https://forms.gle/LHbTy2PEEWL2Utdc7" target="_blank" rel="noopener noreferrer">
              Send a correction or a quote from your own bureau
            </a>.
          </p>

          <h2>How it is funded</h2>
          <p>
            Three providers \u2014 Wise, Remitly and WorldRemit \u2014 run affiliate programmes, and links
            to them are marked <em>paid link</em> wherever they appear. Everything else earns
            nothing, including every route that currently ranks first on this map. Rankings come
            from the verified rates and nothing else. If a paid provider is cheapest, it is
            because the arithmetic says so; where it is not, it sits below the ones that are.
          </p>

          <h2>What it does not cover</h2>
          <p className="small">
            Agent counter quotes are still missing for Kenya and Europe. Canada appears in MTN's
            menu but cannot be priced, because no rate is shown until recipient bank details are
            entered. Rates at bureaus vary between branches, so treat counter figures as one
            sample rather than a standing price. Everything here is an estimate to plan with \u2014
            confirm the final number with the provider before you send.
          </p>
        </div>
      )}

      <div className="footer">
        {corridor === 'c1' && (
          <button className="edit-toggle" onClick={() => setEditing(e => !e)}>
            {editing ? 'Hide rate assumptions' : 'Adjust rate assumptions'}
          </button>
        )}

        <button className="edit-toggle" style={{ marginLeft: corridor === 'c1' ? '8px' : 0 }} onClick={() => setShowLog(s => !s)}>
          {showLog ? 'Hide corrections' : `Corrected ${CORRECTIONS.length}× by readers`}
        </button>

        {showLog && (
          <div className="log-panel">
            <p className="edit-panel-title">What readers have corrected</p>
            <p className="log-what" style={{ color: 'var(--ink-light)', marginBottom: '8px' }}>
              This map is wrong until someone tells us. Every change below came from a person who
              actually uses these routes.
            </p>
            {CORRECTIONS.map((c, i) => (
              <div className="log-entry" key={i}>
                <p className="log-meta">{formatUpdated(c.date)} · <span className="log-who">{c.who}</span></p>
                <p className="log-what">{c.what}</p>
              </div>
            ))}
          </div>
        )}

        {corridor === 'c1' && editing && (
          <div className="edit-panel">
            <p className="edit-panel-title">Provider assumptions</p>
            <div className="edit-grid">
              <span className="edit-grid-head">Provider</span>
              <span className="edit-grid-head">Flat fee $</span>
              <span className="edit-grid-head">% fee</span>
              <span className="edit-grid-head">FX markup %</span>
              <span className="edit-grid-head">Payout methods</span>
              <span className="edit-grid-head">Checked</span>
              {providers.map(p => (
                <FragmentRow key={p.id} p={p} update={updateProvider} />
              ))}
            </div>
          </div>
        )}

        <p className="disclaimer">
          Figures are rough planning estimates, not live quotes — actual fees, FX margins, and
          available payout methods change often and vary by amount, state, and promotions.
          Estimates assume bank-funded transfers; paying by debit or credit card usually
          costs more. Always confirm the final "recipient gets" number on the provider's own
          site or app before sending. Edit the assumptions above as you research real rates
          for your corridor and amount.
        </p>

        <div className="feedback-row">
          <span>Spotted something off, or want a feature?</span>
          <a
            className="feedback-link"
            href="https://forms.gle/LHbTy2PEEWL2Utdc7"
            target="_blank"
            rel="noopener noreferrer"
          >
            Send feedback →
          </a>
        </div>

        <div className="disclosure">
          <strong>How this is funded.</strong> Links marked <span className="aff-tag">paid link</span> earn a
          small commission if you sign up through them \u2014 currently Wise, Remitly and WorldRemit. Nothing
          else on this map pays anything, including every route that currently ranks first: Eversend, Chipper
          Cash, LemFi, MTN and Airtel all earn me nothing. Rankings are computed from rates verified by hand
          and re-checked monthly, and the affiliate list has no bearing on them. If a paid provider is the
          cheapest it is because the numbers say so; if it is not, it is ranked below the ones that are.
        </div>

        <div className="share-row">
          <span className="share-label">Know someone this could help?</span>
          <a
            className="share-btn"
            href={`https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + ' ' + SHARE_URL)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <a
            className="share-btn"
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            X / Twitter
          </a>
          <button
            className={'share-btn' + (copied ? ' copied' : '')}
            onClick={handleCopy}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ p, update }) {
  return (
    <>
      <span style={{ fontFamily: "'IBM Plex Serif', Georgia, serif", fontSize: '12px', fontWeight: 600 }}>{p.name}</span>
      <input
        type="number"
        step="0.01"
        value={p.flatFee}
        onChange={e => update(p.id, 'flatFee', Number(e.target.value) || 0)}
      />
      <input
        type="number"
        step="0.01"
        value={p.percentFee}
        onChange={e => update(p.id, 'percentFee', Number(e.target.value) || 0)}
      />
      <input
        type="number"
        step="0.01"
        value={p.fxMarkup}
        onChange={e => update(p.id, 'fxMarkup', Number(e.target.value) || 0)}
      />
      <span className="methods-cell">
        {METHODS.map(m => (
          <label key={m.key}>
            <input
              type="checkbox"
              checked={p[m.key]}
              onChange={e => update(p.id, m.key, e.target.checked)}
            />
            {m.label.split(' ')[0]}
          </label>
        ))}
      </span>
      <input
        type="date"
        value={p.lastUpdated}
        max={TODAY}
        onChange={e => update(p.id, 'lastUpdated', e.target.value)}
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', border: '1px solid var(--rule)', borderRadius: '2px', padding: '3px 4px', background: 'var(--paper)', color: 'var(--ink)' }}
      />
    </>
  );
}

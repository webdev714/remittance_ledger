import { useState, useMemo, useEffect } from 'react';
import providerData from './providers.json';

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
const OUT_ROUTES = [
  { id: 'p2p',      name: 'P2P crypto (USDT)', effRate: 3770.0,  kind: 'informal',
    note: 'Binance P2P · scam risk, murky rules · MoMo send charge not modelled',
    fundMobile: () => 0, fundBank: null },
  { id: 'chipper',  name: 'Chipper Cash',      effRate: 3802.5,  kind: 'digital',
    note: 'In-app · US bank or free Chipper tag',
    fundMobile: chipperDeposit, fundBank: () => 0 },
  { id: 'eversend', name: 'Eversend',          effRate: 3843.93, kind: 'digital',
    note: 'In-app · US bank · no transfer fee',
    fundMobile: eversendDeposit, fundBank: null },
  { id: 'mg-out',   name: 'MoneyGram',         effRate: 3883.5,  kind: 'counter',
    note: 'Agent desk · cash in hand · national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
  { id: 'wu-out',   name: 'Western Union',     effRate: 3921.6,  kind: 'counter',
    note: 'Agent desk · cash in hand · national ID + purpose of funds',
    fundMobile: () => 0, fundBank: () => 0 },
];

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
  const [corridor, setCorridor] = useState('c1'); // 'c1' US→UG calculator | 'c2' UG→US research
  const [mode, setMode] = useState('send'); // 'send' | 'receive'
  const [targetUGX, setTargetUGX] = useState(2000000);
  const [outUGX, setOutUGX] = useState(2000000);
  const [funding, setFunding] = useState('mobile'); // 'mobile' | 'bank'
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

  const bestId = rows.find(r => r.available)?.id;

  const rateLabel =
    rateSource === 'live'     ? 'Live mid-market rate: 1 USD ='
  : rateSource === 'manual'   ? 'Your mid-market rate: 1 USD ='
  : rateSource === 'checking' ? 'Mid-market rate (updating…): 1 USD ='
  :                             'Mid-market rate (offline estimate): 1 USD =';

  return (
    <div className="ledger-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

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

          font-family: 'Inter', sans-serif;
          color: var(--ink);
          background: var(--paper);
          background-image:
            repeating-linear-gradient(transparent, transparent 27px, var(--rule) 28px);
          border: 1px solid var(--rule);
          border-radius: 4px;
          max-width: 720px;
          margin: 0 auto;
          padding: 0;
          box-shadow: 0 1px 3px rgba(43,38,32,0.08), 0 8px 24px rgba(43,38,32,0.06);
          overflow: hidden;
        }

        .ledger-header {
          background: var(--teal);
          color: var(--paper);
          padding: 22px 28px 18px;
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
          font-family: 'Fraunces', serif;
          font-size: 28px;
          font-weight: 600;
          margin: 0;
          letter-spacing: 0.01em;
        }
        .ledger-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: rgba(246,241,231,0.65);
          margin: 6px 0 0;
        }

        .ledger-body {
          padding: 24px 28px 8px;
        }

        .amount-row {
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .amount-label {
          font-family: 'Fraunces', serif;
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
          font-size: 32px;
          color: var(--ink-light);
          margin-right: 4px;
        }
        .amount-input {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 32px;
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
          padding: 16px 28px 8px;
        }

        .ledger-row {
          display: grid;
          grid-template-columns: 28px 1fr auto auto;
          align-items: center;
          gap: 14px;
          padding: 12px 10px;
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
          font-family: 'Fraunces', serif;
          font-size: 16px;
          font-weight: 600;
          margin: 0;
        }
        .row-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
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
          font-family: 'IBM Plex Mono', monospace;
          font-size: 17px;
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
          padding: 18px 28px 24px;
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
          font-family: 'Fraunces', serif;
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
          padding: 0 28px;
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

        .research-wrap { padding: 20px 28px 8px; }
        .research-headline {
          font-family: 'Fraunces', serif;
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
          font-family: 'Fraunces', serif;
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
          font-family: 'Fraunces', serif;
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
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 10px;
          padding: 11px 8px;
          border-bottom: 1px solid var(--rule);
          border-radius: 3px;
        }
        .out-row.best { background: var(--good-bg); }
        .out-name { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; margin: 0; }
        .out-note { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--ink-light); margin: 2px 0 0; }
        .out-kind {
          font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em;
          text-transform: uppercase; padding: 2px 6px; border-radius: 3px; border: 1px solid; white-space: nowrap;
        }
        .k-digital  { color: #2E6B2E; border-color: #2E6B2E; }
        .k-counter  { color: var(--stamp); border-color: var(--stamp); }
        .k-informal { color: var(--gold); border-color: var(--gold); }
        .out-usd { font-family: 'IBM Plex Mono', monospace; font-size: 17px; font-weight: 600; text-align: right; white-space: nowrap; }
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
      `}</style>

      <div className="ledger-header">
        <p className="ledger-eyebrow">{corridor === 'c1' ? 'Corridor 01 · United States → Uganda' : 'Corridor 02 · Uganda → United States'}</p>
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
          Uganda → US
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
                    <p className="row-cashout">\u2212{fmtUGX(r.cashOutFee)} to cash out</p>
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

          <p className="research-section-title">What arrives in the US</p>

          <div className="out-calc">
            <div className="amount-row" style={{ marginTop: '6px' }}>
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
            </div>

            <div className="method-row" style={{ marginTop: '12px', marginBottom: '10px' }}>
              <button className={'method-btn' + (funding === 'mobile' ? ' active' : '')} onClick={() => setFunding('mobile')}>
                From mobile money
              </button>
              <button className={'method-btn' + (funding === 'bank' ? ' active' : '')} onClick={() => setFunding('bank')}>
                From bank
              </button>
            </div>

            <p className="research-sub" style={{ margin: '0 0 10px' }}>
              {funding === 'mobile'
                ? 'Instant, but loading a wallet from MTN or Airtel carries a deposit fee — Chipper charges 2.5%, Eversend a flat 37,103 UGX plus 0.49%. Counters take cash, so they are unaffected.'
                : 'Chipper deposits from Absa or Stanbic are free but take 1\u20132 days. Eversend bank funding has not been verified yet.'}
            </p>

            <div className="preset-row" style={{ marginBottom: '14px' }}>
              {UGX_PRESETS.map(p => (
                <button
                  key={p}
                  className={'preset-btn' + (Number(outUGX) === p ? ' active' : '')}
                  onClick={() => setOutUGX(p)}
                >
                  {fmtUGXShort(p)}
                </button>
              ))}
            </div>

            {OUT_ROUTES
              .map(r => {
                const amt = Number(outUGX) || 0;
                const fn = funding === 'bank' ? r.fundBank : r.fundMobile;
                const unverified = fn === null;
                const fundFee = unverified ? 0 : fn(amt);
                const usd = Math.max(amt - fundFee, 0) / r.effRate;
                const lost = amt > 0 && midRate > 0 ? (1 - usd / (amt / midRate)) * 100 : 0;
                return { ...r, usd, lost, fundFee, unverified };
              })
              .sort((a, b) => (a.unverified === b.unverified ? b.usd - a.usd : a.unverified ? 1 : -1))
              .map((r, i) => (
                <div key={r.id} className={'out-row' + (i === 0 ? ' best' : '')}>
                  <div>
                    <p className="out-name">{r.name}</p>
                    <p className="out-note">{r.note}</p>
                  </div>
                  <span className={'out-kind k-' + r.kind}>{r.kind}</span>
                  <div>
                    {r.unverified ? (
                      <p className="out-lost" style={{ margin: 0 }}>not verified</p>
                    ) : (
                      <>
                        <p className="out-usd" style={{ margin: 0 }}>{fmtUSD(r.usd)}</p>
                        <p className="out-lost" style={{ margin: 0 }}>
                          {r.lost.toFixed(1)}% lost
                          {r.fundFee > 0 && <><br />{'\u2212'}{fmtUGX(r.fundFee)} to fund</>}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ))}

            <p className="research-sub" style={{ marginTop: '10px', marginBottom: 0 }}>
              Rates verified by hand in Kampala, July 2026 — fees and FX bundled into one effective rate,
              calibrated to real 2,000,000 UGX quotes. "% lost" is measured against today's live mid-market rate,
              so it moves as the shilling moves. Agent quotes vary by bureau. Confirm before you send.
            </p>
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
      <span style={{ fontFamily: "'Fraunces', serif", fontSize: '12px', fontWeight: 600 }}>{p.name}</span>
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
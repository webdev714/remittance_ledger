import { useState, useMemo } from 'react';

const TODAY = '2026-06-29';

const DEFAULT_PROVIDERS = [
  { id: 'wu',        name: 'Western Union',  flatFee: 0,    percentFee: 0,   fxMarkup: 2.9, cash: true,  bank: true,  mobile: false, speed: 'Minutes (cash) · 1–2 days (bank)', lastUpdated: '2026-06-22' },
  { id: 'mg',        name: 'MoneyGram',      flatFee: 0,    percentFee: 1.2, fxMarkup: 2.2, cash: true,  bank: true,  mobile: false, speed: 'Minutes (cash) · 1–3 days (bank)', lastUpdated: '2026-06-22' },
  { id: 'wise',      name: 'Wise',           flatFee: 17.74,percentFee: 0,   fxMarkup: 0,   cash: false, bank: true,  mobile: false, speed: '1–2 days', lastUpdated: '2026-06-22' },
  { id: 'remitly',   name: 'Remitly',        flatFee: 2.99, percentFee: 0,   fxMarkup: 2.3, cash: true,  bank: true,  mobile: true,  speed: 'Minutes (express) · 3–5 days (economy)', lastUpdated: '2026-06-22' },
  { id: 'worldrem',  name: 'WorldRemit',     flatFee: 1.99, percentFee: 0,   fxMarkup: 2.5, cash: true,  bank: true,  mobile: true,  speed: 'Minutes', lastUpdated: '2026-06-22' },
  { id: 'sendwave',  name: 'Sendwave',       flatFee: 0,    percentFee: 0,   fxMarkup: 1.5, cash: false, bank: false, mobile: true,  speed: 'Minutes · mobile money only', lastUpdated: '2026-06-22' },
  { id: 'lemfi',     name: 'LemFi',          flatFee: 0,    percentFee: 0,   fxMarkup: 1.0, cash: false, bank: true,  mobile: true,  speed: 'Minutes – hours', lastUpdated: '2026-06-22' },
  { id: 'nala',      name: 'NALA',           flatFee: 0.99, percentFee: 0,   fxMarkup: 1.5, cash: false, bank: true,  mobile: true,  speed: 'Minutes (mobile) · 4–5 hrs bank window', lastUpdated: '2026-06-22' },
];

const PRESETS = [50, 100, 200, 500, 1000];

function formatUpdated(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const METHODS = [
  { key: 'cash',   label: 'Cash pickup' },
  { key: 'bank',   label: 'Bank account' },
  { key: 'mobile', label: 'Mobile money' },
];

function fmtUSD(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUGX(n) {
  return Math.round(n).toLocaleString('en-US') + ' UGX';
}

export default function RemittanceLedger() {
  const [amount, setAmount] = useState(500);
  const [method, setMethod] = useState('mobile');
  const [midRate, setMidRate] = useState(3645);
  const [providers, setProviders] = useState(DEFAULT_PROVIDERS);
  const [editing, setEditing] = useState(false);

  const updateProvider = (id, field, value) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const rows = useMemo(() => {
    const amt = Number(amount) || 0;
    return providers
      .map(p => {
        const available = p[method];
        const totalFeeUSD = p.flatFee + amt * (p.percentFee / 100);
        const netUSD = Math.max(amt - totalFeeUSD, 0);
        const effectiveRate = midRate * (1 - p.fxMarkup / 100);
        const recipientUGX = netUSD * effectiveRate;
        const usdEquivalent = midRate > 0 ? recipientUGX / midRate : 0;
        const percentLost = amt > 0 ? ((amt - usdEquivalent) / amt) * 100 : 0;
        return { ...p, available, totalFeeUSD, recipientUGX, effectiveRate, percentLost };
      })
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return b.recipientUGX - a.recipientUGX;
      });
  }, [providers, amount, method, midRate]);

  const bestId = rows.find(r => r.available)?.id;

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
      `}</style>

      <div className="ledger-header">
        <p className="ledger-eyebrow">Corridor 01 · United States → Uganda</p>
        <h1 className="ledger-title">Remittance Ledger</h1>
        <p className="ledger-sub">Estimate what arrives, before you send</p>
      </div>

      <div className="ledger-body">
        <div className="amount-row">
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

        <div className="preset-row">
          {PRESETS.map(p => (
            <button
              key={p}
              className={'preset-btn' + (Number(amount) === p ? ' active' : '')}
              onClick={() => setAmount(p)}
            >
              ${p}
            </button>
          ))}
        </div>

        <div className="rate-line">
          Mid-market rate used: 1 USD =
          <input
            className="rate-input"
            type="number"
            value={midRate}
            onChange={e => setMidRate(Number(e.target.value) || 0)}
          />
          UGX
        </div>

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
                  fee {fmtUSD(r.totalFeeUSD)}<br />
                  {r.percentLost.toFixed(1)}% lost
                </span>
                <span className="row-amount">{fmtUGX(r.recipientUGX)}</span>
              </>
            ) : (
              <span className="unavailable-tag" style={{ gridColumn: '3 / span 2' }}>
                Not offered for {METHODS.find(m => m.key === method).label.toLowerCase()}
              </span>
            )}
            {r.id === bestId && r.available && <span className="stamp">Best today</span>}
          </div>
        ))}
      </div>

      <div className="footer">
        <button className="edit-toggle" onClick={() => setEditing(e => !e)}>
          {editing ? 'Hide rate assumptions' : 'Adjust rate assumptions'}
        </button>

        {editing && (
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
          Always confirm the final "recipient gets" number on the provider's own site or app
          before sending. Edit the assumptions above as you research real rates for your corridor
          and amount.
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
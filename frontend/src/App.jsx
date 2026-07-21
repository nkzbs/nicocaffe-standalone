import { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Coffee, LayoutDashboard, Users, UserCog, Package, ShoppingCart, Receipt,
  Wallet, Calculator, ClipboardList, Plus, X, Check, AlertTriangle, LogOut,
  Pencil, Trash2, TrendingUp, RotateCcw,
} from 'lucide-react';
import { api, getToken, setToken, clearToken } from './api';

const IVA_RATE = 0.22;

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
function formatEUR(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT');
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function cn(...args) {
  return args.filter(Boolean).join(' ');
}
function monthLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
}

const PIANO_CONTI = [
  { codice: '1001', nome: 'Cassa', tipo: 'attivo' },
  { codice: '1002', nome: 'Banca c/c', tipo: 'attivo' },
  { codice: '1100', nome: 'Clienti', tipo: 'attivo' },
  { codice: '1200', nome: 'Magazzino caffè', tipo: 'attivo' },
  { codice: '1250', nome: 'Fondo ammortamento attrezzature', tipo: 'attivo' },
  { codice: '1500', nome: 'IVA a credito', tipo: 'attivo' },
  { codice: '2100', nome: 'Fornitori', tipo: 'passivo' },
  { codice: '2500', nome: 'IVA a debito', tipo: 'passivo' },
  { codice: '2600', nome: 'Debiti v/agenti per provvigioni', tipo: 'passivo' },
  { codice: '3000', nome: 'Capitale sociale', tipo: 'patrimonio' },
  { codice: '4000', nome: 'Ricavi vendite fatturate', tipo: 'ricavo' },
  { codice: '4100', nome: 'Ricavi da corrispettivi', tipo: 'ricavo' },
  { codice: '5000', nome: 'Acquisti materie prime', tipo: 'costo' },
  { codice: '5200', nome: 'Costi provvigioni agenti', tipo: 'costo' },
  { codice: '5400', nome: 'Spese generali e utenze', tipo: 'costo' },
  { codice: '5600', nome: 'Affitto stabilimento', tipo: 'costo' },
  { codice: '5700', nome: 'Costi flotta e trasporto', tipo: 'costo' },
  { codice: '5800', nome: 'Interventi tecnici comodati', tipo: 'costo' },
  { codice: '5900', nome: 'Ammortamenti', tipo: 'costo' },
];

const CENTRI_COSTO_MAP = {
  '5000': 'Produzione',
  '5200': 'Vendite & Agenti',
  '5400': 'Amministrazione',
  '5600': 'Amministrazione',
  '5700': 'Flotta & Logistica',
  '5800': 'Comodati & Assistenza',
  '5900': 'Ammortamenti',
};

function residuoFattura(db, fattura) {
  const note = (db.noteCredito || []).filter(n => n.fatturaId === fattura.id);
  return Math.round((fattura.totale - note.reduce((s, n) => s + n.importo, 0)) * 100) / 100;
}

function esposizioneCliente(db, clienteId) {
  const fattureAperte = db.fatture.filter(f => f.clienteId === clienteId && f.stato !== 'pagata')
    .reduce((s, f) => s + residuoFattura(db, f), 0);
  const ordiniNonFatturati = db.ordini.filter(o => o.clienteId === clienteId && o.stato === 'confermato')
    .reduce((s, o) => s + o.righe.reduce((s2, r) => s2 + r.quantita * r.prezzoUnitario, 0), 0);
  return Math.round((fattureAperte + ordiniNonFatturati) * 100) / 100;
}

function prezzoUnitarioScontato(prodotto, cliente, quantita, listini) {
  if (cliente && cliente.listinoId && listini) {
    const listino = listini.find(l => l.id === cliente.listinoId);
    if (listino) {
      const riga = listino.righe.find(r => r.prodottoId === prodotto.id);
      if (riga) return Math.round(riga.prezzo * 100) / 100;
    }
  }
  let prezzo = prodotto.prezzo;
  const tiers = (prodotto.scontiQuantita || []).filter(t => quantita >= t.soglia).sort((a, b) => b.soglia - a.soglia);
  const scontoQta = tiers.length ? tiers[0].sconto : 0;
  const scontoCliente = cliente ? (cliente.scontoPercent || 0) : 0;
  prezzo = prezzo * (1 - scontoQta / 100) * (1 - scontoCliente / 100);
  return Math.round(prezzo * 100) / 100;
}

function calcolaLiquidazioneIva(movimenti, dataInizio, dataFine) {
  let debito = 0, credito = 0;
  movimenti.forEach(m => {
    if (m.data < dataInizio || m.data > dataFine) return;
    m.righe.forEach(r => {
      if (r.conto === '2500') debito += (r.avere || 0) - (r.dare || 0);
      if (r.conto === '1500') credito += (r.dare || 0) - (r.avere || 0);
    });
  });
  debito = Math.round(debito * 100) / 100; credito = Math.round(credito * 100) / 100;
  return { debito, credito, saldo: Math.round((debito - credito) * 100) / 100 };
}

function calcoloProvvigioneAgente(agente, fatturato) {
  const scaglioni = [...(agente.scaglioni || [{ soglia: 0, perc: 0 }])].sort((a, b) => b.soglia - a.soglia);
  const scaglione = scaglioni.find(s => fatturato >= s.soglia) || scaglioni[scaglioni.length - 1];
  const perc = scaglione ? scaglione.perc : 0;
  const base = Math.round(fatturato * perc / 100 * 100) / 100;
  const targetRaggiunto = agente.target ? fatturato >= agente.target : false;
  const bonus = targetRaggiunto ? (agente.bonusTarget || 0) : 0;
  return { perc, base, bonus, targetRaggiunto, totale: Math.round((base + bonus) * 100) / 100 };
}

const GIORNI_SOGLIA_INSOLUTO = 30;

function fatturaEIdoneaAdInsoluto(fattura, oggi) {
  if (fattura.stato === 'pagata') return false;
  if (!fattura.scadenza) return false;
  const giorni = Math.floor((new Date(oggi) - new Date(fattura.scadenza)) / 86400000);
  return giorni >= GIORNI_SOGLIA_INSOLUTO;
}

function costiTotaliFurgone(db, furgoneId) {
  return (db.costiMezzo || []).filter(c => c.furgoneId === furgoneId).reduce((s, c) => s + c.importo, 0);
}

const DURATA_AMMORTAMENTO_ANNI = 5;

function ammortamentoMensileTotale(db) {
  const attrezzature = (db.attrezzature || []);
  const totaleAnnuo = attrezzature.reduce((s, a) => s + (a.costo || 0) / DURATA_AMMORTAMENTO_ANNI, 0);
  return Math.round((totaleAnnuo / 12) * 100) / 100;
}

function saldoConto(movimenti, codice) {
  let dare = 0, avere = 0;
  movimenti.forEach(m => m.righe.forEach(r => {
    if (r.conto === codice) { dare += r.dare || 0; avere += r.avere || 0; }
  }));
  return { dare, avere };
}

function calcolaCentriCosto(movimenti) {
  const buckets = {};
  movimenti.forEach(m => m.righe.forEach(r => {
    const centro = CENTRI_COSTO_MAP[r.conto];
    if (!centro) return;
    buckets[centro] = (buckets[centro] || 0) + (r.dare || 0) - (r.avere || 0);
  }));
  const rows = Object.entries(buckets).map(([centro, importo]) => ({ centro, importo: Math.round(importo * 100) / 100 })).sort((a,b) => b.importo - a.importo);
  const totale = rows.reduce((s, r) => s + r.importo, 0);
  return { rows, totale };
}

function calcolaContoEconomico(movimenti) {
  const ricavi = PIANO_CONTI.filter(c => c.tipo === 'ricavo').map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    return { ...c, importo: avere - dare };
  });
  const costi = PIANO_CONTI.filter(c => c.tipo === 'costo').map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    return { ...c, importo: dare - avere };
  });
  const totRicavi = ricavi.reduce((s, r) => s + r.importo, 0);
  const totCosti = costi.reduce((s, r) => s + r.importo, 0);
  return { ricavi, costi, totRicavi, totCosti, utile: totRicavi - totCosti };
}

function calcolaEBITDA(db) {
  const ce = calcolaContoEconomico(db.movimenti);
  const { dare: ammDare, avere: ammAvere } = saldoConto(db.movimenti, '5900');
  const ammortamenti = Math.round((ammDare - ammAvere) * 100) / 100;
  const ebitda = Math.round((ce.utile + ammortamenti) * 100) / 100;
  const margine = ce.totRicavi > 0 ? Math.round(ebitda / ce.totRicavi * 1000) / 10 : 0;
  return { utileNetto: ce.utile, ammortamenti, ebitda, ricavi: ce.totRicavi, margine };
}

function calcolaBilancioVerifica(movimenti) {
  return PIANO_CONTI.map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    const saldo = dare - avere;
    return { ...c, dare, avere, saldo, lato: saldo >= 0 ? 'dare' : 'avere' };
  });
}

function calcolaStatoPatrimoniale(movimenti) {
  const { utile } = calcolaContoEconomico(movimenti);
  const attivo = PIANO_CONTI.filter(c => c.tipo === 'attivo').map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    return { ...c, importo: dare - avere };
  });
  const passivo = PIANO_CONTI.filter(c => c.tipo === 'passivo').map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    return { ...c, importo: avere - dare };
  });
  const patrimonio = PIANO_CONTI.filter(c => c.tipo === 'patrimonio').map(c => {
    const { dare, avere } = saldoConto(movimenti, c.codice);
    return { ...c, importo: avere - dare };
  });
  const totAttivo = attivo.reduce((s, r) => s + r.importo, 0);
  const totPassivo = passivo.reduce((s, r) => s + r.importo, 0);
  const totPatrimonio = patrimonio.reduce((s, r) => s + r.importo, 0) + utile;
  return {
    attivo, passivo, patrimonio, totAttivo, totPassivo, totPatrimonio, utile,
    pareggio: Math.abs(totAttivo - (totPassivo + totPatrimonio)) < 0.01,
  };
}

function RoastBar({ className }) {
  return (
    <div className={cn('h-1 w-full rounded-full', className)}
      style={{ background: 'linear-gradient(90deg,#FDF6E9 0%,#D9B68C 35%,#C2622F 70%,#241208 100%)' }} />
  );
}

function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="mb-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          {eyebrow && <p className="font-mono-num text-xs uppercase tracking-widest text-orange-700 mb-1">{eyebrow}</p>}
          <h1 className="font-display text-2xl text-stone-900">{title}</h1>
        </div>
        {action}
      </div>
      <RoastBar className="mt-3 w-40" />
    </div>
  );
}

function Card({ className, children }) {
  return <div className={cn('rounded-xl border border-amber-200 bg-white p-5', className)}>{children}</div>;
}

function Button({ children, variant = 'primary', size = 'md', className, ...props }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-sm';
  const variants = {
    primary: 'bg-orange-700 text-white hover:bg-orange-800',
    ghost: 'bg-transparent text-stone-500 hover:bg-amber-100',
    danger: 'bg-transparent text-red-700 hover:bg-red-50',
    dark: 'bg-stone-900 text-white hover:bg-stone-800',
  };
  return <button className={cn(base, sizes, variants[variant], className)} {...props}>{children}</button>;
}

function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-amber-100 text-stone-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-50 text-red-700',
    info: 'bg-violet-50 text-violet-700',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

function StatCard({ icon: Icon, label, value, sub, tone = 'default' }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-orange-700 font-mono-num">{label}</span>
        <Icon size={16} className="text-orange-700" />
      </div>
      <div className="font-display text-2xl text-stone-900">{value}</div>
      {sub && <div className={cn('text-xs', tone === 'danger' ? 'text-red-700' : 'text-stone-400')}>{sub}</div>}
    </Card>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-xl border border-dashed border-stone-300 py-10 text-center text-sm text-stone-400">{text}</div>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(28,25,23,0.5)' }} onClick={onClose}>
      <div className={cn('w-full rounded-xl bg-amber-50 p-6 shadow-xl overflow-y-auto', wide ? 'max-w-2xl' : 'max-w-md')} style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-900"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ text, onConfirm, onClose }) {
  return (
    <Modal title="Conferma" onClose={onClose}>
      <p className="text-sm text-stone-500 mb-5">{text}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
        <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>Conferma</Button>
      </div>
    </Modal>
  );
}

function FormModal({ title, fields, initial, onSave, onClose, saving }) {
  const [values, setValues] = useState(initial || {});
  function set(name, val) { setValues(v => ({ ...v, [name]: val })); }
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(f => (
          <div key={f.name} className={f.full ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-medium text-stone-500 mb-1">{f.label}</label>
            {f.type === 'select' ? (
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600"
                value={values[f.name] ?? ''} onChange={e => set(f.name, e.target.value)}>
                <option value="">Seleziona…</option>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type || 'text'} step={f.type === 'number' ? '0.01' : undefined}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600"
                value={values[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
        <Button onClick={() => onSave(values)} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
      </div>
    </Modal>
  );
}

function DataTable({ columns, rows, keyField = 'id', actions, empty }) {
  if (!rows.length) return <EmptyState text={empty || 'Nessun dato presente.'} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-stone-400">
            {columns.map(c => <th key={c.key} className={cn('px-4 py-3 font-medium whitespace-nowrap', c.align === 'right' && 'text-right')}>{c.label}</th>)}
            {actions && <th className="px-4 py-3"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r[keyField]} className="border-b border-amber-100 last:border-0 hover:bg-amber-50">
              {columns.map(c => (
                <td key={c.key} className={cn('px-4 py-3', c.mono && 'font-mono-num', c.align === 'right' && 'text-right')}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
              {actions && <td className="px-4 py-3 text-right whitespace-nowrap">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppShell({ brandSub, navGroups, activeId, setActive, onLogout, onReload, footerNote, eyebrow, title, children }) {
  const flatItems = navGroups.flatMap(g => g.items);
  return (
    <div className="min-h-screen bg-amber-50 flex flex-col md:flex-row">
      <aside className="hidden md:flex md:w-64 md:shrink-0 bg-stone-900 text-amber-50 flex-col">
        <div className="px-5 py-6">
          <div className="flex items-center gap-2"><Coffee size={20} className="text-orange-400" /><span className="font-display text-lg">Nico Caffè</span></div>
          <p className="text-xs text-stone-400 mt-0.5">{brandSub}</p>
          <RoastBar className="mt-4 h-1" />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 space-y-6">
          {navGroups.map(group => (
            <div key={group.section || 'main'}>
              {group.section && <p className="px-3 text-xs uppercase tracking-widest text-stone-500 mb-1">{group.section}</p>}
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button key={item.id} onClick={() => setActive(item.id)}
                    className={cn('w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                      activeId === item.id ? 'bg-orange-700 text-white' : 'text-stone-300 hover:bg-stone-800 hover:text-white')}>
                    <item.icon size={16} />{item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-stone-800 space-y-1">
          {onReload && (
            <button onClick={onReload} className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-white">
              <RotateCcw size={16} /> Ricarica dati dal server
            </button>
          )}
          <button onClick={onLogout} className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-white">
            <LogOut size={16} /> Esci
          </button>
          {footerNote && <p className="px-3 mt-3 text-xs text-stone-500">{footerNote}</p>}
        </div>
      </aside>

      <header className="md:hidden bg-stone-900 text-amber-50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2"><Coffee size={18} className="text-orange-400" /><span className="font-display">Nico Caffè</span></div>
          <button onClick={onLogout} className="text-stone-300"><LogOut size={16} /></button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-3">
          {flatItems.map(item => (
            <button key={item.id} onClick={() => setActive(item.id)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs',
                activeId === item.id ? 'bg-orange-700 text-white' : 'bg-stone-800 text-stone-300')}>
              <item.icon size={13} />{item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 p-5 md:p-8 overflow-y-auto">
        <SectionHeader eyebrow={eyebrow} title={title} />
        {children}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin, loginError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    if (busy || !email || !password) return;
    setBusy(true);
    await onLogin(email.trim(), password);
    setBusy(false);
  }

  const inputCls = "w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600";

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 text-amber-50 mb-2">
            <Coffee size={28} className="text-orange-400" /><span className="font-display text-2xl">Nico Caffè</span>
          </div>
          <p className="text-stone-400 text-sm">Gestionale torrefazione</p>
          <div className="flex justify-center mt-4"><RoastBar className="w-40 h-1.5" /></div>
        </div>
        <Card>
          <h3 className="font-display text-lg text-stone-900 mb-4">Accedi</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Email</label>
              <input type="email" placeholder="nome@nicocaffe.it" className={inputCls} value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleLogin()} /></div>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Password</label>
              <div className="relative">
                <input type={showPwd?'text':'password'} className={cn(inputCls,'pr-16')} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleLogin()} />
                <button type="button" onClick={()=>setShowPwd(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 text-xs">{showPwd?'Nascondi':'Mostra'}</button>
              </div>
            </div>
            {loginError && <p className="text-sm text-red-700">{loginError}</p>}
            <Button className="w-full justify-center" onClick={handleLogin} disabled={busy}>{busy ? 'Accesso…' : 'Accedi'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function PDFModal({ html, onClose, narrow }) {
  const fullHTML = narrow ? `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Nico Caffè — Bolla</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e7e5e4}
body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1917;display:flex;justify-content:center;padding:16px 0}
.receipt{width:80mm;max-width:302px;background:#fff;padding:12px 10px;box-shadow:0 1px 6px rgba(0,0,0,0.15)}
.b-divider{border-top:1px dashed #a8a29e;margin:6px 0}
.print-btn{background:#C2622F;color:#fff;border:none;padding:10px 28px;border-radius:6px;font-size:13px;cursor:pointer;display:block;margin:16px auto 0;font-family:inherit}
.print-btn:hover{background:#a0522d}
@page{size:80mm auto;margin:0}
@media print{.print-btn{display:none!important}html,body{background:#fff}.receipt{width:80mm;max-width:none;box-shadow:none;padding:4mm}}
</style></head><body>
<div class="receipt">${html}</div>
<button class="print-btn" onclick="window.print()">🖨&nbsp; Stampa scontrino 80mm</button>
</body></html>` : `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Nico Caffè</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#1c1917;background:#fff;padding:32px 40px}
.logo{font-size:22px;font-weight:700;color:#C2622F;letter-spacing:-0.5px}
.sub{font-size:10px;color:#78716c;margin-top:2px;line-height:1.5}
.divider{border:none;border-top:2px solid #C2622F;margin:16px 0}
.thin{border:none;border-top:1px solid #e7e5e4;margin:10px 0}
.row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.col{flex:1}
h2{font-size:20px;font-weight:700;margin-bottom:4px}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:600;background:#FDF6E9;color:#92400e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#78716c;padding:7px 8px;border-bottom:2px solid #e7e5e4}
td{padding:8px;border-bottom:1px solid #f5f5f4;vertical-align:top}
tr:last-child td{border-bottom:none}
.right{text-align:right}
.total-row td{font-weight:700;font-size:13px;border-top:2px solid #C2622F;padding-top:10px}
.footer{margin-top:36px;font-size:9px;color:#a8a29e;text-align:center;padding-top:12px;border-top:1px solid #e7e5e4}
.label{font-size:10px;color:#78716c;margin-bottom:2px;margin-top:6px}
.value{font-size:12px;color:#1c1917;font-weight:500}
.print-btn{background:#C2622F;color:#fff;border:none;padding:10px 28px;border-radius:6px;font-size:13px;cursor:pointer;display:block;margin:24px auto 0;font-family:inherit}
.print-btn:hover{background:#a0522d}
@media print{.print-btn{display:none!important}body{padding:20px}}
</style></head><body>
${html}
<div class="footer">Nico Caffè Torrefazione · Via del Caffè 1, 80100 Napoli · P.IVA 01234560000<br>Documento generato il ${new Date().toLocaleDateString('it-IT')}</div>
<button class="print-btn" onclick="window.print()">🖨&nbsp; Stampa / Salva PDF</button>
</body></html>`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className={cn('w-full bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col', narrow ? 'max-w-sm' : 'max-w-3xl')} style={{ maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 bg-stone-900 text-amber-50">
          <span className="font-display text-sm">{narrow ? 'Anteprima bolla 80mm' : 'Anteprima documento'}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-white"><X size={18} /></button>
        </div>
        <iframe srcDoc={fullHTML} className="flex-1 w-full border-0" style={{ minHeight: narrow ? 480 : 520 }} title="Documento PDF" />
      </div>
    </div>
  );
}

function calcolaRigheIvaVisuali(fattura, db) {
  if (fattura.righeIva) return fattura.righeIva;
  const gruppi = {};
  (fattura.righe || []).forEach(r => {
    const p = db.prodotti.find(x => x.id === r.prodottoId);
    const aliquota = p ? p.aliquotaIva : 22;
    const imp = r.quantita * r.prezzoUnitario;
    gruppi[aliquota] = (gruppi[aliquota] || 0) + imp;
  });
  return Object.entries(gruppi).map(([aliquota, imp]) => ({
    aliquota: Number(aliquota), imponibile: Math.round(imp * 100) / 100, iva: Math.round(imp * Number(aliquota) / 100 * 100) / 100,
  }));
}

function buildFatturaHTML(fattura, db) {
  const cliente = db.clienti.find(c => c.id === fattura.clienteId) || {};
  const agente = db.agenti.find(a => a.id === fattura.agenteId);
  const righeIva = calcolaRigheIvaVisuali(fattura, db);
  const rigaHTML = (r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId) || {};
    const tot = (r.quantita * r.prezzoUnitario).toFixed(2);
    return `<tr><td>${p.nome || r.prodottoId}<br><span style="font-size:10px;color:#78716c">${p.formato||''}</span></td><td class="right">${r.quantita}</td><td class="right">€ ${r.prezzoUnitario.toFixed(2)}</td><td class="right">€ ${tot}</td></tr>`;
  };
  const righeIvaHTML = righeIva.map(r =>
    `<tr><td>IVA ${r.aliquota}%</td><td class="right">€ ${r.imponibile.toFixed(2)}</td><td class="right">€ ${r.iva.toFixed(2)}</td><td></td></tr>`
  ).join('');
  return `
  <div class="row" style="margin-bottom:24px">
    <div><div class="logo">☕ Nico Caffè</div><div class="sub">Torrefazione artigianale<br>Via del Caffè 1 — 80100 Napoli<br>P.IVA 01234560000</div></div>
    <div style="text-align:right"><h2>FATTURA</h2><div class="badge">${fattura.numero}</div><br><div class="label">Data emissione</div><div class="value">${new Date(fattura.data).toLocaleDateString('it-IT')}</div><div class="label" style="margin-top:6px">Scadenza</div><div class="value">${fattura.scadenza ? new Date(fattura.scadenza).toLocaleDateString('it-IT') : '—'}</div></div>
  </div>
  <hr class="divider">
  <div class="row" style="margin-bottom:20px">
    <div><div class="label">Cliente</div><div class="value" style="font-weight:600">${cliente.ragioneSociale||'—'}</div><div class="value">${cliente.indirizzo||''}</div><div class="value">${cliente.citta||''}</div><div class="label" style="margin-top:6px">P.IVA</div><div class="value">${cliente.piva||'—'}</div></div>
    ${agente ? `<div><div class="label">Agente di riferimento</div><div class="value">${agente.nome} ${agente.cognome}</div><div class="value">${agente.zona||''}</div></div>` : ''}
  </div>
  <table><thead><tr><th>Descrizione</th><th class="right">Qty</th><th class="right">Prezzo unit.</th><th class="right">Importo</th></tr></thead>
  <tbody>${fattura.righe.map(rigaHTML).join('')}</tbody></table>
  <hr class="thin" style="margin-top:24px">
  <table style="margin-top:0;width:340px;margin-left:auto"><tbody>
    <tr><td>Imponibile</td><td class="right">€ ${fattura.imponibile.toFixed(2)}</td></tr>
    ${righeIvaHTML}
    <tr class="total-row"><td>Totale fattura</td><td class="right">€ ${fattura.totale.toFixed(2)}</td></tr>
  </tbody></table>
  <hr class="thin" style="margin-top:24px">
  <div class="label">Condizioni di pagamento</div><div class="value">${cliente.pagamento||'—'}</div>`;
}

function buildOrdineHTML(ordine, db) {
  const cliente = db.clienti.find(c => c.id === ordine.clienteId) || {};
  const agente = db.agenti.find(a => a.id === ordine.agenteId);
  const totale = ordine.righe.reduce((s, r) => s + r.quantita * r.prezzoUnitario, 0);
  const rigaHTML = (r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId) || {};
    return `<tr><td>${p.nome||r.prodottoId}<br><span style="font-size:10px;color:#78716c">${p.formato||''}</span></td><td class="right">${r.quantita}</td><td class="right">€ ${r.prezzoUnitario.toFixed(2)}</td><td class="right">€ ${(r.quantita*r.prezzoUnitario).toFixed(2)}</td></tr>`;
  };
  return `
  <div class="row" style="margin-bottom:24px">
    <div><div class="logo">☕ Nico Caffè</div><div class="sub">Torrefazione artigianale<br>Via del Caffè 1 — 80100 Napoli</div></div>
    <div style="text-align:right"><h2>CONFERMA ORDINE</h2><div class="badge">${ordine.id}</div><br><div class="label">Data</div><div class="value">${new Date(ordine.data).toLocaleDateString('it-IT')}</div></div>
  </div>
  <hr class="divider">
  <div class="row" style="margin-bottom:20px">
    <div><div class="label">Cliente</div><div class="value" style="font-weight:600">${cliente.ragioneSociale||'—'}</div><div class="value">${cliente.citta||''}</div></div>
    ${agente ? `<div><div class="label">Agente</div><div class="value">${agente.nome} ${agente.cognome}</div></div>` : ''}
  </div>
  <table><thead><tr><th>Prodotto</th><th class="right">Qty</th><th class="right">Prezzo</th><th class="right">Totale</th></tr></thead>
  <tbody>${ordine.righe.map(rigaHTML).join('')}</tbody></table>
  <hr class="thin" style="margin-top:24px">
  <table style="width:260px;margin-left:auto;margin-top:0"><tbody>
    <tr class="total-row"><td>Totale imponibile</td><td class="right">€ ${totale.toFixed(2)}</td></tr>
  </tbody></table>
  <div style="margin-top:20px;padding:12px;background:#FDF6E9;border-radius:6px;font-size:11px;color:#78716c">
    Questo documento è una conferma d'ordine. La fattura verrà emessa dall'amministrazione.
  </div>`;
}

function buildBollaHTML(ordine, db) {
  const cliente = db.clienti.find(c => c.id === ordine.clienteId) || {};
  const agente = db.agenti.find(a => a.id === ordine.agenteId);
  const totale = ordine.righe.reduce((s, r) => s + r.quantita * r.prezzoUnitario, 0);
  const rigaHTML = (r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId) || {};
    return `<div class="riga"><div class="riga-nome">${p.nome || r.prodottoId}</div><div class="riga-dett"><span>${p.formato||''}</span><span>x${r.quantita}</span></div></div>`;
  };
  return `
  <div style="text-align:center;margin-bottom:8px">
    <div style="font-size:16px;font-weight:700;letter-spacing:0.5px">☕ NICO CAFFÈ</div>
    <div style="font-size:9px;color:#57534e">Torrefazione artigianale</div>
  </div>
  <div class="b-divider"></div>
  <div style="font-size:11px;font-weight:700;text-align:center;margin:4px 0">BOLLA DI CONSEGNA</div>
  <div style="font-size:9px;text-align:center;margin-bottom:6px">${ordine.id} — ${new Date(ordine.data).toLocaleDateString('it-IT')}</div>
  <div class="b-divider"></div>
  <div style="font-size:10px;margin:6px 0">
    <div style="font-weight:700">${cliente.ragioneSociale || '—'}</div>
    <div>${cliente.indirizzo || ''}</div>
    <div>${cliente.citta || ''}</div>
    ${agente ? `<div style="margin-top:2px;color:#57534e">Agente: ${agente.nome} ${agente.cognome}</div>` : ''}
  </div>
  <div class="b-divider"></div>
  <div style="margin:6px 0">${ordine.righe.map(rigaHTML).join('')}</div>
  <div class="b-divider"></div>
  <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin:6px 0">
    <span>TOTALE</span><span>€ ${totale.toFixed(2)}</span>
  </div>
  <div class="b-divider"></div>
  <div style="margin-top:16px;font-size:9px">
    <div>Firma per ricevuta merce:</div>
    <div style="border-bottom:1px solid #78716c;margin-top:18px"></div>
  </div>
  <div style="text-align:center;font-size:8px;color:#a8a29e;margin-top:10px">Nico Caffè · Via del Caffè 1, Napoli</div>`;
}

function buildCorrispettivoHTML(corrispettivo, db) {
  const cliente = corrispettivo.clienteId ? db.clienti.find(c => c.id === corrispettivo.clienteId) : null;
  const nomeCliente = cliente ? cliente.ragioneSociale : (corrispettivo.clienteOccasionale || 'Cliente al banco');
  const rigaHTML = (r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId) || {};
    return `<tr><td>${p.nome || r.prodottoId}<br><span style="font-size:10px;color:#78716c">${p.formato||''}</span></td><td class="right">${r.quantita}</td><td class="right">€ ${r.prezzoUnitario.toFixed(2)}</td><td class="right">€ ${(r.quantita*r.prezzoUnitario).toFixed(2)}</td></tr>`;
  };
  return `
  <div class="row" style="margin-bottom:24px">
    <div><div class="logo">☕ Nico Caffè</div><div class="sub">Torrefazione artigianale<br>Via del Caffè 1 — 80100 Napoli<br>P.IVA 01234560000</div></div>
    <div style="text-align:right"><h2>CORRISPETTIVO</h2><div class="badge">${corrispettivo.numero || corrispettivo.id}</div><br><div class="label">Data</div><div class="value">${new Date(corrispettivo.data).toLocaleDateString('it-IT')}</div></div>
  </div>
  <hr class="divider">
  <div class="row" style="margin-bottom:20px">
    <div><div class="label">Cliente</div><div class="value" style="font-weight:600">${nomeCliente}</div></div>
    <div><div class="label">Incassato con</div><div class="value">${corrispettivo.contoIncasso === '1001' ? 'Cassa' : 'Banca'}</div></div>
  </div>
  <table><thead><tr><th>Descrizione</th><th class="right">Qty</th><th class="right">Prezzo unit.</th><th class="right">Importo</th></tr></thead>
  <tbody>${corrispettivo.righe.map(rigaHTML).join('')}</tbody></table>
  <hr class="thin" style="margin-top:24px">
  <table style="margin-top:0;width:340px;margin-left:auto"><tbody>
    <tr class="total-row"><td>Totale corrispettivo</td><td class="right">€ ${corrispettivo.totale.toFixed(2)}</td></tr>
  </tbody></table>
  <div style="margin-top:20px;padding:12px;background:#FDF6E9;border-radius:6px;font-size:11px;color:#78716c">
    Documento commerciale di vendita — incasso immediato.
  </div>`;
}

function ListiniView({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  function nuovoListino() {
    setEditing({ id: null, nome: '', descrizione: '', righe: db.prodotti.map(p => ({ prodottoId: p.id, prezzo: p.prezzo, attivo: false })) });
  }
  function modificaListino(l) {
    const righeComplete = db.prodotti.map(p => {
      const existing = l.righe.find(r => r.prodottoId === p.id);
      return { prodottoId: p.id, prezzo: existing ? existing.prezzo : p.prezzo, attivo: !!existing };
    });
    setEditing({ ...l, righe: righeComplete });
  }
  async function salva() {
    const righeAttive = editing.righe.filter(r => r.attivo).map(r => ({ prodottoId: r.prodottoId, prezzo: parseFloat(r.prezzo) || 0 }));
    setSaving(true);
    try {
      if (editing.id) await api.listini.update(editing.id, { nome: editing.nome, descrizione: editing.descrizione, righe: righeAttive });
      else await api.listini.create({ nome: editing.nome, descrizione: editing.descrizione, righe: righeAttive });
      const listini = await api.listini.list();
      setDb(d => ({ ...d, listini }));
      setEditing(null);
    } catch (e) {
      alert('Errore salvataggio listino: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  function updateRiga(idx, patch) {
    setEditing(e => ({ ...e, righe: e.righe.map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  }
  async function elimina(l) {
    try {
      await api.listini.remove(l.id);
      const listini = await api.listini.list();
      setDb(d => ({ ...d, listini }));
    } catch (e) {
      alert('Errore eliminazione: ' + e.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button onClick={nuovoListino}><Plus size={15} /> Nuovo listino</Button></div>
      <DataTable
        columns={[
          { key: 'nome', label: 'Nome listino', render: r => <div><div className="font-medium">{r.nome}</div><div className="text-xs text-stone-400">{r.descrizione}</div></div> },
          { key: 'prodotti', label: 'Prodotti con prezzo personalizzato', align: 'right', render: r => (r.righe||[]).length },
        ]}
        rows={db.listini || []}
        actions={r => (
          <div className="flex gap-1">
            <button onClick={() => modificaListino(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={15} /></button>
            <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
          </div>
        )}
        empty="Nessun listino personalizzato."
      />
      {toDelete && <ConfirmDialog text={`Eliminare il listino "${toDelete.nome}"?`} onClose={() => setToDelete(null)} onConfirm={() => elimina(toDelete)} />}
      {editing && (
        <Modal title={editing.id ? `Modifica listino` : 'Nuovo listino'} onClose={() => setEditing(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-stone-500 mb-1">Nome listino</label>
                <input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={editing.nome} onChange={e => setEditing(v => ({ ...v, nome: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-stone-500 mb-1">Descrizione</label>
                <input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={editing.descrizione} onChange={e => setEditing(v => ({ ...v, descrizione: e.target.value }))} /></div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-stone-400 text-left border-b border-amber-200">
                  <th className="py-2 pr-3 font-medium">Prodotto</th>
                  <th className="py-2 px-2 font-medium text-right">Listino base</th>
                  <th className="py-2 px-2 font-medium text-right">Prezzo personalizzato</th>
                  <th className="py-2 pl-2 font-medium text-center">Attivo</th>
                </tr></thead>
                <tbody>
                  {editing.righe.map((r, idx) => {
                    const p = db.prodotti.find(x => x.id === r.prodottoId);
                    if (!p) return null;
                    return (
                      <tr key={r.prodottoId} className={cn('border-b border-amber-50', r.attivo ? 'bg-orange-50' : '')}>
                        <td className="py-2 pr-3"><div className="font-medium text-stone-800">{p.nome}</div><div className="text-xs text-stone-400">{p.formato}</div></td>
                        <td className="py-2 px-2 text-right font-mono-num text-stone-400">{formatEUR(p.prezzo)}</td>
                        <td className="py-2 px-2">
                          <input type="number" step="0.01" disabled={!r.attivo}
                            className={cn('w-24 rounded border px-2 py-1 text-sm text-right font-mono-num', r.attivo ? 'border-orange-300 bg-white' : 'border-stone-200 bg-stone-50 text-stone-400')}
                            value={r.prezzo} onChange={e => updateRiga(idx, { prezzo: e.target.value })} />
                        </td>
                        <td className="py-2 pl-2 text-center">
                          <input type="checkbox" className="accent-orange-600" checked={!!r.attivo} onChange={e => updateRiga(idx, { attivo: e.target.checked })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button>
              <Button onClick={salva} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva listino'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminDashboard({ db, goTo }) {
  const oggi = todayISO();
  const fatturatoTotale = db.fatture.reduce((s, f) => s + f.imponibile, 0);
  const ce = useMemo(() => calcolaContoEconomico(db.movimenti), [db.movimenti]);
  const fattureScadute = db.fatture.filter(f => f.stato !== 'pagata' && f.scadenza && f.scadenza < oggi);
  const fattureDaPagare = db.fatture.filter(f => f.stato !== 'pagata');
  const sottoScorta = db.prodotti.filter(p => p.scorta < p.scortaMinima);
  const ordiniDaFatturare = db.ordini.filter(o => o.stato === 'confermato');
  const liqMese = useMemo(() => calcolaLiquidazioneIva(db.movimenti, todayISO().slice(0,7)+'-01', oggi), [db.movimenti]);
  const fidoAlert = db.clienti.filter(c => esposizioneCliente(db, c.id) > c.fido * 0.8);
  const insolutiAperti = (db.insoluti||[]).filter(i => !i.risolto);

  const chartData = useMemo(() => {
    const map = {};
    db.fatture.forEach(f => { const key = f.data.slice(0, 7); map[key] = (map[key] || 0) + f.imponibile; });
    return Object.keys(map).sort().map(k => ({ mese: monthLabel(k + '-01'), valore: Math.round(map[k]) }));
  }, [db.fatture]);

  const topClienti = useMemo(() => {
    const map = {};
    db.fatture.forEach(f => { map[f.clienteId] = (map[f.clienteId] || 0) + f.imponibile; });
    return Object.entries(map)
      .map(([id, val]) => ({ cliente: db.clienti.find(c => c.id === id)?.ragioneSociale || id, val }))
      .sort((a, b) => b.val - a.val).slice(0, 5);
  }, [db.fatture, db.clienti]);
  const maxTop = Math.max(1, ...topClienti.map(t => t.val));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Fatturato totale" value={formatEUR(fatturatoTotale)} />
        <StatCard icon={Calculator} label="Utile netto" value={formatEUR(ce.utile)} />
        <StatCard icon={AlertTriangle} label="Fatture scadute" value={fattureScadute.length}
          tone={fattureScadute.length ? 'danger' : 'default'}
          sub={fattureScadute.length ? formatEUR(fattureScadute.reduce((s,f)=>s+f.totale,0))+' da incassare' : 'Nessuna'} />
        <StatCard icon={Wallet} label="IVA mese corrente" value={formatEUR(liqMese.saldo)} sub={liqMese.saldo>0?'da versare':'a credito'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <p className="text-sm font-medium text-stone-600 mb-3">Fatturato mensile (imponibile)</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE2D2" vertical={false} />
                <XAxis dataKey="mese" tick={{ fontSize: 11, fill: '#A8845F' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#A8845F' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => formatEUR(v)} />
                <Bar dataKey="valore" fill="#C2622F" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Top clienti per fatturato</p>
          <div className="space-y-3">
            {topClienti.map(t => (
              <div key={t.cliente}>
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span className="truncate max-w-32">{t.cliente}</span><span className="font-mono-num">{formatEUR(t.val)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-amber-100">
                  <div className="h-1.5 rounded-full bg-orange-700" style={{ width:`${(t.val/maxTop)*100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Da fare</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between"><span>Ordini da fatturare</span><Badge tone={ordiniDaFatturare.length?'warning':'neutral'}>{ordiniDaFatturare.length}</Badge></li>
            <li className="flex items-center justify-between"><span>Fatture da incassare</span><Badge tone={fattureDaPagare.length?'info':'neutral'}>{fattureDaPagare.length}</Badge></li>
            <li className="flex items-center justify-between"><span>Prodotti sotto scorta</span><Badge tone={sottoScorta.length?'danger':'success'}>{sottoScorta.length}</Badge></li>
            <li className="flex items-center justify-between"><span>Clienti vicino al fido</span><Badge tone={fidoAlert.length?'danger':'success'}>{fidoAlert.length}</Badge></li>
            <li className="flex items-center justify-between"><span>Insoluti aperti</span><Badge tone={insolutiAperti.length?'danger':'success'}>{insolutiAperti.length}</Badge></li>
          </ul>
        </Card>
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Magazzino caffè verde</p>
          <div className="font-display text-2xl text-stone-900 mb-1">{db.magazzinoVerde?.kgDisponibili ?? 0} kg</div>
          <p className="text-xs text-stone-400 mb-3">disponibili per la tostatura</p>
          {sottoScorta.length > 0 && <ul className="space-y-1 text-xs text-red-700">{sottoScorta.map(p=><li key={p.id}>⚠ {p.nome}: {p.scorta}/{p.scortaMinima} {p.unita}</li>)}</ul>}
        </Card>
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Comunicazioni agenti</p>
          {(db.comunicazioni||[]).slice(-2).reverse().map(c=>(
            <div key={c.id} className="mb-2 pb-2 border-b border-amber-100 last:border-0">
              <p className="text-xs font-medium text-stone-800">{c.titolo || c.oggetto}</p>
              <p className="text-xs text-stone-400 mt-0.5">{formatDate(c.data)}</p>
            </div>
          ))}
          {!(db.comunicazioni||[]).length && <p className="text-xs text-stone-400">Nessuna comunicazione.</p>}
          <button onClick={()=>goTo&&goTo('comunicazioni')} className="mt-1 text-xs text-orange-700 hover:underline">Gestisci comunicazioni →</button>
        </Card>
      </div>
    </div>
  );
}

function ClientiView({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const fields = [
    { name: 'ragioneSociale', label: 'Ragione sociale', full: true },
    { name: 'piva', label: 'P.IVA' },
    { name: 'pagamento', label: 'Condizioni pagamento', type: 'select', options: [{ value: 'Immediato', label: 'Immediato' }, { value: '30 gg', label: '30 gg' }, { value: '60 gg', label: '60 gg' }] },
    { name: 'citta', label: 'Città' },
    { name: 'indirizzo', label: 'Indirizzo' },
    { name: 'telefono', label: 'Telefono' },
    { name: 'email', label: 'Email' },
    { name: 'fido', label: 'Fido (€)', type: 'number' },
    { name: 'scontoPercent', label: 'Sconto cliente (%)', type: 'number' },
    { name: 'agenteId', label: 'Agente di riferimento', type: 'select', options: db.agenti.map(a => ({ value: a.id, label: `${a.nome} ${a.cognome}` })) },
  ];

  async function handleSave(values) {
    setSaving(true);
    try {
      const payload = { ...values, fido: parseFloat(values.fido) || 0, scontoPercent: parseFloat(values.scontoPercent) || 0 };
      if (editing.id) await api.clienti.update(editing.id, payload);
      else await api.clienti.create(payload);
      const clienti = await api.clienti.list();
      setDb(d => ({ ...d, clienti }));
      setEditing(null);
    } catch (e) {
      alert('Errore salvataggio cliente: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cliente) {
    try {
      await api.clienti.remove(cliente.id);
      const clienti = await api.clienti.list();
      setDb(d => ({ ...d, clienti }));
    } catch (e) {
      alert('Errore eliminazione: ' + e.message);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}><Plus size={15} /> Nuovo cliente</Button></div>
      <DataTable
        columns={[
          { key: 'ragioneSociale', label: 'Ragione sociale' },
          { key: 'citta', label: 'Città' },
          { key: 'agente', label: 'Agente', render: r => { const a = db.agenti.find(x => x.id === r.agenteId); return a ? `${a.nome} ${a.cognome}` : '—'; } },
          { key: 'scontoPercent', label: 'Sc.%', align: 'right', render: r => r.scontoPercent ? `${r.scontoPercent}%` : '—' },
          { key: 'pagamento', label: 'Pagamento' },
          { key: 'esposizione', label: 'Esposizione / Fido', render: r => {
            const esp = esposizioneCliente(db, r.id);
            const pct = r.fido > 0 ? Math.round(esp / r.fido * 100) : 0;
            const danger = pct >= 80;
            return <div className="w-32"><div className="flex justify-between text-xs mb-0.5"><span className={cn('font-mono-num', danger ? 'text-red-700' : 'text-stone-500')}>{formatEUR(esp)}</span><span className="text-stone-400">{formatEUR(r.fido)}</span></div><div className="h-1.5 rounded-full bg-amber-100"><div className={cn('h-1.5 rounded-full', danger ? 'bg-red-600' : 'bg-orange-700')} style={{width:`${Math.min(100,pct)}%`}} /></div></div>;
          }},
        ]}
        rows={db.clienti}
        actions={r => (
          <div className="flex justify-end gap-1">
            <button onClick={() => setEditing(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={15} /></button>
            <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
          </div>
        )}
      />
      {editing && <FormModal title={editing.id ? 'Modifica cliente' : 'Nuovo cliente'} fields={fields} initial={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Disattivare "${toDelete.ragioneSociale}"?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
    </div>
  );
}

function AgentiView({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  const fields = [
    { name: 'nome', label: 'Nome' },
    { name: 'cognome', label: 'Cognome' },
    { name: 'zona', label: 'Zona di competenza' },
    { name: 'email', label: 'Email' },
    { name: 'telefono', label: 'Telefono' },
    { name: 'target', label: 'Target annuo (€)', type: 'number' },
    { name: 'bonusTarget', label: 'Bonus target (€)', type: 'number' },
  ];

  async function handleSave(values) {
    const target = parseFloat(values.target) || 0;
    const bonusTarget = parseFloat(values.bonusTarget) || 0;
    const scaglioni = editing.scaglioni || [{ soglia: 0, perc: 4 }];
    setSaving(true);
    try {
      if (editing.id) await api.agenti.update(editing.id, { ...values, target, bonusTarget, scaglioni });
      else await api.agenti.create({ ...values, target, bonusTarget, scaglioni });
      const agenti = await api.agenti.list();
      setDb(d => ({ ...d, agenti }));
      setEditing(null);
    } catch (e) {
      alert('Errore salvataggio agente: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agente) {
    try {
      await api.agenti.remove(agente.id);
      const agenti = await api.agenti.list();
      setDb(d => ({ ...d, agenti }));
    } catch (e) {
      alert('Errore eliminazione: ' + e.message);
    }
  }

  async function registraProvvigione(r) {
    try {
      const res = await api.agenti.registraProvvigione(r.id);
      if (res.importo > 0) alert(`Provvigione registrata: ${formatEUR(res.importo)}`);
      else alert('Nessuna provvigione da registrare per questo agente.');
      const [fatture, movimenti] = await Promise.all([api.fatture.list(), api.contabilita.movimenti()]);
      setDb(d => ({ ...d, fatture, movimenti }));
    } catch (e) {
      alert('Errore registrazione provvigione: ' + e.message);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}><Plus size={15} /> Nuovo agente</Button></div>
      <DataTable
        columns={[
          { key: 'nome', label: 'Agente', render: r => `${r.nome} ${r.cognome}` },
          { key: 'zona', label: 'Zona' },
          { key: 'clienti', label: 'Clienti', align: 'right', render: r => db.clienti.filter(c => c.agenteId === r.id).length },
          { key: 'fatturato', label: 'Fatturato', render: r => {
            const fat = db.fatture.filter(f => f.agenteId === r.id).reduce((s, f) => s + f.imponibile, 0);
            const pct = r.target ? Math.min(100, Math.round(fat / r.target * 100)) : 0;
            return <div className="w-36"><div className="flex justify-between text-xs mb-0.5"><span className="font-mono-num">{formatEUR(fat)}</span><span className="text-stone-400">{pct}%</span></div><div className="h-1.5 rounded-full bg-amber-100"><div className={cn('h-1.5 rounded-full', pct>=100?'bg-emerald-600':'bg-orange-700')} style={{width:`${pct}%`}} /></div></div>;
          }},
          { key: 'provv', label: 'Provvigione', render: r => {
            const fat = db.fatture.filter(f => f.agenteId === r.id).reduce((s, f) => s + f.imponibile, 0);
            const p = calcoloProvvigioneAgente(r, fat);
            return <span className="text-xs">{p.perc}%{p.targetRaggiunto ? <Badge tone="success" className="ml-1">+bonus</Badge> : ''}</span>;
          }},
        ]}
        rows={db.agenti}
        actions={r => (
          <div className="flex justify-end gap-1">
            <button onClick={() => registraProvvigione(r)} className="p-1.5 text-xs text-stone-400 hover:text-orange-700">Provvigione</button>
            <button onClick={() => setDetail(r)} className="p-1.5 text-stone-400 hover:text-orange-700 text-xs">Scaglioni</button>
            <button onClick={() => setEditing(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={15} /></button>
            <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
          </div>
        )}
      />
      {editing && <FormModal title={editing.id ? 'Modifica agente' : 'Nuovo agente'} fields={fields} initial={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Disattivare ${toDelete.nome} ${toDelete.cognome}?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
      {detail && <ScaglioniModal agente={detail} setDb={setDb} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ScaglioniModal({ agente, setDb, onClose }) {
  const [scaglioni, setScaglioni] = useState(agente.scaglioni ? [...agente.scaglioni] : [{ soglia: 0, perc: 4 }]);
  const [saving, setSaving] = useState(false);
  function update(i, k, v) { setScaglioni(s => s.map((x, j) => j === i ? { ...x, [k]: parseFloat(v) || 0 } : x)); }
  function add() { setScaglioni(s => [...s, { soglia: 0, perc: 0 }]); }
  function remove(i) { setScaglioni(s => s.filter((_, j) => j !== i)); }
  async function save() {
    setSaving(true);
    try {
      await api.agenti.update(agente.id, { nome: agente.nome, cognome: agente.cognome, zona: agente.zona, email: agente.email, telefono: agente.telefono, target: agente.target, bonusTarget: agente.bonusTarget, scaglioni });
      const agenti = await api.agenti.list();
      setDb(d => ({ ...d, agenti }));
      onClose();
    } catch (e) {
      alert('Errore salvataggio scaglioni: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={`Scaglioni provvigione — ${agente.nome} ${agente.cognome}`} onClose={onClose}>
      <p className="text-xs text-stone-400 mb-3">Definisci le soglie di fatturato e le percentuali corrispondenti.</p>
      <div className="space-y-2">
        {scaglioni.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-stone-400 w-20">Soglia (€)</span>
            <input type="number" className="w-24 rounded border border-stone-300 px-2 py-1 text-sm" value={s.soglia} onChange={e => update(i, 'soglia', e.target.value)} />
            <span className="text-xs text-stone-400 w-16">Provv. %</span>
            <input type="number" step="0.5" className="w-20 rounded border border-stone-300 px-2 py-1 text-sm" value={s.perc} onChange={e => update(i, 'perc', e.target.value)} />
            <button onClick={() => remove(i)} className="text-stone-400 hover:text-red-700"><X size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 text-sm text-orange-700 flex items-center gap-1"><Plus size={13} /> Aggiungi scaglione</button>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
      </div>
    </Modal>
  );
}

function ProdottiView({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [scontiTarget, setScontiTarget] = useState(null);
  const [selezionati, setSelezionati] = useState([]);
  const [bulkIva, setBulkIva] = useState(false);
  const [nuovaAliquota, setNuovaAliquota] = useState('22');
  const [saving, setSaving] = useState(false);

  const fields = [
    { name: 'nome', label: 'Nome prodotto', full: true },
    { name: 'categoria', label: 'Categoria', type: 'select', options: ['Miscela', 'Monorigine', 'Decaffeinato', 'Macinato', 'Capsule', 'Cialde'].map(v => ({ value: v, label: v })) },
    { name: 'formato', label: 'Formato' },
    { name: 'unita', label: 'Unità', type: 'select', options: [{ value: 'kg', label: 'kg' }, { value: 'conf', label: 'confezioni' }] },
    { name: 'prezzo', label: 'Prezzo listino (€)', type: 'number' },
    { name: 'costo', label: 'Costo (€)', type: 'number' },
    { name: 'aliquotaIva', label: 'IVA (%)', type: 'select', options: [{ value: '22', label: '22%' }, { value: '10', label: '10%' }, { value: '4', label: '4%' }, { value: '0', label: '0%' }] },
    { name: 'rendimentoTostatura', label: 'Rendimento tostatura (%)', type: 'number' },
    { name: 'scorta', label: 'Scorta attuale', type: 'number' },
    { name: 'scortaMinima', label: 'Scorta minima', type: 'number' },
  ];

  async function handleSave(values) {
    const num = { prezzo: parseFloat(values.prezzo)||0, costo: parseFloat(values.costo)||0, scorta: parseFloat(values.scorta)||0, scortaMinima: parseFloat(values.scortaMinima)||0, aliquotaIva: parseFloat(values.aliquotaIva)||22, rendimentoTostatura: parseFloat(values.rendimentoTostatura)||84 };
    setSaving(true);
    try {
      if (editing.id) await api.prodotti.update(editing.id, { ...values, ...num, scontiQuantita: editing.scontiQuantita || [] });
      else await api.prodotti.create({ ...values, ...num, scontiQuantita: [] });
      const prodotti = await api.prodotti.list();
      setDb(d => ({ ...d, prodotti }));
      setEditing(null);
    } catch (e) {
      alert('Errore salvataggio prodotto: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleSel(id) { setSelezionati(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]); }

  async function applicaIvaMultipla() {
    const aliq = parseFloat(nuovaAliquota);
    try {
      for (const id of selezionati) {
        const p = db.prodotti.find(x => x.id === id);
        if (!p) continue;
        await api.prodotti.update(id, { ...p, aliquotaIva: aliq, scontiQuantita: p.scontiQuantita || [] });
      }
      const prodotti = await api.prodotti.list();
      setDb(d => ({ ...d, prodotti }));
    } catch (e) {
      alert('Errore aggiornamento IVA multipla: ' + e.message);
    }
    setSelezionati([]); setBulkIva(false);
  }

  async function handleDelete(p) {
    try {
      await api.prodotti.remove(p.id);
      const prodotti = await api.prodotti.list();
      setDb(d => ({ ...d, prodotti }));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2 items-center flex-wrap">
        {selezionati.length > 0 && (
          <>
            <span className="text-xs text-stone-500">{selezionati.length} selezionati</span>
            <Button size="sm" variant="ghost" onClick={() => setBulkIva(true)}>Modifica IVA multipla</Button>
          </>
        )}
        <Button onClick={() => setEditing({})}><Plus size={15} /> Nuovo prodotto</Button>
      </div>
      <DataTable
        columns={[
          { key: 'sel', label: '', render: r => <input type="checkbox" className="accent-orange-600" checked={selezionati.includes(r.id)} onChange={() => toggleSel(r.id)} /> },
          { key: 'nome', label: 'Prodotto', render: r => <div><div className="font-medium text-stone-800">{r.nome}</div><div className="text-xs text-stone-400">{r.categoria} · {r.formato} · IVA {r.aliquotaIva}%</div></div> },
          { key: 'prezzo', label: 'Prezzo', align: 'right', mono: true, render: r => formatEUR(r.prezzo) },
          { key: 'margine', label: 'Margine', align: 'right', render: r => { const m = Math.round((r.prezzo-r.costo)/r.prezzo*100); return <span className={cn('font-mono-num text-xs', m>40?'text-emerald-700':m>25?'text-amber-700':'text-red-700')}>{m}%</span>; }},
          { key: 'scorta', label: 'Scorta', render: r => (
            <div className="flex items-center gap-2">
              <span className={cn('font-mono-num text-xs', r.scorta < r.scortaMinima ? 'text-red-700' : 'text-stone-600')}>{r.scorta} {r.unita}</span>
              <StockGauge value={r.scorta} min={r.scortaMinima} />
            </div>
          )},
          { key: 'sconti', label: 'Sconti qta', render: r => <span className="text-xs text-stone-400">{(r.scontiQuantita||[]).length} fasce</span>},
        ]}
        rows={db.prodotti}
        actions={r => (
          <div className="flex justify-end gap-1">
            <button onClick={() => setScontiTarget(r)} className="p-1.5 text-xs text-stone-400 hover:text-orange-700">Sconti</button>
            <button onClick={() => setEditing(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={15} /></button>
            <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
          </div>
        )}
      />
      {editing && <FormModal title={editing.id ? 'Modifica prodotto' : 'Nuovo prodotto'} fields={fields} initial={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Eliminare "${toDelete.nome}"?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
      {scontiTarget && <ScontiQtaModal prodotto={scontiTarget} db={db} setDb={setDb} onClose={() => setScontiTarget(null)} />}
      {bulkIva && (
        <Modal title={`Modifica IVA per ${selezionati.length} prodotti`} onClose={() => setBulkIva(false)}>
          <div className="space-y-4">
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Nuova aliquota IVA</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={nuovaAliquota} onChange={e=>setNuovaAliquota(e.target.value)}>
                <option value="22">22%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option>
              </select></div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setBulkIva(false)}>Annulla</Button><Button onClick={applicaIvaMultipla}>Applica a {selezionati.length} prodotti</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ScontiQtaModal({ prodotto, db, setDb, onClose }) {
  const [sconti, setSconti] = useState(prodotto.scontiQuantita ? [...prodotto.scontiQuantita] : []);
  const [saving, setSaving] = useState(false);
  function update(i, k, v) { setSconti(s => s.map((x, j) => j === i ? { ...x, [k]: parseFloat(v)||0 } : x)); }
  async function save() {
    setSaving(true);
    try {
      await api.prodotti.update(prodotto.id, { ...prodotto, scontiQuantita: sconti });
      const prodotti = await api.prodotti.list();
      setDb(d => ({ ...d, prodotti }));
      onClose();
    } catch (e) {
      alert('Errore salvataggio sconti: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={`Sconti quantità — ${prodotto.nome}`} onClose={onClose}>
      <p className="text-xs text-stone-400 mb-3">Inserisci le fasce: sopra quella soglia viene applicato il relativo sconto percentuale.</p>
      <div className="space-y-2">
        {sconti.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-stone-400 w-20">Da {prodotto.unita}</span>
            <input type="number" className="w-20 rounded border border-stone-300 px-2 py-1 text-sm" value={s.soglia} onChange={e => update(i, 'soglia', e.target.value)} />
            <span className="text-xs text-stone-400 w-12">Sc. %</span>
            <input type="number" step="0.5" className="w-20 rounded border border-stone-300 px-2 py-1 text-sm" value={s.sconto} onChange={e => update(i, 'sconto', e.target.value)} />
            <button onClick={() => setSconti(s => s.filter((_, j) => j !== i))} className="text-stone-400 hover:text-red-700"><X size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => setSconti(s => [...s, { soglia: 0, sconto: 0 }])} className="mt-2 text-sm text-orange-700 flex items-center gap-1"><Plus size={13} /> Aggiungi fascia</button>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Annulla</Button><Button onClick={save} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></div>
    </Modal>
  );
}

function StockGauge({ value, min }) {
  const pct = Math.min(100, Math.round((value / Math.max(min * 3, 1)) * 100));
  const danger = value < min;
  return (
    <div className="w-28">
      <div className="h-1.5 rounded-full bg-amber-100 overflow-hidden">
        <div className={cn('h-1.5 rounded-full', danger ? 'bg-red-600' : 'bg-orange-700')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function statoOrdineBadge(stato) {
  return stato === 'fatturato' ? <Badge tone="success">Fatturato</Badge> : <Badge tone="warning">Da fatturare</Badge>;
}

function statoFatturaBadge(f) {
  const oggi = todayISO();
  if (f.stato === 'pagata') return <Badge tone="success">Pagata</Badge>;
  if (f.scadenza && f.scadenza < oggi) return <Badge tone="danger">Scaduta</Badge>;
  return <Badge tone="info">Da pagare</Badge>;
}

function NewOrderModal({ db, setDb, clienteOptions, onClose }) {
  const [clienteId, setClienteId] = useState('');
  const [agenteId, setAgenteId] = useState('');
  const [righe, setRighe] = useState([{ prodottoId: '', quantita: 1 }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateRiga(idx, patch) { setRighe(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r)); }
  function addRiga() { setRighe(rs => [...rs, { prodottoId: '', quantita: 1 }]); }
  function removeRiga(idx) { setRighe(rs => rs.filter((_, i) => i !== idx)); }

  const righeValide = righe.filter(r => r.prodottoId && r.quantita > 0);
  const totale = righeValide.reduce((s, r) => { const p = db.prodotti.find(x => x.id === r.prodottoId); return s + (p ? p.prezzo * r.quantita : 0); }, 0);

  function handleClienteChange(id) {
    setClienteId(id);
    const c = db.clienti.find(x => x.id === id);
    if (c) setAgenteId(c.agenteId);
  }

  async function submit() {
    if (!clienteId) return setError('Seleziona un cliente.');
    if (!righeValide.length) return setError('Aggiungi almeno una riga prodotto valida.');
    const righeApi = righeValide.map(r => { const p = db.prodotti.find(x => x.id === r.prodottoId); return { prodottoId: r.prodottoId, quantita: Number(r.quantita), prezzoUnitario: p.prezzo }; });
    setSaving(true);
    try {
      await api.ordini.create({ data: todayISO(), clienteId, agenteId, righe: righeApi, stato: 'confermato' });
      const [ordini, prodotti] = await Promise.all([api.ordini.list(), api.prodotti.list()]);
      setDb(d => ({ ...d, ordini, prodotti }));
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuovo ordine" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Cliente</label>
          <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={clienteId} onChange={e => handleClienteChange(e.target.value)}>
            <option value="">Seleziona cliente…</option>
            {clienteOptions.map(c => <option key={c.id} value={c.id}>{c.ragioneSociale} — {c.citta}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Agente</label>
          <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={agenteId} onChange={e => setAgenteId(e.target.value)}>
            <option value="">Seleziona agente…</option>
            {db.agenti.map(a => <option key={a.id} value={a.id}>{a.nome} {a.cognome}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Prodotti</p>
          <div className="space-y-2">
            {righe.map((r, idx) => {
              const p = db.prodotti.find(x => x.id === r.prodottoId);
              return (
                <div key={idx} className="flex items-center gap-2">
                  <select className="flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.prodottoId} onChange={e => updateRiga(idx, { prodottoId: e.target.value })}>
                    <option value="">Prodotto…</option>
                    {db.prodotti.map(pr => <option key={pr.id} value={pr.id}>{pr.nome} ({pr.formato})</option>)}
                  </select>
                  <input type="number" min="1" className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.quantita} onChange={e => updateRiga(idx, { quantita: e.target.value })} />
                  <span className="w-24 text-right text-sm font-mono-num text-stone-500">{p ? formatEUR(p.prezzo * r.quantita) : '—'}</span>
                  <button onClick={() => removeRiga(idx)} className="p-1 text-stone-400 hover:text-red-700"><X size={15} /></button>
                </div>
              );
            })}
          </div>
          <button onClick={addRiga} className="mt-2 text-sm text-orange-700 hover:text-orange-800 flex items-center gap-1"><Plus size={14} /> Aggiungi riga</button>
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm text-stone-500">Totale imponibile</span>
          <span className="font-display text-xl text-stone-900">{formatEUR(totale)}</span>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creazione…' : 'Crea ordine'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function FornitoriView({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const fields = [
    { name: 'ragioneSociale', label: 'Ragione sociale', full: true },
    { name: 'piva', label: 'P.IVA / Cod. fiscale' },
    { name: 'paese', label: 'Paese' },
    { name: 'telefono', label: 'Telefono' },
    { name: 'email', label: 'Email' },
    { name: 'referente', label: 'Referente' },
  ];
  async function handleSave(values) {
    setSaving(true);
    try {
      if (editing.id) await api.fornitori.update(editing.id, values);
      else await api.fornitori.create(values);
      const fornitori = await api.fornitori.list();
      setDb(d => ({ ...d, fornitori }));
      setEditing(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  async function handleDelete(f) {
    try {
      await api.fornitori.remove(f.id);
      const fornitori = await api.fornitori.list();
      setDb(d => ({ ...d, fornitori }));
    } catch (e) {
      alert(e.message);
    }
  }
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}><Plus size={15} /> Nuovo fornitore</Button></div>
      <DataTable
        columns={[
          { key: 'ragioneSociale', label: 'Ragione sociale' },
          { key: 'paese', label: 'Paese' },
          { key: 'referente', label: 'Referente' },
          { key: 'email', label: 'Email' },
        ]}
        rows={db.fornitori || []}
        actions={r => (
          <div className="flex justify-end gap-1">
            <button onClick={() => setEditing(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={15} /></button>
            <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
          </div>
        )}
        empty="Nessun fornitore."
      />
      {editing && <FormModal title={editing.id ? 'Modifica fornitore' : 'Nuovo fornitore'} fields={fields} initial={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Eliminare ${toDelete.ragioneSociale}?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
    </div>
  );
}

function OrdiniAcquistoView({ db, setDb }) {
  const [showNew, setShowNew] = useState(null);
  const [saving, setSaving] = useState(false);
  const rows = [...(db.ordiniAcquisto || [])].sort((a, b) => b.data.localeCompare(a.data));

  async function riceviOrdine(oa) {
    try {
      await api.ordiniAcquisto.ricevi(oa.id);
      const [ordiniAcquisto, magazzinoVerde, movimenti] = await Promise.all([
        api.ordiniAcquisto.list(), api.magazzinoVerde.get(), api.contabilita.movimenti(),
      ]);
      setDb(d => ({ ...d, ordiniAcquisto, magazzinoVerde, movimenti }));
    } catch (e) {
      alert('Errore ricevimento: ' + e.message);
    }
  }

  async function creaOrdine(values) {
    const kg = parseFloat(values.kg) || 0;
    const prezzoKg = parseFloat(values.prezzoKg) || 0;
    const aliquotaIva = parseFloat(values.aliquotaIva) || 22;
    setSaving(true);
    try {
      await api.ordiniAcquisto.create({ data: values.data || todayISO(), fornitoreId: values.fornitoreId, aliquotaIva, righe: [{ descrizione: values.descrizione, kg, prezzoKg }] });
      const ordiniAcquisto = await api.ordiniAcquisto.list();
      setDb(d => ({ ...d, ordiniAcquisto }));
      setShowNew(false);
    } catch (e) {
      alert('Errore creazione: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const oaFields = [
    { name: 'data', label: 'Data', type: 'date' },
    { name: 'fornitoreId', label: 'Fornitore', type: 'select', options: (db.fornitori || []).map(f => ({ value: f.id, label: f.ragioneSociale })) },
    { name: 'descrizione', label: 'Descrizione merce', full: true },
    { name: 'kg', label: 'Quantità (kg)', type: 'number' },
    { name: 'prezzoKg', label: 'Prezzo/kg (€)', type: 'number' },
    { name: 'aliquotaIva', label: 'IVA (%)', type: 'select', options: [{ value: '22', label: '22%' }, { value: '0', label: '0% (import extra-UE)' }] },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Package} label="Caffè verde disponibile" value={`${db.magazzinoVerde?.kgDisponibili ?? 0} kg`} />
        <StatCard icon={ShoppingCart} label="Ordini in attesa" value={(db.ordiniAcquisto || []).filter(o => o.stato === 'in_attesa').length} />
      </div>
      <div className="flex justify-end"><Button onClick={() => setShowNew(true)}><Plus size={15} /> Nuovo ordine d'acquisto</Button></div>
      <DataTable
        columns={[
          { key: 'data', label: 'Data', render: r => formatDate(r.data) },
          { key: 'fornitore', label: 'Fornitore', render: r => (db.fornitori || []).find(f => f.id === r.fornitoreId)?.ragioneSociale || r.fornitoreId },
          { key: 'merce', label: 'Merce', render: r => r.righe.map(x => x.descrizione).join(', ') },
          { key: 'kg', label: 'kg tot.', align: 'right', mono: true, render: r => r.righe.reduce((s, x) => s + x.kg, 0) },
          { key: 'importo', label: 'Importo', align: 'right', mono: true, render: r => { const imp = r.righe.reduce((s, x) => s + x.kg * x.prezzoKg, 0); return formatEUR(imp * (1 + r.aliquotaIva / 100)); } },
          { key: 'stato', label: 'Stato', render: r => r.stato === 'ricevuto' ? <Badge tone="success">Ricevuto</Badge> : <Badge tone="warning">In attesa</Badge> },
        ]}
        rows={rows}
        actions={r => r.stato === 'in_attesa' ? <Button size="sm" onClick={() => riceviOrdine(r)}>Segna ricevuto</Button> : null}
        empty="Nessun ordine d'acquisto."
      />
      {showNew && <FormModal title="Nuovo ordine d'acquisto" fields={oaFields} initial={{ aliquotaIva: '22', data: todayISO() }} onClose={() => setShowNew(false)} onSave={creaOrdine} saving={saving} />}
    </div>
  );
}

function LottiView({ db, setDb }) {
  const oggi = todayISO();
  const [showProd, setShowProd] = useState(false);
  const [saving, setSaving] = useState(false);
  const lotti = [...(db.lotti || [])].sort((a, b) => a.scadenza.localeCompare(b.scadenza));

  const prodFields = [
    { name: 'data', label: 'Data tostatura', type: 'date' },
    { name: 'prodottoId', label: 'Prodotto da produrre', type: 'select', options: db.prodotti.filter(p => p.unita === 'kg').map(p => ({ value: p.id, label: p.nome })) },
    { name: 'kgVerde', label: 'Kg caffè verde impiegati', type: 'number' },
  ];

  async function avviaProduzione(values) {
    setSaving(true);
    try {
      const res = await api.lotti.create(values);
      const [lotti2, prodotti, magazzinoVerde] = await Promise.all([api.lotti.list(), api.prodotti.list(), api.magazzinoVerde.get()]);
      setDb(d => ({ ...d, lotti: lotti2, prodotti, magazzinoVerde }));
      alert(`Tostatura registrata: ${res.kgOttenuti} kg ottenuti.`);
      setShowProd(false);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button onClick={() => setShowProd(true)}><Plus size={15} /> Nuova tostatura</Button></div>
      {showProd && <FormModal title="Avvia tostatura" fields={prodFields} initial={{ data: todayISO() }} onClose={() => setShowProd(false)} onSave={avviaProduzione} saving={saving} />}
      <DataTable
        columns={[
          { key: 'prodotto', label: 'Prodotto', render: r => db.prodotti.find(p => p.id === r.prodottoId)?.nome || r.prodottoId },
          { key: 'dataTostatura', label: 'Data tostatura', render: r => formatDate(r.dataTostatura) },
          { key: 'scadenza', label: 'Scadenza', render: r => { const exp = r.scadenza < oggi; return <span className={exp ? 'text-red-700 font-medium' : ''}>{formatDate(r.scadenza)}</span>; }},
          { key: 'quantitaIniziale', label: 'Prodotto (kg/conf)', align: 'right', mono: true, render: r => r.quantitaIniziale },
          { key: 'quantitaResidua', label: 'Residuo', align: 'right', mono: true, render: r => { const pct = Math.round(r.quantitaResidua / Math.max(r.quantitaIniziale, 1) * 100); return <span className={pct < 20 ? 'text-red-700' : 'text-stone-600'}>{r.quantitaResidua}</span>; }},
          { key: 'stato', label: '', render: r => { if (r.scadenza < oggi) return <Badge tone="danger">Scaduto</Badge>; if (r.quantitaResidua <= 0) return <Badge tone="neutral">Esaurito</Badge>; return <Badge tone="success">Attivo</Badge>; }},
        ]}
        rows={lotti}
        empty="Nessun lotto registrato."
      />
    </div>
  );
}

function OrdiniView({ db, setDb }) {
  const [showNew, setShowNew] = useState(false);
  const [pdfHtml, setPdfHtml] = useState(null);
  const [pdfNarrow, setPdfNarrow] = useState(false);
  const rows = [...db.ordini].sort((a, b) => b.data.localeCompare(a.data));
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setShowNew(true)}><Plus size={15} /> Nuovo ordine</Button></div>
      <DataTable
        columns={[
          { key: 'data', label: 'Data', render: r => formatDate(r.data) },
          { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale || '—' },
          { key: 'agente', label: 'Agente', render: r => { const a = db.agenti.find(x => x.id === r.agenteId); return a ? `${a.nome} ${a.cognome}` : '—'; } },
          { key: 'righe', label: 'Articoli', align: 'right', render: r => r.righe.length },
          { key: 'totale', label: 'Totale imponibile', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.quantita * x.prezzoUnitario, 0)) },
          { key: 'stato', label: 'Stato', render: r => statoOrdineBadge(r.stato) },
        ]}
        rows={rows}
        actions={r => (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setPdfHtml(buildOrdineHTML(r, db)); setPdfNarrow(false); }}>PDF</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPdfHtml(buildBollaHTML(r, db)); setPdfNarrow(true); }}>Bolla 80mm</Button>
          </div>
        )}
        empty="Nessun ordine registrato."
      />
      {showNew && <NewOrderModal db={db} setDb={setDb} clienteOptions={db.clienti} onClose={() => setShowNew(false)} />}
      {pdfHtml && <PDFModal html={pdfHtml} onClose={() => setPdfHtml(null)} narrow={pdfNarrow} />}
    </div>
  );
}

function FatturazioneView({ db, setDb }) {
  const [contoPagamento, setContoPagamento] = useState('1002');
  const [payFattura, setPayFattura] = useState(null);
  const [parzialeFattura, setParzialeFattura] = useState(null);
  const [importoParziale, setImportoParziale] = useState('');
  const [pagamentiFattura, setPagamentiFattura] = useState([]);
  const [notaTarget, setNotaTarget] = useState(null);
  const [notaForm, setNotaForm] = useState({ importoImponibile: '', motivo: '' });
  const [tab, setTab] = useState('documenti');
  const [pdfHtml, setPdfHtml] = useState(null);
  const [nuovoDoc, setNuovoDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const ordiniDaFatturare = db.ordini.filter(o => o.stato === 'confermato');

  async function refreshDopoContabile() {
    const [ordini, fatture, movimenti, prodotti] = await Promise.all([
      api.ordini.list(), api.fatture.list(), api.contabilita.movimenti(), api.prodotti.list(),
    ]);
    setDb(d => ({ ...d, ordini, fatture, movimenti, prodotti }));
  }

  async function generaFattura(ordine) {
    setBusy(true);
    try {
      await api.ordini.fattura(ordine.id);
      await refreshDopoContabile();
    } catch (e) {
      alert('Errore generazione fattura: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confermaPagamento() {
    setBusy(true);
    try {
      await api.fatture.pagamento(payFattura.id, { contoIncasso: contoPagamento });
      await refreshDopoContabile();
      setPayFattura(null);
    } catch (e) {
      alert('Errore incasso: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stornaPagamento(pagamentoId) {
    try {
      await api.fatturePagamenti.storna(pagamentoId);
      await refreshDopoContabile();
      const pagamenti = await api.fatture.pagamenti(payFattura.id);
      setPagamentiFattura(pagamenti);
    } catch (e) {
      alert('Errore storno: ' + e.message);
    }
  }

  async function confermaPagamentoParziale() {
    const imp = parseFloat(importoParziale);
    if (!imp || imp <= 0) return;
    setBusy(true);
    try {
      await api.fatture.pagamentoParziale(parzialeFattura.id, { importo: imp, conto: contoPagamento });
      await refreshDopoContabile();
      setParzialeFattura(null); setImportoParziale('');
    } catch (e) {
      alert('Errore pagamento parziale: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function emettiNota() {
    const imp = parseFloat(notaForm.importoImponibile);
    if (!imp || imp <= 0 || imp > notaTarget.imponibile) return;
    setBusy(true);
    try {
      await api.noteCredito.create({ fatturaId: notaTarget.id, importo: imp, motivo: notaForm.motivo, data: todayISO() });
      const [noteCredito, movimenti] = await Promise.all([api.noteCredito.list(), api.contabilita.movimenti()]);
      setDb(d => ({ ...d, noteCredito, movimenti }));
      setNotaTarget(null);
    } catch (e) {
      alert('Errore nota di credito: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const oggi = todayISO(); const meseFine = oggi; const meseInizio = oggi.slice(0,7)+'-01';
  const liqMese = useMemo(() => calcolaLiquidazioneIva(db.movimenti, meseInizio, meseFine), [db.movimenti]);
  const liqQ1 = useMemo(() => calcolaLiquidazioneIva(db.movimenti, '2026-01-01', '2026-03-31'), [db.movimenti]);
  const liqQ2 = useMemo(() => calcolaLiquidazioneIva(db.movimenti, '2026-04-01', '2026-06-30'), [db.movimenti]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={tab==='documenti' ? 'primary' : 'ghost'} onClick={() => setTab('documenti')}>Fatture & ordini</Button>
          <Button size="sm" variant={tab==='corrispettivi' ? 'primary' : 'ghost'} onClick={() => setTab('corrispettivi')}>Corrispettivi</Button>
          <Button size="sm" variant={tab==='liquidazione' ? 'primary' : 'ghost'} onClick={() => setTab('liquidazione')}>Liquidazione IVA</Button>
        </div>
        {tab !== 'liquidazione' && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setNuovoDoc('fattura')}>+ Fattura diretta</Button>
            <Button size="sm" variant="dark" onClick={() => setNuovoDoc('corrispettivo')}>+ Corrispettivo</Button>
          </div>
        )}
      </div>

      {tab === 'documenti' && <>
        <div>
          <p className="text-sm font-medium text-stone-600 mb-3">Ordini da fatturare</p>
          <DataTable
            columns={[
              { key: 'data', label: 'Data', render: r => formatDate(r.data) },
              { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
              { key: 'totale', label: 'Imponibile', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.quantita * x.prezzoUnitario, 0)) },
            ]}
            rows={ordiniDaFatturare}
            actions={r => <Button size="sm" onClick={() => generaFattura(r)} disabled={busy}>Genera fattura</Button>}
            empty="Nessun ordine in attesa."
          />
        </div>
        <div>
          <p className="text-sm font-medium text-stone-600 mb-3">Fatture emesse</p>
          <DataTable
            columns={[
              { key: 'numero', label: 'Numero', mono: true },
              { key: 'data', label: 'Data', render: r => formatDate(r.data) },
              { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
              { key: 'scadenza', label: 'Scadenza', render: r => formatDate(r.scadenza) },
              { key: 'totale', label: 'Totale', align: 'right', mono: true, render: r => formatEUR(r.totale) },
              { key: 'residuo', label: 'Residuo', align: 'right', mono: true, render: r => { const res = residuoFattura(db, r); return res < r.totale ? <span className="text-orange-700">{formatEUR(res)}</span> : formatEUR(res); }},
              { key: 'stato', label: 'Stato', render: statoFatturaBadge },
            ]}
            rows={[...db.fatture].sort((a, b) => b.data.localeCompare(a.data))}
            actions={r => (
              <div className="flex gap-1 flex-wrap">
                <Button size="sm" variant="ghost" onClick={() => setPdfHtml(buildFatturaHTML(r, db))}>PDF</Button>
                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => { setPayFattura(r); api.fatture.pagamenti(r.id).then(setPagamentiFattura).catch(() => setPagamentiFattura([])); }}>Incassa</Button>}
                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => { setParzialeFattura(r); setImportoParziale(''); }}>Parziale</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setNotaTarget(r); setNotaForm({ importoImponibile: '', motivo: '' }); }}>N.C.</Button>
              </div>
            )}
            empty="Nessuna fattura."
          />
        </div>
        {(db.noteCredito||[]).length > 0 && (
          <div>
            <p className="text-sm font-medium text-stone-600 mb-3">Note di credito emesse</p>
            <DataTable
              columns={[
                { key: 'id', label: 'ID', mono: true },
                { key: 'data', label: 'Data', render: r => formatDate(r.data) },
                { key: 'importo', label: 'Imponibile', align: 'right', mono: true, render: r => formatEUR(r.importo) },
                { key: 'motivo', label: 'Motivo' },
              ]}
              rows={db.noteCredito || []}
              empty="Nessuna nota di credito."
            />
          </div>
        )}
      </>}

      {tab === 'corrispettivi' && (
        <div>
          <DataTable
            columns={[
              { key: 'id', label: 'ID', mono: true },
              { key: 'data', label: 'Data', render: r => formatDate(r.data) },
              { key: 'cliente', label: 'Cliente', render: r => r.clienteId ? db.clienti.find(c=>c.id===r.clienteId)?.ragioneSociale : (r.clienteOccasionale || 'Cliente al banco') },
              { key: 'conto', label: 'Incassato con', render: r => r.contoIncasso === '1001' ? 'Cassa' : 'Banca' },
              { key: 'totale', label: 'Totale', align: 'right', mono: true, render: r => formatEUR((r.righe||[]).reduce((s,x)=>s+x.quantita*x.prezzoUnitario,0)) },
            ]}
            rows={[...(db.corrispettivi||[])].sort((a,b) => b.data.localeCompare(a.data))}
            actions={r => <Button size="sm" variant="ghost" onClick={() => setPdfHtml(buildCorrispettivoHTML({ ...r, totale: (r.righe||[]).reduce((s,x)=>s+x.quantita*x.prezzoUnitario,0) }, db))}>PDF</Button>}
            empty="Nessun corrispettivo emesso."
          />
        </div>
      )}

      {tab === 'liquidazione' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[{ label: 'Mese corrente', liq: liqMese }, { label: 'I trimestre 2026', liq: liqQ1 }, { label: 'II trimestre 2026', liq: liqQ2 }].map(({ label, liq }) => (
              <Card key={label}>
                <p className="text-xs text-stone-500 mb-2">{label}</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>IVA a debito</span><span className="font-mono-num">{formatEUR(liq.debito)}</span></div>
                  <div className="flex justify-between"><span>IVA a credito</span><span className="font-mono-num">{formatEUR(liq.credito)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-stone-200 font-medium">
                    <span>{liq.saldo >= 0 ? 'Da versare' : 'A credito'}</span>
                    <span className={cn('font-mono-num', liq.saldo > 0 ? 'text-red-700' : 'text-emerald-700')}>{formatEUR(Math.abs(liq.saldo))}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-xs text-stone-400">I dati si basano sui movimenti contabili registrati nei conti 2500 (IVA a debito) e 1500 (IVA a credito).</p>
        </div>
      )}

      {payFattura && (
        <Modal title={`Incasso — ${payFattura.numero}`} onClose={() => setPayFattura(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Conto di incasso</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={contoPagamento} onChange={e => setContoPagamento(e.target.value)}>
                <option value="1002">Banca c/c</option>
                <option value="1001">Cassa</option>
              </select>
            </div>
            <div className="flex justify-between text-sm"><span className="text-stone-500">Totale fattura</span><span className="font-mono-num">{formatEUR(payFattura.totale)}</span></div>
            {pagamentiFattura.length > 0 && (
              <div>
                <p className="text-xs font-medium text-stone-500 mb-1">Pagamenti parziali registrati</p>
                {pagamentiFattura.map(p => (
                  <div key={p.id} className={cn('flex items-center justify-between text-xs py-1', p.stornato ? 'line-through text-stone-400' : '')}>
                    <span>{formatDate(p.data)} — {formatEUR(p.importo)}</span>
                    {!p.stornato && <button onClick={() => stornaPagamento(p.id)} className="text-red-600 hover:underline ml-2">Storna</button>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-stone-400">Questo pulsante incassa sempre l'intero residuo. Per un pagamento parziale usa il pulsante "Parziale" nella tabella.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPayFattura(null)}>Annulla</Button>
              <Button onClick={confermaPagamento} disabled={busy}>{busy ? 'Registrazione…' : 'Incassa tutto'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {parzialeFattura && (
        <Modal title={`Pagamento parziale — ${parzialeFattura.numero}`} onClose={() => setParzialeFattura(null)}>
          <div className="space-y-4">
            <div className="flex justify-between text-sm"><span className="text-stone-500">Totale fattura</span><span className="font-mono-num">{formatEUR(parzialeFattura.totale)}</span></div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Importo incassato ora (€)</label>
              <input type="number" step="0.01" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={importoParziale} onChange={e => setImportoParziale(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Conto</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={contoPagamento} onChange={e => setContoPagamento(e.target.value)}>
                <option value="1002">Banca c/c</option>
                <option value="1001">Cassa</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setParzialeFattura(null)}>Annulla</Button>
              <Button onClick={confermaPagamentoParziale} disabled={busy}>{busy ? 'Registrazione…' : 'Registra pagamento parziale'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {notaTarget && (
        <Modal title={`Nota credito su ${notaTarget.numero}`} onClose={() => setNotaTarget(null)}>
          <div className="space-y-4">
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Imponibile da stornare (€, max {formatEUR(notaTarget.imponibile)})</label>
              <input type="number" step="0.01" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={notaForm.importoImponibile} onChange={e => setNotaForm(f => ({ ...f, importoImponibile: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Motivo</label>
              <input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={notaForm.motivo} onChange={e => setNotaForm(f => ({ ...f, motivo: e.target.value }))} /></div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setNotaTarget(null)}>Annulla</Button><Button onClick={emettiNota} disabled={busy}>{busy ? 'Emissione…' : 'Emetti nota'}</Button></div>
          </div>
        </Modal>
      )}

      {pdfHtml && <PDFModal html={pdfHtml} onClose={() => setPdfHtml(null)} />}
      {nuovoDoc && <NuovoDocumentoModal db={db} setDb={setDb} tipo={nuovoDoc} onClose={() => setNuovoDoc(null)} />}
    </div>
  );
}

function NuovoDocumentoModal({ db, setDb, tipo, onClose }) {
  const [clienteId, setClienteId] = useState('');
  const [clienteOccasionale, setClienteOccasionale] = useState('');
  const [agenteId, setAgenteId] = useState('');
  const [contoIncasso, setContoIncasso] = useState('1001');
  const [righe, setRighe] = useState([{ prodottoId: '', quantita: 1 }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isFattura = tipo === 'fattura';
  const cliente = db.clienti.find(c => c.id === clienteId);

  function updateRiga(idx, patch) { setRighe(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r)); }
  function addRiga() { setRighe(rs => [...rs, { prodottoId: '', quantita: 1 }]); }
  function removeRiga(idx) { setRighe(rs => rs.filter((_, i) => i !== idx)); }

  const righeValide = righe.filter(r => r.prodottoId && Number(r.quantita) > 0);
  const totale = righeValide.reduce((s, r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId);
    return s + (p ? prezzoUnitarioScontato(p, cliente, Number(r.quantita), db.listini) * Number(r.quantita) : 0);
  }, 0);

  async function submit() {
    setError('');
    if (isFattura && !clienteId) return setError('Seleziona un cliente per la fattura.');
    if (!righeValide.length) return setError('Aggiungi almeno un prodotto.');
    const righeApi = righeValide.map(r => {
      const p = db.prodotti.find(x => x.id === r.prodottoId);
      return { prodottoId: r.prodottoId, quantita: Number(r.quantita), prezzoUnitario: prezzoUnitarioScontato(p, cliente, Number(r.quantita), db.listini) };
    });
    setSaving(true);
    try {
      if (isFattura) {
        const { id: ordineId } = await api.ordini.create({ data: todayISO(), clienteId, agenteId: agenteId || null, righe: righeApi, stato: 'confermato' });
        await api.ordini.fattura(ordineId);
        const [ordini, fatture, movimenti, prodotti] = await Promise.all([
          api.ordini.list(), api.fatture.list(), api.contabilita.movimenti(), api.prodotti.list(),
        ]);
        setDb(d => ({ ...d, ordini, fatture, movimenti, prodotti }));
      } else {
        await api.corrispettivi.create({ data: todayISO(), clienteId: clienteId || null, clienteOccasionale, righe: righeApi, contoIncasso });
        const [movimenti, prodotti, corrispettivi] = await Promise.all([api.contabilita.movimenti(), api.prodotti.list(), api.corrispettivi.list()]);
        setDb(d => ({ ...d, movimenti, prodotti, corrispettivi }));
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isFattura ? 'Nuova fattura diretta' : 'Nuovo corrispettivo'} onClose={onClose} wide>
      <div className="space-y-4">
        {isFattura ? (
          <>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Cliente</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={clienteId} onChange={e => { setClienteId(e.target.value); const c = db.clienti.find(x=>x.id===e.target.value); if (c) setAgenteId(c.agenteId); }}>
                <option value="">Seleziona cliente…</option>
                {db.clienti.map(c => <option key={c.id} value={c.id}>{c.ragioneSociale}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Agente (opzionale)</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={agenteId} onChange={e => setAgenteId(e.target.value)}>
                <option value="">Nessuno / vendita diretta</option>
                {db.agenti.map(a => <option key={a.id} value={a.id}>{a.nome} {a.cognome}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Cliente (opzionale)</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={clienteId} onChange={e => setClienteId(e.target.value)}>
                <option value="">Cliente occasionale / al banco</option>
                {db.clienti.map(c => <option key={c.id} value={c.id}>{c.ragioneSociale}</option>)}
              </select>
            </div>
            {!clienteId && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Descrizione cliente occasionale (opzionale)</label>
                <input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder="es. Cliente al banco" value={clienteOccasionale} onChange={e => setClienteOccasionale(e.target.value)} />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Incassato con</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={contoIncasso} onChange={e => setContoIncasso(e.target.value)}>
                <option value="1001">Cassa</option>
                <option value="1002">Banca c/c</option>
              </select>
            </div>
          </>
        )}
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Prodotti</p>
          <div className="space-y-2">
            {righe.map((r, idx) => {
              const p = db.prodotti.find(x => x.id === r.prodottoId);
              return (
                <div key={idx} className="flex items-center gap-2">
                  <select className="flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.prodottoId} onChange={e => updateRiga(idx, { prodottoId: e.target.value })}>
                    <option value="">Prodotto…</option>
                    {db.prodotti.map(pr => <option key={pr.id} value={pr.id}>{pr.nome} ({pr.formato}) — {formatEUR(pr.prezzo)}</option>)}
                  </select>
                  <input type="number" min="1" className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.quantita} onChange={e => updateRiga(idx, { quantita: e.target.value })} />
                  <span className="w-24 text-right text-sm font-mono-num text-stone-500">{p ? formatEUR(prezzoUnitarioScontato(p, cliente, Number(r.quantita)||1, db.listini) * (Number(r.quantita)||0)) : '—'}</span>
                  <button onClick={() => removeRiga(idx)} className="p-1 text-stone-400 hover:text-red-700"><X size={15} /></button>
                </div>
              );
            })}
          </div>
          <button onClick={addRiga} className="mt-2 text-sm text-orange-700 flex items-center gap-1"><Plus size={14} /> Aggiungi riga</button>
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm text-stone-500">Totale imponibile</span>
          <span className="font-display text-xl text-stone-900">{formatEUR(totale)}</span>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creazione…' : (isFattura ? 'Emetti fattura' : 'Emetti corrispettivo')}</Button>
        </div>
      </div>
    </Modal>
  );
}

const SUBTABS_CONTAB = [
  { id: 'piano', label: 'Piano dei conti' },
  { id: 'primanota', label: 'Prima nota' },
  { id: 'giornale', label: 'Libro giornale' },
  { id: 'verifica', label: 'Bilancio di verifica' },
  { id: 'economico', label: 'Conto economico' },
  { id: 'patrimoniale', label: 'Stato patrimoniale' },
];

function NuovaRegistrazioneModal({ db, setDb, onClose }) {
  const [data, setData] = useState(todayISO());
  const [descrizione, setDescrizione] = useState('');
  const [righe, setRighe] = useState([{ conto: '', dare: '', avere: '' }, { conto: '', dare: '', avere: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateRiga(idx, patch) { setRighe(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r)); }
  function addRiga() { setRighe(rs => [...rs, { conto: '', dare: '', avere: '' }]); }
  function removeRiga(idx) { setRighe(rs => rs.filter((_, i) => i !== idx)); }

  const totDare = righe.reduce((s, r) => s + (parseFloat(r.dare) || 0), 0);
  const totAvere = righe.reduce((s, r) => s + (parseFloat(r.avere) || 0), 0);
  const bilanciato = Math.abs(totDare - totAvere) < 0.01 && totDare > 0;

  async function submit() {
    if (!descrizione) return setError('Inserisci una descrizione.');
    if (!bilanciato) return setError('Le righe devono essere bilanciate (totale dare = totale avere) e maggiori di zero.');
    const righeValide = righe.filter(r => r.conto && (parseFloat(r.dare) || parseFloat(r.avere)))
      .map(r => ({ conto: r.conto, dare: parseFloat(r.dare) || 0, avere: parseFloat(r.avere) || 0 }));
    setSaving(true);
    try {
      await api.contabilita.registra({ data, descrizione, riferimento: 'Manuale', righe: righeValide });
      const movimenti = await api.contabilita.movimenti();
      setDb(d => ({ ...d, movimenti }));
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuova registrazione contabile" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Data</label>
            <input type="date" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Descrizione</label>
            <input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={descrizione} onChange={e => setDescrizione(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          {righe.map((r, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select className="flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.conto} onChange={e => updateRiga(idx, { conto: e.target.value })}>
                <option value="">Conto…</option>
                {PIANO_CONTI.map(c => <option key={c.codice} value={c.codice}>{c.codice} — {c.nome}</option>)}
              </select>
              <input type="number" placeholder="Dare" className="w-24 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.dare} onChange={e => updateRiga(idx, { dare: e.target.value, avere: '' })} />
              <input type="number" placeholder="Avere" className="w-24 rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.avere} onChange={e => updateRiga(idx, { avere: e.target.value, dare: '' })} />
              <button onClick={() => removeRiga(idx)} className="p-1 text-stone-400 hover:text-red-700"><X size={15} /></button>
            </div>
          ))}
        </div>
        <button onClick={addRiga} className="text-sm text-orange-700 flex items-center gap-1"><Plus size={14} /> Aggiungi riga</button>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3 text-sm">
          <span className={bilanciato ? 'text-emerald-700' : 'text-red-700'}>Dare {formatEUR(totDare)} · Avere {formatEUR(totAvere)} {bilanciato ? '— bilanciato' : '— non bilanciato'}</span>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Registrazione…' : 'Registra'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ContabilitaView({ db, setDb }) {
  const [tab, setTab] = useState('piano');
  const [showNew, setShowNew] = useState(false);
  const verifica = useMemo(() => calcolaBilancioVerifica(db.movimenti), [db.movimenti]);
  const economico = useMemo(() => calcolaContoEconomico(db.movimenti), [db.movimenti]);
  const patrimoniale = useMemo(() => calcolaStatoPatrimoniale(db.movimenti), [db.movimenti]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 rounded-lg bg-amber-100 p-1 overflow-x-auto">
          {SUBTABS_CONTAB.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', tab === t.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700')}>
              {t.label}
            </button>
          ))}
        </div>
        {(tab === 'primanota' || tab === 'giornale') && <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nuova registrazione</Button>}
      </div>

      {tab === 'piano' && (
        <DataTable columns={[
          { key: 'codice', label: 'Codice', mono: true },
          { key: 'nome', label: 'Conto' },
          { key: 'tipo', label: 'Tipo', render: r => r.tipo[0].toUpperCase() + r.tipo.slice(1) },
        ]} rows={db.pianoConti && db.pianoConti.length ? db.pianoConti : PIANO_CONTI} keyField="codice" />
      )}

      {(tab === 'primanota' || tab === 'giornale') && (
        <DataTable columns={[
          { key: 'data', label: 'Data', render: r => formatDate(r.data) },
          { key: 'descrizione', label: 'Descrizione' },
          { key: 'riferimento', label: 'Riferimento' },
          { key: 'dare', label: 'Dare', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.dare, 0)) },
          { key: 'avere', label: 'Avere', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.avere, 0)) },
        ]} rows={[...db.movimenti].sort((a, b) => b.data.localeCompare(a.data))} empty="Nessuna registrazione contabile." />
      )}

      {tab === 'verifica' && (
        <DataTable columns={[
          { key: 'codice', label: 'Conto', render: r => `${r.codice} — ${r.nome}` },
          { key: 'dare', label: 'Totale dare', align: 'right', mono: true, render: r => formatEUR(r.dare) },
          { key: 'avere', label: 'Totale avere', align: 'right', mono: true, render: r => formatEUR(r.avere) },
          { key: 'saldo', label: 'Saldo', align: 'right', mono: true, render: r => `${formatEUR(Math.abs(r.saldo))} ${r.lato === 'dare' ? 'D' : 'A'}` },
        ]} rows={verifica} keyField="codice" />
      )}

      {tab === 'economico' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <p className="text-sm font-medium text-emerald-700 mb-3">Ricavi</p>
            <ul className="space-y-2 text-sm">
              {economico.ricavi.map(r => <li key={r.codice} className="flex justify-between"><span>{r.nome}</span><span className="font-mono-num">{formatEUR(r.importo)}</span></li>)}
            </ul>
            <div className="mt-3 pt-3 border-t border-stone-200 flex justify-between text-sm font-medium"><span>Totale ricavi</span><span className="font-mono-num">{formatEUR(economico.totRicavi)}</span></div>
          </Card>
          <Card>
            <p className="text-sm font-medium text-red-700 mb-3">Costi</p>
            <ul className="space-y-2 text-sm">
              {economico.costi.map(r => <li key={r.codice} className="flex justify-between"><span>{r.nome}</span><span className="font-mono-num">{formatEUR(r.importo)}</span></li>)}
            </ul>
            <div className="mt-3 pt-3 border-t border-stone-200 flex justify-between text-sm font-medium"><span>Totale costi</span><span className="font-mono-num">{formatEUR(economico.totCosti)}</span></div>
          </Card>
          <Card className="md:col-span-2 flex items-center justify-between">
            <span className="font-display text-lg text-stone-900">Utile netto</span>
            <span className={cn('font-display text-2xl', economico.utile >= 0 ? 'text-emerald-700' : 'text-red-700')}>{formatEUR(economico.utile)}</span>
          </Card>
        </div>
      )}

      {tab === 'patrimoniale' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <p className="text-sm font-medium text-stone-700 mb-3">Attività</p>
            <ul className="space-y-2 text-sm">
              {patrimoniale.attivo.map(r => <li key={r.codice} className="flex justify-between"><span>{r.nome}</span><span className="font-mono-num">{formatEUR(r.importo)}</span></li>)}
            </ul>
            <div className="mt-3 pt-3 border-t border-stone-200 flex justify-between text-sm font-medium"><span>Totale attività</span><span className="font-mono-num">{formatEUR(patrimoniale.totAttivo)}</span></div>
          </Card>
          <Card>
            <p className="text-sm font-medium text-stone-700 mb-3">Passività e patrimonio netto</p>
            <ul className="space-y-2 text-sm">
              {patrimoniale.passivo.map(r => <li key={r.codice} className="flex justify-between"><span>{r.nome}</span><span className="font-mono-num">{formatEUR(r.importo)}</span></li>)}
              {patrimoniale.patrimonio.map(r => <li key={r.codice} className="flex justify-between"><span>{r.nome}</span><span className="font-mono-num">{formatEUR(r.importo)}</span></li>)}
              <li className="flex justify-between"><span>Utile dell'esercizio</span><span className="font-mono-num">{formatEUR(patrimoniale.utile)}</span></li>
            </ul>
            <div className="mt-3 pt-3 border-t border-stone-200 flex justify-between text-sm font-medium"><span>Totale passività + PN</span><span className="font-mono-num">{formatEUR(patrimoniale.totPassivo + patrimoniale.totPatrimonio)}</span></div>
          </Card>
          <div className="md:col-span-2 text-center text-xs text-stone-400">
            {patrimoniale.pareggio ? 'Stato patrimoniale in pareggio.' : 'Attenzione: lo stato patrimoniale non è in pareggio.'}
          </div>
        </div>
      )}

      {showNew && <NuovaRegistrazioneModal db={db} setDb={setDb} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function ComodatiView({ db, setDb }) {
  const [subTab, setSubTab] = useState('attrezzature');
  const [newAtt, setNewAtt] = useState(null);
  const [newInt, setNewInt] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const attFields = [
    { name: 'nome', label: 'Nome attrezzatura', full: true },
    { name: 'valore', label: 'Valore comodato (€)', type: 'number' },
    { name: 'clienteId', label: 'Cliente assegnatario', type: 'select', options: db.clienti.map(c => ({ value: c.id, label: c.ragioneSociale })) },
    { name: 'dataConsegna', label: 'Data consegna', type: 'date' },
  ];

  const intFields = [
    { name: 'attrezzaturaId', label: 'Attrezzatura', type: 'select', options: (db.attrezzature||[]).map(a => ({ value: a.id, label: a.nome })) },
    { name: 'data', label: 'Data intervento', type: 'date' },
    { name: 'descrizione', label: 'Descrizione lavori', full: true },
    { name: 'costo', label: 'Costo (€)', type: 'number' },
    { name: 'conto', label: 'Pagato con', type: 'select', options: [{ value: '1002', label: 'Banca c/c' }, { value: '1001', label: 'Cassa' }] },
  ];

  async function salvaAtt(values) {
    const valore = parseFloat(values.valore) || 0;
    setSaving(true);
    try {
      if (newAtt.id) await api.attrezzature.update(newAtt.id, { ...values, valore });
      else await api.attrezzature.create({ ...values, valore });
      const attrezzature = await api.attrezzature.list();
      setDb(d => ({ ...d, attrezzature }));
      setNewAtt(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function salvaInt(values) {
    const costo = parseFloat(values.costo) || 0;
    setSaving(true);
    try {
      await api.interventi.create({ ...values, costo });
      const [interventi, movimenti] = await Promise.all([api.interventi.list(), api.contabilita.movimenti()]);
      setDb(d => ({ ...d, interventi, movimenti }));
      setNewInt(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(a) {
    try {
      await api.attrezzature.remove(a.id);
      const attrezzature = await api.attrezzature.list();
      setDb(d => ({ ...d, attrezzature }));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 rounded-lg bg-amber-100 p-1">
          {[{ id: 'attrezzature', label: 'Attrezzature' }, { id: 'interventi', label: 'Interventi tecnici' }].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', subTab === t.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700')}>
              {t.label}
            </button>
          ))}
        </div>
        {subTab === 'attrezzature' && <Button size="sm" onClick={() => setNewAtt({})}><Plus size={14} /> Nuova attrezzatura</Button>}
        {subTab === 'interventi' && <Button size="sm" onClick={() => setNewInt({})}><Plus size={14} /> Nuovo intervento</Button>}
      </div>

      {subTab === 'attrezzature' && (
        <DataTable
          columns={[
            { key: 'nome', label: 'Attrezzatura' },
            { key: 'clienteId', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
            { key: 'dataConsegna', label: 'Consegna', render: r => formatDate(r.dataConsegna) },
            { key: 'valore', label: 'Valore', align: 'right', mono: true, render: r => formatEUR(r.valore || r.costo) },
          ]}
          rows={db.attrezzature||[]}
          actions={r => (
            <div className="flex gap-1">
              <button onClick={() => setNewAtt(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={14}/></button>
              <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={14}/></button>
            </div>
          )}
          empty="Nessuna attrezzatura in comodato."
        />
      )}

      {subTab === 'interventi' && (
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'att', label: 'Attrezzatura', render: r => (db.attrezzature||[]).find(x=>x.id===r.attrezzaturaId)?.nome || '—' },
            { key: 'descrizione', label: 'Descrizione', render: r => <span className="text-xs text-stone-500">{r.descrizione}</span> },
            { key: 'costo', label: 'Costo', align: 'right', mono: true, render: r => formatEUR(r.costo) },
          ]}
          rows={[...(db.interventi||[])].sort((a,b)=>b.data.localeCompare(a.data))}
          empty="Nessun intervento registrato."
        />
      )}

      {newAtt && <FormModal title={newAtt.id ? 'Modifica attrezzatura' : 'Nuova attrezzatura'} fields={attFields} initial={newAtt.id ? newAtt : { dataConsegna: todayISO() }} onClose={() => setNewAtt(null)} onSave={salvaAtt} saving={saving} />}
      {newInt && <FormModal title="Nuovo intervento tecnico" fields={intFields} initial={{ data: todayISO() }} onClose={() => setNewInt(null)} onSave={salvaInt} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Eliminare "${toDelete.nome}"?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
    </div>
  );
}

function FlottaView({ db, setDb }) {
  const [subTab, setSubTab] = useState('furgoni');
  const [newFurgone, setNewFurgone] = useState(null);
  const [newCosto, setNewCosto] = useState(null);
  const [newGiro, setNewGiro] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const giroFields = [
    { name: 'data', label: 'Data giro', type: 'date' },
    { name: 'furgoneId', label: 'Furgone', type: 'select', options: (db.furgoni||[]).map(f => ({ value: f.id, label: `${f.targa} — ${f.modello}` })) },
    { name: 'zona', label: 'Zona' },
    { name: 'note', label: 'Note', full: true },
  ];

  async function salvaGiro(values) {
    setSaving(true);
    try {
      await api.giriConsegna.create(values);
      const giriConsegna = await api.giriConsegna.list();
      setDb(d => ({ ...d, giriConsegna }));
      setNewGiro(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const furgoneFields = [
    { name: 'targa', label: 'Targa' },
    { name: 'modello', label: 'Modello' },
    { name: 'kmAttuali', label: 'Km attuali', type: 'number' },
  ];

  const costoFields = [
    { name: 'furgoneId', label: 'Furgone', type: 'select', options: (db.furgoni||[]).map(f => ({ value: f.id, label: `${f.targa} — ${f.modello}` })) },
    { name: 'data', label: 'Data', type: 'date' },
    { name: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'carburante', label: 'Carburante' }, { value: 'manutenzione', label: 'Manutenzione' }, { value: 'riparazione', label: 'Riparazione' }, { value: 'assicurazione', label: 'Assicurazione' }, { value: 'bollo', label: 'Bollo' }] },
    { name: 'descrizione', label: 'Descrizione', full: true },
    { name: 'costo', label: 'Costo (€)', type: 'number' },
  ];

  async function salvaFurgone(values) {
    setSaving(true);
    try {
      if (newFurgone.id) await api.furgoni.update(newFurgone.id, values);
      else await api.furgoni.create(values);
      const furgoni = await api.furgoni.list();
      setDb(d => ({ ...d, furgoni }));
      setNewFurgone(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function salvaCosto(values) {
    const costo = parseFloat(values.costo) || 0;
    setSaving(true);
    try {
      await api.costiMezzo.create({ ...values, costo });
      const [costiMezzo, movimenti] = await Promise.all([api.costiMezzo.list(), api.contabilita.movimenti()]);
      setDb(d => ({ ...d, costiMezzo, movimenti }));
      setNewCosto(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(f) {
    try {
      await api.furgoni.remove(f.id);
      const furgoni = await api.furgoni.list();
      setDb(d => ({ ...d, furgoni }));
    } catch (e) {
      alert(e.message);
    }
  }

  const tipoBadge = (tipo) => {
    const t = { carburante: 'info', manutenzione: 'neutral', riparazione: 'warning', assicurazione: 'danger', bollo: 'danger' };
    return <Badge tone={t[tipo]||'neutral'}>{tipo}</Badge>;
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 rounded-lg bg-amber-100 p-1">
          {[{ id: 'furgoni', label: 'Furgoni' }, { id: 'costi', label: 'Costi mezzo' }, { id: 'giri', label: 'Giri di consegna' }].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', subTab === t.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700')}>
              {t.label}
            </button>
          ))}
        </div>
        {subTab === 'furgoni' && <Button size="sm" onClick={() => setNewFurgone({})}><Plus size={14} /> Nuovo furgone</Button>}
        {subTab === 'costi' && <Button size="sm" onClick={() => setNewCosto({})}><Plus size={14} /> Nuovo costo</Button>}
        {subTab === 'giri' && <Button size="sm" onClick={() => setNewGiro({})}><Plus size={14} /> Nuovo giro</Button>}
      </div>

      {subTab === 'furgoni' && (
        <DataTable
          columns={[
            { key: 'targa', label: 'Targa', mono: true },
            { key: 'modello', label: 'Modello' },
            { key: 'kmAttuali', label: 'Km', align: 'right', mono: true },
            { key: 'costi', label: 'Costi totali', align: 'right', mono: true, render: r => formatEUR(costiTotaliFurgone(db, r.id)) },
          ]}
          rows={db.furgoni||[]}
          actions={r => (
            <div className="flex gap-1">
              <button onClick={() => setNewFurgone(r)} className="p-1.5 text-stone-400 hover:text-orange-700"><Pencil size={14}/></button>
              <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={14}/></button>
            </div>
          )}
          empty="Nessun furgone in flotta."
        />
      )}

      {subTab === 'costi' && (
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'furgone', label: 'Furgone', render: r => { const f = (db.furgoni||[]).find(x=>x.id===r.furgoneId); return f ? f.targa : '—'; }},
            { key: 'tipo', label: 'Tipo', render: r => tipoBadge(r.tipo) },
            { key: 'costo', label: 'Costo', align: 'right', mono: true, render: r => formatEUR(r.importo) },
          ]}
          rows={[...(db.costiMezzo||[])].sort((a,b)=>b.data.localeCompare(a.data))}
          empty="Nessun costo registrato."
        />
      )}

      {subTab === 'giri' && (
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'furgone', label: 'Furgone', render: r => { const f = (db.furgoni||[]).find(x=>x.id===r.furgoneId); return f ? f.targa : '—'; }},
            { key: 'zona', label: 'Zona' },
            { key: 'note', label: 'Note', render: r => <span className="text-xs text-stone-500">{r.note}</span> },
          ]}
          rows={[...(db.giriConsegna||[])].sort((a,b)=>b.data.localeCompare(a.data))}
          empty="Nessun giro di consegna registrato."
        />
      )}

      {newFurgone && <FormModal title={newFurgone.id ? 'Modifica furgone' : 'Nuovo furgone'} fields={furgoneFields} initial={newFurgone.id ? newFurgone : {}} onClose={() => setNewFurgone(null)} onSave={salvaFurgone} saving={saving} />}
      {newCosto && <FormModal title="Nuovo costo mezzo" fields={costoFields} initial={{ data: todayISO(), tipo: 'carburante' }} onClose={() => setNewCosto(null)} onSave={salvaCosto} saving={saving} />}
      {newGiro && <FormModal title="Nuovo giro di consegna" fields={giroFields} initial={{ data: todayISO() }} onClose={() => setNewGiro(null)} onSave={salvaGiro} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Eliminare il furgone ${toDelete.targa}?`} onClose={() => setToDelete(null)} onConfirm={() => handleDelete(toDelete)} />}
    </div>
  );
}

function InsolutiView({ db, setDb }) {
  const [sollecitoTarget, setSollecitoTarget] = useState(null);
  const [sollForm, setSollForm] = useState({ canale: 'telefono', note: '' });
  const [azioneTarget, setAzioneTarget] = useState(null);
  const [importoAzione, setImportoAzione] = useState('');
  const [contoAzione, setContoAzione] = useState('1002');
  const oggi = todayISO();

  const fattureIdonee = db.fatture.filter(f => fatturaEIdoneaAdInsoluto(f, oggi) && !(db.insoluti||[]).some(i => i.fatturaId === f.id));

  async function apriInsoluto(fattura) {
    try {
      await api.insoluti.create({ fatturaId: fattura.id, data: oggi, note: '' });
      const insoluti = await api.insoluti.list();
      setDb(d => ({ ...d, insoluti }));
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  async function salvaSollecito() {
    try {
      await api.insoluti.sollecito(sollecitoTarget.id, { data: oggi, ...sollForm });
      alert('Sollecito registrato.');
      setSollecitoTarget(null); setSollForm({ canale: 'telefono', note: '' });
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  async function confermaAzione() {
    const imp = parseFloat(importoAzione);
    if (!imp || imp <= 0) return;
    try {
      await api.insoluti.azione(azioneTarget.insoluto.id, { tipo: azioneTarget.tipo, importo: imp, data: oggi, conto: contoAzione });
      const [insoluti, movimenti] = await Promise.all([api.insoluti.list(), api.contabilita.movimenti()]);
      setDb(d => ({ ...d, insoluti, movimenti }));
      setAzioneTarget(null); setImportoAzione('');
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  const insolutiAperti = (db.insoluti||[]).filter(i => !i.risolto);

  function residuoFatturaInsoluto(db, insoluto) {
    const f = db.fatture.find(x => x.id === insoluto.fatturaId);
    return f ? residuoFattura(db, f) : 0;
  }

  const totaleInsoluti = insolutiAperti.reduce((s, i) => s + residuoFatturaInsoluto(db, i), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Insoluti aperti" value={insolutiAperti.length} tone={insolutiAperti.length ? 'danger' : 'default'} />
        <StatCard icon={Wallet} label="Totale da recuperare" value={formatEUR(totaleInsoluti)} />
        <StatCard icon={Users} label="Clienti coinvolti" value={new Set(insolutiAperti.map(i=>i.fatturaId)).size} />
      </div>

      {fattureIdonee.length > 0 && (
        <div>
          <p className="text-sm font-medium text-stone-600 mb-3">Fatture scadute da oltre {GIORNI_SOGLIA_INSOLUTO} giorni</p>
          <DataTable
            columns={[
              { key: 'numero', label: 'Fattura', mono: true },
              { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c=>c.id===r.clienteId)?.ragioneSociale },
              { key: 'scadenza', label: 'Scadenza', render: r => formatDate(r.scadenza) },
              { key: 'residuo', label: 'Residuo', align: 'right', mono: true, render: r => formatEUR(residuoFattura(db, r)) },
            ]}
            rows={fattureIdonee}
            actions={r => <Button size="sm" variant="danger" onClick={() => apriInsoluto(r)}>Segna insoluto</Button>}
          />
        </div>
      )}

      <div>
        <p className="text-sm font-medium text-stone-600 mb-3">Registro insoluti</p>
        <DataTable
          columns={[
            { key: 'data', label: 'Aperto il', render: r => formatDate(r.data) },
            { key: 'fattura', label: 'Fattura', render: r => db.fatture.find(f=>f.id===r.fatturaId)?.numero || r.fatturaId },
            { key: 'residuo', label: 'Residuo', align: 'right', mono: true, render: r => formatEUR(residuoFatturaInsoluto(db, r)) },
            { key: 'solleciti', label: 'Solleciti', align: 'right', render: r => '—' },
            { key: 'stato', label: 'Stato', render: r => <Badge tone={r.risolto ? 'success' : 'danger'}>{r.risolto ? 'risolto' : 'aperto'}</Badge> },
          ]}
          rows={[...(db.insoluti||[])].sort((a,b)=>b.data.localeCompare(a.data))}
          actions={r => !r.risolto ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSollecitoTarget(r)}>Sollecito</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAzioneTarget({ insoluto: r, tipo: 'recupero' }); setImportoAzione(''); }}>Recupero</Button>
              <Button size="sm" variant="danger" onClick={() => { setAzioneTarget({ insoluto: r, tipo: 'perdita' }); setImportoAzione(String(residuoFatturaInsoluto(db, r))); }}>Perdita</Button>
            </div>
          ) : null}
          empty="Nessun insoluto registrato."
        />
      </div>

      {sollecitoTarget && (
        <Modal title="Registra sollecito (locale)" onClose={() => setSollecitoTarget(null)}>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Canale</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={sollForm.canale} onChange={e=>setSollForm(f=>({...f,canale:e.target.value}))}>
                <option value="telefono">Telefono</option><option value="email">Email</option><option value="pec">PEC</option><option value="visita">Visita di persona</option>
              </select></div>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Note</label>
              <textarea rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={sollForm.note} onChange={e=>setSollForm(f=>({...f,note:e.target.value}))} /></div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSollecitoTarget(null)}>Annulla</Button><Button onClick={salvaSollecito}>Registra</Button></div>
          </div>
        </Modal>
      )}

      {azioneTarget && (
        <Modal title={azioneTarget.tipo === 'perdita' ? 'Registra perdita su crediti' : 'Registra recupero'} onClose={() => setAzioneTarget(null)}>
          <div className="space-y-3">
            <p className="text-sm text-stone-500">Residuo attuale: {formatEUR(residuoFatturaInsoluto(db, azioneTarget.insoluto))}</p>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Importo (€)</label>
              <input type="number" step="0.01" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={importoAzione} onChange={e=>setImportoAzione(e.target.value)} /></div>
            {azioneTarget.tipo === 'recupero' && (
              <div><label className="block text-xs font-medium text-stone-500 mb-1">Conto</label>
                <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={contoAzione} onChange={e=>setContoAzione(e.target.value)}>
                  <option value="1002">Banca c/c</option><option value="1001">Cassa</option>
                </select></div>
            )}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAzioneTarget(null)}>Annulla</Button><Button onClick={confermaAzione}>Conferma</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CentriCostoView({ db, setDb }) {
  const cc = useMemo(() => calcolaCentriCosto(db.movimenti), [db.movimenti]);
  const ebitda = useMemo(() => calcolaEBITDA(db), [db.movimenti, db.attrezzature]);
  const ammMese = useMemo(() => ammortamentoMensileTotale(db), [db.attrezzature]);
  const maxImporto = Math.max(1, ...cc.rows.map(r => r.importo));
  const [registrando, setRegistrando] = useState(false);
  const meseCorrente = todayISO().slice(0, 7);
  const giaRegistrato = (db.ammortamentiMesi || []).includes(meseCorrente);

  async function registraAmmortamento() {
    setRegistrando(true);
    try {
      const res = await api.ammortamenti.registra({ mese: meseCorrente });
      if (res.importo > 0) alert(`Ammortamento registrato: ${formatEUR(res.importo)}`);
      else alert('Nessun ammortamento da registrare (nessuna attrezzatura in comodato).');
      const [movimenti, ammortamentiMesi] = await Promise.all([api.contabilita.movimenti(), api.ammortamenti.list()]);
      setDb(d => ({ ...d, movimenti, ammortamentiMesi: ammortamentiMesi.map(r => r.mese) }));
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Ricavi totali" value={formatEUR(ebitda.ricavi)} />
        <StatCard icon={Calculator} label="Utile netto" value={formatEUR(ebitda.utileNetto)} />
        <StatCard icon={Wallet} label="Ammortamenti registrati" value={formatEUR(ebitda.ammortamenti)} />
        <StatCard icon={TrendingUp} label="EBITDA" value={formatEUR(ebitda.ebitda)} sub={`Margine ${ebitda.margine}%`} />
      </div>

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-medium text-stone-700">Ammortamento attrezzature in comodato</p>
            <p className="text-xs text-stone-400 mt-1">Quota mensile stimata: {formatEUR(ammMese)} (durata {DURATA_AMMORTAMENTO_ANNI} anni, quote costanti)</p>
          </div>
          {giaRegistrato
            ? <Badge tone="success">Mese corrente già registrato</Badge>
            : <Button size="sm" onClick={registraAmmortamento} disabled={registrando}>{registrando ? 'Registrazione…' : `Registra ammortamento ${monthLabel(meseCorrente+'-01')}`}</Button>}
        </div>
      </Card>

      <div>
        <p className="text-sm font-medium text-stone-600 mb-3">Costi per centro di costo</p>
        <Card>
          <div className="space-y-3">
            {cc.rows.map(r => (
              <div key={r.centro}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-stone-700">{r.centro}</span>
                  <span className="font-mono-num">{formatEUR(r.importo)} <span className="text-xs text-stone-400">({cc.totale>0?Math.round(r.importo/cc.totale*100):0}%)</span></span>
                </div>
                <div className="h-2 rounded-full bg-amber-100">
                  <div className="h-2 rounded-full bg-orange-700" style={{ width: `${(r.importo/maxImporto)*100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-stone-200 flex justify-between text-sm font-medium">
            <span>Totale costi ripartiti</span><span className="font-mono-num">{formatEUR(cc.totale)}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ScadenzarioView({ db }) {
  const oggi = todayISO();
  const fattureAperte = db.fatture.filter(f => f.stato !== 'pagata');
  const conGiorni = fattureAperte.map(f => ({ ...f, giorni: f.scadenza ? Math.floor((new Date(f.scadenza) - new Date(oggi)) / 86400000) : 0, residuo: residuoFattura(db, f) }))
    .sort((a,b) => a.giorni - b.giorni);
  const scadute = conGiorni.filter(f => f.giorni < 0);
  const entro7 = conGiorni.filter(f => f.giorni >= 0 && f.giorni <= 7);
  const entro30 = conGiorni.filter(f => f.giorni > 7 && f.giorni <= 30);
  const oltre30 = conGiorni.filter(f => f.giorni > 30);

  const sezione = (titolo, rows, tone) => rows.length > 0 && (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3"><p className="text-sm font-medium text-stone-600">{titolo}</p><Badge tone={tone}>{rows.length}</Badge></div>
      <DataTable
        columns={[
          { key: 'numero', label: 'Fattura', mono: true },
          { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c=>c.id===r.clienteId)?.ragioneSociale },
          { key: 'scadenza', label: 'Scadenza', render: r => formatDate(r.scadenza) },
          { key: 'giorni', label: 'Giorni', align: 'right', render: r => <span className={r.giorni<0?'text-red-700 font-medium':''}>{r.giorni<0?`${Math.abs(r.giorni)} gg fa`:`tra ${r.giorni} gg`}</span> },
          { key: 'residuo', label: 'Residuo', align: 'right', mono: true, render: r => formatEUR(r.residuo) },
        ]}
        rows={rows}
      />
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={AlertTriangle} label="Scadute" value={scadute.length} tone={scadute.length?'danger':'default'} />
        <StatCard icon={Wallet} label="Entro 7 giorni" value={entro7.length} />
        <StatCard icon={Wallet} label="Entro 30 giorni" value={entro30.length} />
        <StatCard icon={TrendingUp} label="Totale da incassare" value={formatEUR(conGiorni.reduce((s,f)=>s+f.residuo,0))} />
      </div>
      {sezione('Scadute', scadute, 'danger')}
      {sezione('In scadenza entro 7 giorni', entro7, 'warning')}
      {sezione('In scadenza entro 30 giorni', entro30, 'info')}
      {sezione('Oltre 30 giorni', oltre30, 'neutral')}
      {!conGiorni.length && <EmptyState text="Nessuna fattura aperta." />}
    </div>
  );
}

function toCSV(rows, columns) {
  const header = columns.map(c => `"${c.label}"`).join(';');
  const body = rows.map(r => columns.map(c => {
    let v = c.get ? c.get(r) : r[c.key];
    if (v === null || v === undefined) v = '';
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(';')).join('\n');
  return header + '\n' + body;
}

function downloadCSV(filename, csvContent) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ExportView({ db }) {
  const exports = [
    { id: 'clienti', label: 'Anagrafica clienti', run: () => toCSV(db.clienti, [
      { label: 'Ragione sociale', key: 'ragioneSociale' }, { label: 'P.IVA', key: 'piva' }, { label: 'Città', key: 'citta' },
      { label: 'Indirizzo', key: 'indirizzo' }, { label: 'Telefono', key: 'telefono' }, { label: 'Email', key: 'email' },
      { label: 'Pagamento', key: 'pagamento' }, { label: 'Fido', key: 'fido' },
    ]) },
    { id: 'fatture', label: 'Fatture emesse', run: () => toCSV(db.fatture, [
      { label: 'Numero', key: 'numero' }, { label: 'Data', key: 'data' },
      { label: 'Cliente', get: r => db.clienti.find(c=>c.id===r.clienteId)?.ragioneSociale || '' },
      { label: 'Imponibile', key: 'imponibile' }, { label: 'IVA', key: 'iva' }, { label: 'Totale', key: 'totale' },
      { label: 'Scadenza', key: 'scadenza' }, { label: 'Stato', key: 'stato' },
    ]) },
    { id: 'movimenti', label: 'Libro giornale (movimenti contabili)', run: () => {
      const flat = [];
      db.movimenti.forEach(m => m.righe.forEach(r => flat.push({ data: m.data, descrizione: m.descrizione, riferimento: m.riferimento, conto: r.conto, dare: r.dare, avere: r.avere })));
      return toCSV(flat, [{ label:'Data', key:'data'}, { label:'Descrizione', key:'descrizione'}, { label:'Riferimento', key:'riferimento'}, { label:'Conto', key:'conto'}, { label:'Dare', key:'dare'}, { label:'Avere', key:'avere'}]);
    } },
    { id: 'ordini', label: 'Ordini clienti', run: () => toCSV(db.ordini, [
      { label: 'ID', key: 'id' }, { label: 'Data', key: 'data' },
      { label: 'Cliente', get: r => db.clienti.find(c=>c.id===r.clienteId)?.ragioneSociale || '' },
      { label: 'Agente', get: r => { const a = db.agenti.find(x=>x.id===r.agenteId); return a ? `${a.nome} ${a.cognome}` : ''; } },
      { label: 'Totale', get: r => r.righe.reduce((s,x)=>s+x.quantita*x.prezzoUnitario,0).toFixed(2) },
      { label: 'Stato', key: 'stato' },
    ]) },
    { id: 'prodotti', label: 'Magazzino prodotti', run: () => toCSV(db.prodotti, [
      { label: 'Nome', key: 'nome' }, { label: 'Categoria', key: 'categoria' }, { label: 'Formato', key: 'formato' },
      { label: 'Prezzo', key: 'prezzo' }, { label: 'Costo', key: 'costo' }, { label: 'Scorta', key: 'scorta' }, { label: 'Scorta minima', key: 'scortaMinima' },
    ]) },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500 mb-4">Esporta i dati in formato CSV, pronti da aprire in Excel o da inviare al commercialista.</p>
      {exports.map(e => (
        <Card key={e.id} className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">{e.label}</span>
          <Button size="sm" onClick={() => downloadCSV(`nicocaffe-${e.id}-${todayISO()}.csv`, e.run())}>Scarica CSV</Button>
        </Card>
      ))}
    </div>
  );
}

function ReportisticaView({ db }) {
  const fatture = db.fatture;
  const marginalitaAgente = db.agenti.map(a => {
    const fat = fatture.filter(f => f.agenteId === a.id);
    const ricavi = fat.reduce((s, f) => s + f.imponibile, 0);
    const provv = calcoloProvvigioneAgente(a, ricavi);
    return { id: a.id, nome: `${a.nome} ${a.cognome}`, zona: a.zona, ricavi, provvigione: provv.totale, margine: Math.round((ricavi - provv.totale) * 100) / 100, ordini: db.ordini.filter(o=>o.agenteId===a.id).length };
  }).sort((a, b) => b.ricavi - a.ricavi);

  const marginalitaProdotto = db.prodotti.map(p => {
    const unita = fatture.reduce((s, f) => s + (f.righe||[]).filter(r => r.prodottoId === p.id).reduce((s2, r) => s2 + r.quantita, 0), 0);
    const ricavi = Math.round(unita * p.prezzo * 100) / 100;
    const costi = Math.round(unita * p.costo * 100) / 100;
    const margPct = p.prezzo > 0 ? Math.round((p.prezzo - p.costo) / p.prezzo * 100) : 0;
    return { id: p.id, nome: p.nome, categoria: p.categoria, unita, ricavi, costi, margPct };
  }).sort((a, b) => b.ricavi - a.ricavi);

  const chartAgenti = marginalitaAgente.map(a => ({ nome: a.nome.split(' ')[0], ricavi: Math.round(a.ricavi), margine: Math.round(a.margine) }));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-stone-600 mb-4">Performance agenti</p>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartAgenti}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EAE2D2" vertical={false} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#A8845F' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#A8845F' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => formatEUR(v)} />
              <Bar dataKey="ricavi" name="Ricavi" fill="#C2622F" radius={[3,3,0,0]} />
              <Bar dataKey="margine" name="Margine netto provv." fill="#D9B68C" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <DataTable
          columns={[
            { key: 'nome', label: 'Agente' }, { key: 'zona', label: 'Zona' },
            { key: 'ricavi', label: 'Ricavi generati', align: 'right', mono: true, render: r => formatEUR(r.ricavi) },
            { key: 'provvigione', label: 'Provvigioni', align: 'right', mono: true, render: r => formatEUR(r.provvigione) },
            { key: 'margine', label: 'Margine (al netto)', align: 'right', mono: true, render: r => formatEUR(r.margine) },
          ]}
          rows={marginalitaAgente}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-stone-600 mb-4">Marginalità prodotto</p>
        <DataTable
          columns={[
            { key: 'nome', label: 'Prodotto', render: r => <div><div>{r.nome}</div><div className="text-xs text-stone-400">{r.categoria}</div></div> },
            { key: 'unita', label: 'Unità vendute', align: 'right', mono: true },
            { key: 'ricavi', label: 'Ricavi', align: 'right', mono: true, render: r => formatEUR(r.ricavi) },
            { key: 'costi', label: 'Costo prod.', align: 'right', mono: true, render: r => formatEUR(r.costi) },
            { key: 'margPct', label: 'Margine %', align: 'right', render: r => <span className={cn('font-mono-num text-xs font-medium', r.margPct>40?'text-emerald-700':r.margPct>25?'text-amber-700':'text-red-700')}>{r.margPct}%</span> },
          ]}
          rows={marginalitaProdotto}
        />
      </div>
    </div>
  );
}

function VisiteView({ db, setDb }) {
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const visite = [...(db.visite || [])].sort((a, b) => b.data.localeCompare(a.data));
  const visitaFields = [
    { name: 'agenteId', label: 'Agente', type: 'select', options: db.agenti.map(a => ({ value: a.id, label: `${a.nome} ${a.cognome}` })) },
    { name: 'clienteId', label: 'Cliente', type: 'select', options: db.clienti.map(c => ({ value: c.id, label: c.ragioneSociale })) },
    { name: 'data', label: 'Data visita', type: 'date' },
    { name: 'prossimaVisita', label: 'Prossima visita', type: 'date' },
    { name: 'esito', label: 'Note / esito', full: true },
  ];
  async function salvaVisita(values) {
    setSaving(true);
    try {
      await api.visite.create(values);
      const visite = await api.visite.list();
      setDb(d => ({ ...d, visite }));
      setShowNew(false);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  const oggi = todayISO();
  const prossimiGiri = visite.filter(v => v.prossimaVisita && v.prossimaVisita >= oggi).sort((a, b) => a.prossimaVisita.localeCompare(b.prossimaVisita));
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Button onClick={() => setShowNew(true)}><Plus size={15} /> Nuova visita</Button></div>
      {prossimiGiri.length > 0 && (
        <div>
          <p className="text-sm font-medium text-stone-600 mb-3">Prossimi giri pianificati</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {prossimiGiri.slice(0, 6).map(v => {
              const ag = db.agenti.find(a => a.id === v.agenteId);
              const cl = db.clienti.find(c => c.id === v.clienteId);
              return (
                <Card key={v.id} className="text-sm">
                  <p className="font-medium">{formatDate(v.prossimaVisita)}</p>
                  <p className="text-stone-500 text-xs mt-1">{ag?.nome} {ag?.cognome} → {cl?.ragioneSociale}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-stone-600 mb-3">Storico visite</p>
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'agente', label: 'Agente', render: r => { const a = db.agenti.find(x => x.id === r.agenteId); return a ? `${a.nome} ${a.cognome}` : '—'; }},
            { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
            { key: 'esito', label: 'Note', render: r => <span className="text-stone-500 text-xs line-clamp-2">{r.esito}</span> },
            { key: 'prossimaVisita', label: 'Prossima', render: r => r.prossimaVisita ? <span className={r.prossimaVisita < oggi ? 'text-red-700' : ''}>{formatDate(r.prossimaVisita)}</span> : '—' },
          ]}
          rows={visite}
          empty="Nessuna visita registrata."
        />
      </div>
      {showNew && <FormModal title="Nuova visita" fields={visitaFields} initial={{ data: todayISO() }} onClose={() => setShowNew(false)} onSave={salvaVisita} saving={saving} />}
    </div>
  );
}

function ComunicazioniView({ db, setDb }) {
  const [showNew, setShowNew] = useState(false);
  const [titolo, setTitolo] = useState('');
  const [messaggio, setMessaggio] = useState('');
  const [saving, setSaving] = useState(false);
  async function invia() {
    if (!titolo || !messaggio) return;
    setSaving(true);
    try {
      await api.comunicazioni.create({ data: todayISO(), titolo, messaggio });
      const comunicazioni = await api.comunicazioni.list();
      setDb(d => ({ ...d, comunicazioni }));
      setTitolo(''); setMessaggio(''); setShowNew(false);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  async function elimina(c) {
    try {
      await api.comunicazioni.remove(c.id);
      const comunicazioni = await api.comunicazioni.list();
      setDb(d => ({ ...d, comunicazioni }));
    } catch (e) {
      alert(e.message);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button onClick={() => setShowNew(true)}><Plus size={15} /> Nuova comunicazione</Button></div>
      <div className="space-y-3">
        {[...(db.comunicazioni || [])].reverse().map(c => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-stone-800">{c.titolo || c.oggetto}</p>
                <p className="text-xs text-stone-400 mt-0.5">{formatDate(c.data)}</p>
                <p className="text-sm text-stone-600 mt-2">{c.messaggio || c.corpo}</p>
              </div>
              <button onClick={() => elimina(c)} className="text-stone-300 hover:text-red-700 shrink-0"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
        {!(db.comunicazioni||[]).length && <EmptyState text="Nessuna comunicazione inviata." />}
      </div>
      {showNew && (
        <Modal title="Nuova comunicazione agli agenti" onClose={() => setShowNew(false)}>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Titolo</label><input className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={titolo} onChange={e => setTitolo(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Messaggio</label><textarea rows={4} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={messaggio} onChange={e => setMessaggio(e.target.value)} /></div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowNew(false)}>Annulla</Button><Button onClick={invia} disabled={saving}>{saving ? 'Invio…' : 'Invia'}</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UtentiView({ db, setDb }) {
  const [showNew, setShowNew] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const ruoli = ['Amministratore', 'Contabile'];
  const uFields = [
    { name: 'nome', label: 'Nome' }, { name: 'cognome', label: 'Cognome' },
    { name: 'email', label: 'Email', full: true },
    { name: 'ruolo', label: 'Ruolo', type: 'select', options: ruoli.map(r => ({ value: r, label: r })) },
  ];
  async function salva(values) {
    setSaving(true);
    try {
      const res = await api.utenti.create(values);
      alert(`Utente creato. Password provvisoria: ${res.passwordProvvisoria}`);
      const utenti = await api.utenti.list();
      setDb(d => ({ ...d, utenti }));
      setShowNew(false);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }
  async function elimina(u) {
    try {
      await api.utenti.remove(u.id);
      const utenti = await api.utenti.list();
      setDb(d => ({ ...d, utenti }));
    } catch (e) {
      alert(e.message);
    }
  }
  const ruleTones = { Amministratore: 'danger', Contabile: 'info' };
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setShowNew(true)}><Plus size={15} /> Nuovo utente</Button></div>
      <DataTable
        columns={[
          { key: 'nome', label: 'Utente', render: r => `${r.nome} ${r.cognome}` },
          { key: 'email', label: 'Email' },
          { key: 'ruolo', label: 'Ruolo', render: r => <Badge tone={ruleTones[r.ruolo]||'neutral'}>{r.ruolo}</Badge> },
        ]}
        rows={db.utenti || []}
        actions={r => (
          <button onClick={() => setToDelete(r)} className="p-1.5 text-stone-400 hover:text-red-700"><Trash2 size={15} /></button>
        )}
        empty="Nessun utente."
      />
      {showNew && <FormModal title="Nuovo utente" fields={uFields} initial={{}} onClose={() => setShowNew(false)} onSave={salva} saving={saving} />}
      {toDelete && <ConfirmDialog text={`Disattivare l'utente ${toDelete.nome} ${toDelete.cognome}?`} onClose={() => setToDelete(null)} onConfirm={() => elimina(toDelete)} />}
    </div>
  );
}

function ProvvigioniView({ db }) {
  const righe = db.agenti.map(a => {
    const fatture = db.fatture.filter(f => f.agenteId === a.id);
    const fatturato = fatture.reduce((s, f) => s + f.imponibile, 0);
    const daRegistrare = fatture.filter(f => !f.provvigioneRegistrata);
    const provvMaturata = calcoloProvvigioneAgente(a, fatturato);
    const provvDaRegistrare = daRegistrare.reduce((s, f) => s + f.imponibile, 0);
    const provvImporto = Math.round(provvDaRegistrare * provvMaturata.perc / 100 * 100) / 100;
    return { id: a.id, agente: a, fatturato, provvMaturata, provvImporto };
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-amber-100 px-4 py-2 text-xs text-stone-500">La registrazione del costo provvigioni si fa dalla vista "Agenti" (pulsante "Provvigione" su ogni riga).</div>
      <DataTable
        columns={[
          { key: 'agente', label: 'Agente', render: r => <div><div>{r.agente.nome} {r.agente.cognome}</div><div className="text-xs text-stone-400">{r.agente.zona}</div></div> },
          { key: 'fatturato', label: 'Fatturato', align: 'right', mono: true, render: r => formatEUR(r.fatturato) },
          { key: 'target', label: 'Target / avanz.', render: r => {
            const pct = r.agente.target ? Math.min(100, Math.round(r.fatturato / r.agente.target * 100)) : 0;
            return <div className="w-32"><div className="flex justify-between text-xs mb-0.5"><span className="font-mono-num">{pct}%</span><span className="text-stone-400">{formatEUR(r.agente.target)}</span></div><div className="h-1.5 bg-amber-100 rounded-full"><div className={cn('h-1.5 rounded-full', r.provvMaturata.targetRaggiunto ? 'bg-emerald-600' : 'bg-orange-700')} style={{width:`${pct}%`}} /></div></div>;
          }},
          { key: 'perc', label: 'Scaglione attivo', render: r => <span className="text-sm">{r.provvMaturata.perc}%{r.provvMaturata.targetRaggiunto ? <span className="ml-1 text-emerald-600 text-xs">+bonus {formatEUR(r.provvMaturata.bonus)}</span> : ''}</span> },
          { key: 'totale', label: 'Provvigione maturata', align: 'right', mono: true, render: r => formatEUR(r.provvMaturata.totale) },
          { key: 'davere', label: 'Da registrare', align: 'right', mono: true, render: r => formatEUR(r.provvImporto) },
        ]}
        rows={righe}
      />
    </div>
  );
}

function AgentDashboard({ agente, clienti, ordini, db }) {
  const meseCorrente = todayISO().slice(0, 7);
  const ordiniMese = ordini.filter(o => o.data.slice(0, 7) === meseCorrente);
  const totaleMese = ordiniMese.reduce((s, o) => s + o.righe.reduce((s2, r) => s2 + r.quantita * r.prezzoUnitario, 0), 0);
  const totaleFatturato = db.fatture.filter(f => f.agenteId === agente.id).reduce((s, f) => s + f.imponibile, 0);
  const provv = calcoloProvvigioneAgente(agente, totaleFatturato);
  const pctTarget = agente.target ? Math.min(100, Math.round(totaleFatturato / agente.target * 100)) : 0;
  const comunicazioni = [...(db.comunicazioni || [])].reverse().slice(0, 3);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Miei clienti" value={clienti.length} />
        <StatCard icon={ShoppingCart} label="Ordini questo mese" value={ordiniMese.length} />
        <StatCard icon={TrendingUp} label="Venduto questo mese" value={formatEUR(totaleMese)} />
        <StatCard icon={Wallet} label="Provv. maturata" value={formatEUR(provv.totale)} sub={provv.targetRaggiunto ? `+bonus ${formatEUR(provv.bonus)} ✓` : `target ${pctTarget}%`} />
      </div>
      {agente.target ? (
        <Card>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">Avanzamento target annuo</span>
            <span className="font-mono-num">{formatEUR(totaleFatturato)} / {formatEUR(agente.target)}</span>
          </div>
          <div className="h-2 rounded-full bg-amber-100">
            <div className={cn('h-2 rounded-full transition-all', pctTarget >= 100 ? 'bg-emerald-600' : 'bg-orange-700')} style={{ width: `${pctTarget}%` }} />
          </div>
          {provv.targetRaggiunto && <p className="text-xs text-emerald-700 mt-1">🎯 Target raggiunto — bonus {formatEUR(provv.bonus)} incluso nella provvigione.</p>}
        </Card>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Ultimi ordini</p>
          <DataTable
            columns={[
              { key: 'data', label: 'Data', render: r => formatDate(r.data) },
              { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
              { key: 'totale', label: 'Totale', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.quantita * x.prezzoUnitario, 0)) },
              { key: 'stato', label: '', render: r => statoOrdineBadge(r.stato) },
            ]}
            rows={[...ordini].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5)}
            empty="Nessun ordine ancora registrato."
          />
        </Card>
        <Card>
          <p className="text-sm font-medium text-stone-600 mb-3">Comunicazioni da Nico Caffè</p>
          {comunicazioni.length ? comunicazioni.map(c => (
            <div key={c.id} className="mb-3 pb-3 border-b border-amber-100 last:border-0">
              <p className="text-sm font-medium text-stone-800">{c.titolo || c.oggetto}</p>
              <p className="text-xs text-stone-400 mt-0.5">{formatDate(c.data)}</p>
              <p className="text-xs text-stone-600 mt-1">{c.messaggio || c.corpo}</p>
            </div>
          )) : <p className="text-sm text-stone-400">Nessuna comunicazione recente.</p>}
        </Card>
      </div>
    </div>
  );
}

function AgentClientiView({ clienti, db }) {
  return (
    <DataTable
      columns={[
        { key: 'ragioneSociale', label: 'Cliente' },
        { key: 'citta', label: 'Città' },
        { key: 'telefono', label: 'Telefono' },
        { key: 'email', label: 'Email' },
        { key: 'scontoPercent', label: 'Sc. %', render: r => r.scontoPercent ? `${r.scontoPercent}%` : '—' },
        { key: 'pagamento', label: 'Pagamento' },
        { key: 'esposizione', label: 'Espos. / Fido', render: r => {
          const esp = esposizioneCliente(db, r.id);
          const danger = r.fido > 0 && esp > r.fido * 0.8;
          return <span className={cn('font-mono-num text-xs', danger ? 'text-red-700' : 'text-stone-500')}>{formatEUR(esp)} / {formatEUR(r.fido)}</span>;
        }},
      ]}
      rows={clienti}
      empty="Non hai ancora clienti assegnati."
    />
  );
}

function AgentNuovoOrdineView({ db, setDb, agente, clienti, onCreated }) {
  const [clienteId, setClienteId] = useState('');
  const [carrello, setCarrello] = useState({});
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  const cliente = db.clienti.find(c => c.id === clienteId);

  function setQta(prodottoId, qta) {
    setCarrello(c => {
      const next = { ...c };
      if (qta <= 0) delete next[prodottoId];
      else next[prodottoId] = qta;
      return next;
    });
  }
  function incrementa(prodottoId) { setQta(prodottoId, (carrello[prodottoId] || 0) + 1); }
  function decrementa(prodottoId) { setQta(prodottoId, (carrello[prodottoId] || 0) - 1); }

  const righeValide = Object.entries(carrello).filter(([, q]) => q > 0).map(([prodottoId, quantita]) => ({ prodottoId, quantita }));
  const totale = righeValide.reduce((s, r) => {
    const p = db.prodotti.find(x => x.id === r.prodottoId);
    return s + (p ? prezzoUnitarioScontato(p, cliente, r.quantita, db.listini) * r.quantita : 0);
  }, 0);
  const numArticoli = righeValide.reduce((s, r) => s + r.quantita, 0);

  const esposizione = clienteId ? esposizioneCliente(db, clienteId) : 0;
  const fidoAlert = cliente && (esposizione + totale) > cliente.fido;

  const prodottiFiltrati = db.prodotti.filter(p => !filtro || p.nome.toLowerCase().includes(filtro.toLowerCase()) || p.categoria.toLowerCase().includes(filtro.toLowerCase()));

  async function submit() {
    setError('');
    if (!clienteId) return setError('Seleziona un cliente.');
    if (!righeValide.length) return setError('Aggiungi almeno un prodotto.');
    if (fidoAlert) return setError(`L'ordine supera il fido cliente (${formatEUR(cliente.fido)}). Chiedi autorizzazione all'amministrazione.`);
    const righeApi = righeValide.map(r => {
      const p = db.prodotti.find(x => x.id === r.prodottoId);
      return { prodottoId: r.prodottoId, quantita: r.quantita, prezzoUnitario: prezzoUnitarioScontato(p, cliente, r.quantita, db.listini) };
    });
    setSaving(true);
    try {
      const ordine = await api.ordini.create({ data: todayISO(), clienteId, agenteId: agente.id, righe: righeApi, stato: 'confermato' });
      const [ordini, prodotti] = await Promise.all([api.ordini.list(), api.prodotti.list()]);
      setDb(d => ({ ...d, ordini, prodotti }));
      setSuccess(ordine);
      setClienteId(''); setCarrello({});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <Card className="max-w-md">
        <div className="flex items-center gap-2 text-emerald-700 mb-2"><Check size={20} /><span className="font-medium text-base">Ordine registrato</span></div>
        <p className="text-sm text-stone-500 mb-4">L'ordine è visibile subito in amministrazione per la fatturazione.</p>
        <div className="flex gap-2">
          <Button size="lg" onClick={() => setSuccess(null)}>Nuovo ordine</Button>
          <Button size="lg" variant="ghost" onClick={onCreated}>Vai ai miei ordini</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="pb-24">
      <div className="mb-4">
        <label className="block text-sm font-medium text-stone-600 mb-1.5">Cliente</label>
        <select className="w-full rounded-lg border border-stone-300 px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-600"
          value={clienteId} onChange={e => { setClienteId(e.target.value); setError(''); }}>
          <option value="">Seleziona cliente…</option>
          {clienti.map(c => <option key={c.id} value={c.id}>{c.ragioneSociale} — {c.citta}</option>)}
        </select>
        {cliente && <p className="text-xs text-stone-400 mt-1.5">Esposizione: {formatEUR(esposizione)} / {formatEUR(cliente.fido)} · Sconto cliente: {cliente.scontoPercent || 0}%</p>}
      </div>

      <input
        placeholder="Cerca prodotto o categoria…"
        className="w-full rounded-lg border border-stone-300 px-4 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-orange-600"
        value={filtro} onChange={e => setFiltro(e.target.value)}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {prodottiFiltrati.map(p => {
          const qta = carrello[p.id] || 0;
          const prezzoScontato = prezzoUnitarioScontato(p, cliente, qta || 1, db.listini);
          const haSconto = prezzoScontato < p.prezzo;
          return (
            <div key={p.id} className={cn('rounded-xl border p-3 flex flex-col', qta > 0 ? 'border-orange-400 bg-orange-50' : 'border-amber-200 bg-white')}>
              <div className="text-sm font-medium text-stone-800 leading-tight">{p.nome}</div>
              <div className="text-xs text-stone-400 mt-0.5">{p.formato}</div>
              <div className="mt-1.5">
                <span className="text-sm font-mono-num text-stone-700">{formatEUR(prezzoScontato)}</span>
                {haSconto && <span className="text-xs text-stone-400 line-through ml-1.5">{formatEUR(p.prezzo)}</span>}
              </div>
              <div className={cn('mt-2 text-xs', p.scorta < p.scortaMinima ? 'text-red-600' : 'text-stone-400')}>Scorta: {p.scorta} {p.unita}</div>
              <div className="mt-3 flex items-center justify-between">
                {qta === 0 ? (
                  <Button className="w-full" onClick={() => incrementa(p.id)}>+ Aggiungi</Button>
                ) : (
                  <div className="flex items-center justify-between w-full gap-1">
                    <button onClick={() => decrementa(p.id)} className="w-10 h-10 flex items-center justify-center rounded-lg bg-stone-900 text-white text-lg font-medium active:bg-stone-700">−</button>
                    <span className="flex-1 text-center font-mono-num text-base font-medium">{qta}</span>
                    <button onClick={() => incrementa(p.id)} className="w-10 h-10 flex items-center justify-center rounded-lg bg-orange-700 text-white text-lg font-medium active:bg-orange-800">+</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!prodottiFiltrati.length && <div className="col-span-full"><EmptyState text="Nessun prodotto trovato." /></div>}
      </div>

      {error && <p className="text-sm text-red-700 mt-4">{error}</p>}
      {fidoAlert && <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 mt-4">⚠ L'ordine supera il fido disponibile ({formatEUR(cliente?.fido)}). Verifica con l'amministrazione.</p>}

      {numArticoli > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-stone-900 text-white px-5 py-4 flex items-center justify-between gap-4 shadow-2xl z-40">
          <div>
            <div className="text-xs text-stone-400">{numArticoli} articoli</div>
            <div className="font-display text-xl">{formatEUR(totale)}</div>
          </div>
          <Button size="lg" className="px-8" onClick={submit} disabled={saving}>{saving ? 'Invio…' : 'Invia ordine'}</Button>
        </div>
      )}
    </div>
  );
}

function AgentOrdiniView({ db, ordini }) {
  const [pdfHtml, setPdfHtml] = useState(null);
  const [pdfNarrow, setPdfNarrow] = useState(false);
  return (
    <div>
      <DataTable
        columns={[
          { key: 'data', label: 'Data', render: r => formatDate(r.data) },
          { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
          { key: 'articoli', label: 'Articoli', align: 'right', render: r => r.righe.length },
          { key: 'totale', label: 'Totale', align: 'right', mono: true, render: r => formatEUR(r.righe.reduce((s, x) => s + x.quantita * x.prezzoUnitario, 0)) },
          { key: 'stato', label: 'Stato', render: r => statoOrdineBadge(r.stato) },
        ]}
        rows={[...ordini].sort((a, b) => b.data.localeCompare(a.data))}
        actions={r => (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setPdfHtml(buildOrdineHTML(r, db)); setPdfNarrow(false); }}>PDF</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPdfHtml(buildBollaHTML(r, db)); setPdfNarrow(true); }}>Bolla</Button>
          </div>
        )}
        empty="Non hai ancora registrato ordini."
      />
      {pdfHtml && <PDFModal html={pdfHtml} onClose={() => setPdfHtml(null)} narrow={pdfNarrow} />}
    </div>
  );
}

function AgentVisiteView({ db, setDb, agente, visite }) {
  const [showNew, setShowNew] = useState(false);
  const [esito, setEsito] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [data, setData] = useState(todayISO());
  const [prossimaVisita, setProssimaVisita] = useState('');
  const [saving, setSaving] = useState(false);
  const miClienti = db.clienti.filter(c => c.agenteId === agente.id);
  const oggi = todayISO();

  async function salva() {
    if (!clienteId || !esito) return;
    setSaving(true);
    try {
      await api.visite.create({ clienteId, data, esito, prossimaVisita });
      const visiteAggiornate = await api.visite.list();
      setDb(d => ({ ...d, visite: visiteAggiornate }));
      setShowNew(false); setEsito(''); setClienteId(''); setProssimaVisita('');
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const prossime = visite.filter(v => v.prossimaVisita && v.prossimaVisita >= oggi)
    .sort((a, b) => a.prossimaVisita.localeCompare(b.prossimaVisita));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setShowNew(true)}><Plus size={15} /> Registra visita</Button>
      </div>
      {prossime.length > 0 && (
        <div>
          <p className="text-sm font-medium text-stone-600 mb-3">Prossimi appuntamenti pianificati</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {prossime.map(v => {
              const cl = db.clienti.find(c => c.id === v.clienteId);
              return (
                <Card key={v.id} className="text-sm">
                  <p className="font-medium text-orange-700">{formatDate(v.prossimaVisita)}</p>
                  <p className="font-medium mt-1">{cl?.ragioneSociale}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{cl?.citta}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-stone-600 mb-3">Storico visite</p>
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'cliente', label: 'Cliente', render: r => db.clienti.find(c => c.id === r.clienteId)?.ragioneSociale },
            { key: 'esito', label: 'Note', render: r => <span className="text-xs text-stone-500">{r.esito}</span> },
            { key: 'prossimaVisita', label: 'Prossima', render: r => r.prossimaVisita ? formatDate(r.prossimaVisita) : '—' },
          ]}
          rows={[...visite].sort((a, b) => b.data.localeCompare(a.data))}
          empty="Nessuna visita registrata."
        />
      </div>
      {showNew && (
        <Modal title="Registra visita" onClose={() => setShowNew(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Cliente</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={clienteId} onChange={e => setClienteId(e.target.value)}>
                <option value="">Seleziona…</option>
                {miClienti.map(c => <option key={c.id} value={c.id}>{c.ragioneSociale}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-stone-500 mb-1">Data visita</label><input type="date" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={data} onChange={e => setData(e.target.value)} /></div>
              <div><label className="block text-xs font-medium text-stone-500 mb-1">Prossima visita</label><input type="date" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={prossimaVisita} onChange={e => setProssimaVisita(e.target.value)} /></div>
            </div>
            <div><label className="block text-xs font-medium text-stone-500 mb-1">Note / esito</label><textarea rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={esito} onChange={e => setEsito(e.target.value)} /></div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowNew(false)}>Annulla</Button><Button onClick={salva} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const ADMIN_NAV = [
  { section: 'Generale', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'reportistica', label: 'Reportistica', icon: TrendingUp },
    { id: 'scadenzario', label: 'Scadenzario', icon: ClipboardList },
  ]},
  { section: 'CRM & Vendite', items: [
    { id: 'clienti', label: 'Clienti', icon: Users },
    { id: 'agenti', label: 'Agenti', icon: UserCog },
    { id: 'visite', label: 'Visite & giri', icon: ClipboardList },
    { id: 'comunicazioni', label: 'Comunicazioni agenti', icon: Receipt },
    { id: 'comodati', label: "Comodati d'uso", icon: Package },
  ]},
  { section: 'Ordini & Magazzino', items: [
    { id: 'prodotti', label: 'Prodotti', icon: Package },
    { id: 'listini', label: 'Listini personalizzati', icon: Receipt },
    { id: 'ordini', label: 'Ordini clienti', icon: ShoppingCart },
    { id: 'fornitori', label: 'Fornitori', icon: Users },
    { id: 'ordiniAcquisto', label: 'Ordini d\'acquisto', icon: ShoppingCart },
    { id: 'lotti', label: 'Lotti & produzione', icon: Package },
  ]},
  { section: 'Flotta', items: [
    { id: 'flotta', label: 'Furgoni & consegne', icon: ShoppingCart },
  ]},
  { section: 'Amministrazione', items: [
    { id: 'fatturazione', label: 'Fatturazione & IVA', icon: Receipt },
    { id: 'insoluti', label: 'Insoluti', icon: AlertTriangle },
    { id: 'provvigioni', label: 'Provvigioni', icon: Wallet },
    { id: 'contabilita', label: 'Contabilità generale', icon: Calculator },
    { id: 'centriCosto', label: 'Centri di costo & EBITDA', icon: TrendingUp },
    { id: 'utenti', label: 'Utenti & permessi', icon: UserCog },
    { id: 'export', label: 'Export dati', icon: Receipt },
  ]},
];

const ADMIN_TITLES = {
  dashboard: ['GENERALE', 'Dashboard'],
  reportistica: ['GENERALE', 'Reportistica'],
  scadenzario: ['GENERALE', 'Scadenzario'],
  clienti: ['CRM & VENDITE', 'Clienti'],
  agenti: ['CRM & VENDITE', 'Agenti'],
  visite: ['CRM & VENDITE', 'Visite & giri'],
  comunicazioni: ['CRM & VENDITE', 'Comunicazioni agenti'],
  comodati: ['CRM & VENDITE', "Comodati d'uso"],
  prodotti: ['MAGAZZINO', 'Prodotti'],
  listini: ['MAGAZZINO', 'Listini personalizzati'],
  ordini: ['MAGAZZINO', 'Ordini clienti'],
  fornitori: ['MAGAZZINO', 'Fornitori'],
  ordiniAcquisto: ['MAGAZZINO', "Ordini d'acquisto"],
  lotti: ['MAGAZZINO', 'Lotti & produzione'],
  flotta: ['FLOTTA', 'Furgoni & consegne'],
  fatturazione: ['AMMINISTRAZIONE', 'Fatturazione & IVA'],
  insoluti: ['AMMINISTRAZIONE', 'Insoluti'],
  provvigioni: ['AMMINISTRAZIONE', 'Provvigioni'],
  contabilita: ['AMMINISTRAZIONE', 'Contabilità generale'],
  centriCosto: ['AMMINISTRAZIONE', 'Centri di costo & EBITDA'],
  utenti: ['AMMINISTRAZIONE', 'Utenti & permessi'],
  export: ['AMMINISTRAZIONE', 'Export dati'],
};

const AGENT_NAV_GROUPS = [{ section: '', items: [
  { id: 'dashboard', label: 'Riepilogo', icon: LayoutDashboard },
  { id: 'clienti', label: 'I miei clienti', icon: Users },
  { id: 'nuovoOrdine', label: 'Nuovo ordine', icon: Plus },
  { id: 'ordini', label: 'I miei ordini', icon: ClipboardList },
  { id: 'visite', label: 'Le mie visite', icon: ClipboardList },
] }];

const AGENT_TITLES = { dashboard: 'Riepilogo', clienti: 'I miei clienti', nuovoOrdine: 'Nuovo ordine', ordini: 'I miei ordini', visite: 'Le mie visite' };

function AdminApp({ db, setDb, onLogout, onReload, utente }) {
  const [active, setActive] = useState('dashboard');
  const [eyebrow, title] = ADMIN_TITLES[active] || ['', active];
  return (
    <AppShell brandSub={`Gestionale torrefazione — ${utente?.nome || ''}`} navGroups={ADMIN_NAV} activeId={active} setActive={setActive}
      onLogout={onLogout} onReload={onReload} footerNote="Backend reale — dati SQLite." eyebrow={eyebrow} title={title}>
      {active === 'dashboard'      && <AdminDashboard db={db} goTo={setActive} />}
      {active === 'reportistica'   && <ReportisticaView db={db} />}
      {active === 'scadenzario'    && <ScadenzarioView db={db} />}
      {active === 'clienti'        && <ClientiView db={db} setDb={setDb} />}
      {active === 'agenti'         && <AgentiView db={db} setDb={setDb} />}
      {active === 'visite'         && <VisiteView db={db} setDb={setDb} />}
      {active === 'comunicazioni'  && <ComunicazioniView db={db} setDb={setDb} />}
      {active === 'comodati'       && <ComodatiView db={db} setDb={setDb} />}
      {active === 'prodotti'       && <ProdottiView db={db} setDb={setDb} />}
      {active === 'listini'        && <ListiniView db={db} setDb={setDb} />}
      {active === 'ordini'         && <OrdiniView db={db} setDb={setDb} />}
      {active === 'fornitori'      && <FornitoriView db={db} setDb={setDb} />}
      {active === 'ordiniAcquisto' && <OrdiniAcquistoView db={db} setDb={setDb} />}
      {active === 'lotti'          && <LottiView db={db} setDb={setDb} />}
      {active === 'flotta'         && <FlottaView db={db} setDb={setDb} />}
      {active === 'fatturazione'   && <FatturazioneView db={db} setDb={setDb} />}
      {active === 'insoluti'       && <InsolutiView db={db} setDb={setDb} />}
      {active === 'provvigioni'    && <ProvvigioniView db={db} />}
      {active === 'contabilita'    && <ContabilitaView db={db} setDb={setDb} />}
      {active === 'centriCosto'    && <CentriCostoView db={db} setDb={setDb} />}
      {active === 'utenti'         && <UtentiView db={db} setDb={setDb} />}
      {active === 'export'         && <ExportView db={db} />}
    </AppShell>
  );
}

function AgentApp({ db, setDb, agente, onLogout }) {
  const [active, setActive] = useState('dashboard');
  const miClienti = db.clienti.filter(c => c.agenteId === agente?.id);
  const miOrdini  = db.ordini.filter(o => o.agenteId === agente?.id);
  const mieVisite = (db.visite || []).filter(v => v.agenteId === agente?.id);
  if (!agente) return <div className="p-8 text-sm text-stone-500">Profilo agente non trovato.</div>;
  return (
    <AppShell brandSub={`Portale — ${agente.nome} ${agente.cognome}`} navGroups={AGENT_NAV_GROUPS} activeId={active}
      setActive={setActive} onLogout={onLogout} eyebrow="PORTALE AGENTI" title={AGENT_TITLES[active]}>
      {active === 'dashboard'   && <AgentDashboard agente={agente} clienti={miClienti} ordini={miOrdini} db={db} />}
      {active === 'clienti'     && <AgentClientiView clienti={miClienti} db={db} />}
      {active === 'nuovoOrdine' && <AgentNuovoOrdineView db={db} setDb={setDb} agente={agente} clienti={miClienti} onCreated={() => setActive('ordini')} />}
      {active === 'ordini'      && <AgentOrdiniView db={db} ordini={miOrdini} />}
      {active === 'visite'      && <AgentVisiteView db={db} setDb={setDb} agente={agente} visite={mieVisite} />}
    </AppShell>
  );
}

const FONT_STYLE = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    .font-display { font-family: 'Fraunces', serif; }
    .font-mono-num { font-family: 'IBM Plex Mono', monospace; }
    * { font-family: 'Inter', sans-serif; }
  `}</style>
);

async function safeList(fn, fallback = []) {
  try { return await fn(); } catch (e) { return fallback; }
}

export default function App() {
  const [db, setDbRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [loginError, setLoginError] = useState('');

  async function caricaDatiReali() {
    const [
      clienti, agenti, prodotti, ordini, fatture, movimenti, pianoConti, magazzinoVerde, lotti,
      fornitori, listini, corrispettivi, ordiniAcquisto, attrezzature, interventi, furgoni, costiMezzo,
      visite, comunicazioni, giriConsegna,
    ] = await Promise.all([
      safeList(() => api.clienti.list()), safeList(() => api.agenti.list()), safeList(() => api.prodotti.list()), safeList(() => api.ordini.list()),
      safeList(() => api.fatture.list()), safeList(() => api.contabilita.movimenti()), safeList(() => api.contabilita.pianoConti()),
      safeList(() => api.magazzinoVerde.get(), { kgDisponibili: 0 }), safeList(() => api.lotti.list()),
      safeList(() => api.fornitori.list()), safeList(() => api.listini.list()), safeList(() => api.corrispettivi.list()), safeList(() => api.ordiniAcquisto.list()),
      safeList(() => api.attrezzature.list()), safeList(() => api.interventi.list()), safeList(() => api.furgoni.list()), safeList(() => api.costiMezzo.list()),
      safeList(() => api.visite.list()), safeList(() => api.comunicazioni.list()), safeList(() => api.giriConsegna.list()),
    ]);
    const ammortamentiMesiRes = await safeList(() => api.ammortamenti.list());
    const ammortamentiMesi = ammortamentiMesiRes.map(r => r.mese);
    const [insoluti, noteCredito, utenti] = await Promise.all([
      safeList(() => api.insoluti.list()),
      safeList(() => api.noteCredito.list()),
      safeList(() => api.utenti.list()),
    ]);
    setDbRaw({
      clienti, agenti, prodotti, ordini, fatture, movimenti,
      pianoConti: (pianoConti && pianoConti.length) ? pianoConti : PIANO_CONTI,
      magazzinoVerde: magazzinoVerde || { kgDisponibili: 0 },
      lotti, fornitori, listini, corrispettivi, ordiniAcquisto,
      attrezzature, interventi, furgoni, costiMezzo, visite, comunicazioni, giriConsegna,
      insoluti, noteCredito, utenti,
      ammortamentiMesi,
    });
  }

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    api.me()
      .then(profilo => { setSession(profilo); return caricaDatiReali(); })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  function setDb(updater) {
    setDbRaw(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }

  async function handleLogin(email, password) {
    setLoginError('');
    try {
      const { token, profilo } = await api.login(email, password);
      setToken(token);
      setSession(profilo);
      setLoading(true);
      await caricaDatiReali();
    } catch (e) {
      setLoginError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearToken();
    setSession(null);
    setDbRaw(null);
  }

  function ricaricaDati() {
    setLoading(true);
    caricaDatiReali().finally(() => setLoading(false));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        {FONT_STYLE}
        <div className="text-amber-50 text-sm">Caricamento gestionale…</div>
      </div>
    );
  }

  if (!session || !db) {
    return <>{FONT_STYLE}<LoginScreen onLogin={handleLogin} loginError={loginError} /></>;
  }

  if (session.tipo === 'utente') {
    return <>{FONT_STYLE}<AdminApp db={db} setDb={setDb} onLogout={handleLogout} onReload={ricaricaDati} utente={session} /></>;
  }

  const agente = db.agenti.find(a => a.id === session.id);
  return <>{FONT_STYLE}<AgentApp db={db} setDb={setDb} agente={agente} onLogout={handleLogout} /></>;
}

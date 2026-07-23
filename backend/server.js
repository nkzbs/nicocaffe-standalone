// ============================================================
// NICO CAFFÈ — GESTIONALE STANDALONE — Backend Express
// server.js
// ============================================================
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'nicocaffe.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const PORT = process.env.PORT || 4100;

// ---------- DB bootstrap ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const isNew = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

if (isNew) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  console.log('Database inizializzato da schema.sql');
}

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json());

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- Auth ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token mancante' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

function requireRole() {
  const roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (roles.indexOf(req.user.tipo) === -1 && roles.indexOf(req.user.ruolo) === -1) {
      return res.status(403).json({ error: 'Permesso negato' });
    }
    next();
  };
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password richieste' });

  const utente = db.prepare('SELECT * FROM utenti WHERE email = ? AND attivo = 1').get(email.toLowerCase());
  if (utente && bcrypt.compareSync(password, utente.password_hash)) {
    const token = jwt.sign(
      { id: utente.id, email: utente.email, tipo: 'utente', ruolo: utente.ruolo, nome: utente.nome, cognome: utente.cognome },
      JWT_SECRET, { expiresIn: '12h' }
    );
    return res.json({ token, profilo: { id: utente.id, nome: utente.nome, cognome: utente.cognome, ruolo: utente.ruolo, tipo: 'utente' } });
  }

  const agente = db.prepare('SELECT * FROM agenti WHERE email = ? AND attivo = 1').get(email.toLowerCase());
  if (agente && bcrypt.compareSync(password, agente.password_hash)) {
    const token = jwt.sign(
      { id: agente.id, email: agente.email, tipo: 'agente', nome: agente.nome, cognome: agente.cognome },
      JWT_SECRET, { expiresIn: '12h' }
    );
    return res.json({ token, profilo: { id: agente.id, nome: agente.nome, cognome: agente.cognome, tipo: 'agente' } });
  }

  return res.status(401).json({ error: 'Credenziali non valide' });
});

app.get('/api/auth/me', authMiddleware, (req, res) => res.json(req.user));

// ---------- Helper: log attivitÃ  (audit reale, non fake) ----------
function logAttivita(utenteId, azione, dettaglio) {
  db.prepare('INSERT INTO log_attivita (utente_id, azione, dettaglio) VALUES (?, ?, ?)')
    .run(utenteId, azione, JSON.stringify(dettaglio || {}));
}

// ============================================================
// CLIENTI
// ============================================================
app.get('/api/clienti', authMiddleware, (req, res) => {
  const rows = req.user.tipo === 'agente'
    ? db.prepare('SELECT * FROM clienti WHERE agente_id = ? AND attivo = 1').all(req.user.id)
    : db.prepare('SELECT * FROM clienti WHERE attivo = 1').all();
  res.json(rows.map(r => Object.assign({}, r, { documenti: JSON.parse(r.documenti || '[]') })));
});

const TIPI_PAGAMENTO = ['Ri.Ba.30', 'Ri.Ba.30FM', 'Ri.Ba.60', 'Ri.Ba.60FM', 'Rimessa diretta', 'Contanti', 'Assegno', 'Bonifico'];

app.post('/api/clienti', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
  const b = req.body;
  const id = uid('CL');
  const tipoPagamento = TIPI_PAGAMENTO.includes(b.tipoPagamento) ? b.tipoPagamento : 'Bonifico';
  db.prepare('INSERT INTO clienti (id, ragione_sociale, piva, pec, codice_univoco, citta, indirizzo, telefono, email, pagamento, tipo_pagamento, fido, agente_id, sconto_percent, documenti) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, b.ragioneSociale, b.piva, b.pec || null, b.codiceUnivoco || null, b.citta, b.indirizzo, b.telefono, b.email, b.pagamento, tipoPagamento, b.fido || 0, b.agenteId || null, b.scontoPercent || 0, JSON.stringify(b.documenti || []));
  logAttivita(req.user.id, 'crea_cliente', { id });
  res.status(201).json({ id });
});

app.put('/api/clienti/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
  const b = req.body;
  const tipoPagamento = TIPI_PAGAMENTO.includes(b.tipoPagamento) ? b.tipoPagamento : 'Bonifico';
  db.prepare('UPDATE clienti SET ragione_sociale=?, piva=?, pec=?, codice_univoco=?, citta=?, indirizzo=?, telefono=?, email=?, pagamento=?, tipo_pagamento=?, fido=?, agente_id=?, sconto_percent=?, documenti=? WHERE id=?')
    .run(b.ragioneSociale, b.piva, b.pec || null, b.codiceUnivoco || null, b.citta, b.indirizzo, b.telefono, b.email, b.pagamento, tipoPagamento, b.fido || 0, b.agenteId || null, b.scontoPercent || 0, JSON.stringify(b.documenti || []), req.params.id);
  logAttivita(req.user.id, 'modifica_cliente', { id: req.params.id });
  res.json({ ok: true });
});

// ============================================================
// AGENTI
// ============================================================
app.get('/api/agenti', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, nome, cognome, zona, email, telefono, scaglioni, target, bonus_target FROM agenti WHERE attivo = 1').all();
  res.json(rows.map(r => Object.assign({}, r, { scaglioni: JSON.parse(r.scaglioni || '[]') })));
});

app.post('/api/agenti', authMiddleware, requireRole('Amministratore'), (req, res) => {
  const b = req.body;
  const id = uid('AG');
  const hash = bcrypt.hashSync(b.password || (b.cognome.toLowerCase() + '2026'), 10);
  db.prepare('INSERT INTO agenti (id, nome, cognome, zona, email, telefono, password_hash, scaglioni, target, bonus_target) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, b.nome, b.cognome, b.zona, b.email.toLowerCase(), b.telefono, hash, JSON.stringify(b.scaglioni || []), b.target || 0, b.bonusTarget || 0);
  logAttivita(req.user.id, 'crea_agente', { id });
  res.status(201).json({ id });
});

// ============================================================
// PRODOTTI
// ============================================================
app.get('/api/prodotti', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM prodotti').all();
  res.json(rows.map(r => Object.assign({}, r, { sconti_quantita: JSON.parse(r.sconti_quantita || '[]') })));
});

app.put('/api/prodotti/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
  const b = req.body;
  db.prepare('UPDATE prodotti SET nome=?, categoria=?, formato=?, prezzo=?, costo=?, scorta=?, scorta_minima=?, unita=?, aliquota_iva=?, sconti_quantita=? WHERE id=?')
    .run(b.nome, b.categoria, b.formato, b.prezzo, b.costo, b.scorta, b.scortaMinima, b.unita, b.aliquotaIva, JSON.stringify(b.scontiQuantita || []), req.params.id);
  res.json({ ok: true });
});

// ============================================================
// ORDINI
// ============================================================
const creaOrdineTx = db.transaction((ordine) => {
  const id = uid('OR');
  const agenteId = ordine.agenteId || null;

  // Furgone assegnato all'agente (se esiste): lo scarico avviene dalla sua giacenza,
  // non dal magazzino centrale (già trasferito lì con il "carico").
  const furgone = agenteId
    ? db.prepare('SELECT id FROM furgoni WHERE agente_id = ?').get(agenteId)
    : null;

  const getGiacenzaFurgone = db.prepare('SELECT quantita FROM giacenza_furgone WHERE furgone_id = ? AND prodotto_id = ?');
  let scortaFurgoneInsufficiente = 0;
  if (furgone) {
    ordine.righe.forEach(r => {
      const riga = getGiacenzaFurgone.get(furgone.id, r.prodottoId);
      const disponibile = riga ? riga.quantita : 0;
      if (disponibile < r.quantita) scortaFurgoneInsufficiente = 1;
    });
  }

  db.prepare('INSERT INTO ordini (id, data, cliente_id, agente_id, stato, scorta_furgone_insufficiente) VALUES (?,?,?,?,?,?)')
    .run(id, ordine.data, ordine.clienteId, agenteId, ordine.stato || 'confermato', scortaFurgoneInsufficiente);

  const insRiga = db.prepare('INSERT INTO ordini_righe (ordine_id, prodotto_id, quantita, prezzo_unitario, aliquota_iva_override) VALUES (?,?,?,?,?)');
  const decScortaCentrale = db.prepare('UPDATE prodotti SET scorta = MAX(0, scorta - ?) WHERE id = ?');
  const decGiacenzaFurgone = db.prepare('UPDATE giacenza_furgone SET quantita = MAX(0, quantita - ?) WHERE furgone_id = ? AND prodotto_id = ?');

  ordine.righe.forEach(r => {
    insRiga.run(id, r.prodottoId, r.quantita, r.prezzoUnitario, (r.aliquotaIva === '' || r.aliquotaIva === undefined || r.aliquotaIva === null) ? null : Number(r.aliquotaIva));
    if (furgone) {
      decGiacenzaFurgone.run(r.quantita, furgone.id, r.prodottoId);
    } else {
      decScortaCentrale.run(r.quantita, r.prodottoId);
    }
  });
  return id;
});

app.get('/api/ordini', authMiddleware, (req, res) => {
  const ordini = req.user.tipo === 'agente'
    ? db.prepare('SELECT * FROM ordini WHERE agente_id = ? ORDER BY data DESC').all(req.user.id)
    : db.prepare('SELECT * FROM ordini ORDER BY data DESC').all();
  const righeStmt = db.prepare('SELECT * FROM ordini_righe WHERE ordine_id = ?');
  res.json(ordini.map(o => Object.assign({}, o, { righe: righeStmt.all(o.id) })));
});

app.post('/api/ordini', authMiddleware, (req, res) => {
  const b = req.body;
  if (!b.righe || !b.righe.length) return res.status(400).json({ error: 'Aggiungi almeno un prodotto.' });
  const id = creaOrdineTx(Object.assign({}, b, { agenteId: req.user.tipo === 'agente' ? req.user.id : b.agenteId }));
  logAttivita(req.user.id, 'crea_ordine', { id });
  res.status(201).json({ id });
});

// ============================================================
// CONTABILITÃ€
// ============================================================
const registraMovimentoTx = db.transaction((mov) => {
  const totDare = mov.righe.reduce((s, r) => s + (r.dare || 0), 0);
  const totAvere = mov.righe.reduce((s, r) => s + (r.avere || 0), 0);
  if (Math.round(totDare * 100) !== Math.round(totAvere * 100)) {
    throw new Error('Movimento non quadrato: dare ' + totDare + ' vs avere ' + totAvere);
  }
  const id = uid('MV');
  db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
    .run(id, mov.data, mov.descrizione, mov.riferimento || null);
  const insRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
  mov.righe.forEach(r => insRiga.run(id, r.conto, r.dare || 0, r.avere || 0));
  return id;
});

app.get('/api/contabilita/movimenti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
  const movimenti = db.prepare('SELECT * FROM movimenti ORDER BY data DESC').all();
  const righeStmt = db.prepare('SELECT * FROM movimenti_righe WHERE movimento_id = ?');
  res.json(movimenti.map(m => Object.assign({}, m, { righe: righeStmt.all(m.id) })));
});

app.post('/api/contabilita/movimenti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
  try {
    const id = registraMovimentoTx(req.body);
    logAttivita(req.user.id, 'registra_movimento', { id });
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/contabilita/piano-conti', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM piano_conti ORDER BY codice').all());
});

// ---------- Routes aggiuntive (fatturazione, corrispettivi, acquisti/magazzino) ----------
require('./routes-fatturazione')(app, db, { authMiddleware, requireRole, uid, logAttivita });
require('./routes-extra2')(app, db, { authMiddleware, requireRole, uid, logAttivita });
require('./routes-extra3')(app, db, { authMiddleware, requireRole, uid, logAttivita });
require('./routes-extra4')(app, db, { authMiddleware, requireRole, uid, logAttivita });
require('./routes-extra5')(app, db, { authMiddleware, requireRole, uid, logAttivita });
require('./routes-extra6')(app, db, { authMiddleware, requireRole, uid, logAttivita });

// ---------- Health check ----------
app.get('/api/health', (req, res) => res.json({ ok: true, db: DB_PATH }));

app.listen(PORT, () => console.log('Nico CaffÃ¨ backend in ascolto su porta ' + PORT));
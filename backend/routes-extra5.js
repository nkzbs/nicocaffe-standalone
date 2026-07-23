// ============================================================
// NICO CAFFÈ — routes-extra5.js
// Fase 4 CRM (punto 5): pagamento su bolla/ordine al momento consegna
//   (totale o parziale, con modalità) — esposizione cliente unificata
//   viene calcolata lato frontend usando questi dati.
// Fase 5 CRM (punto 6): distinta di versamento agente — aggrega gli
//   incassi in contanti/assegno raccolti da un agente in un periodo,
//   automatica (settimanale) o manuale, con ricevuta stampabile.
// ============================================================
module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, uid = deps.uid, logAttivita = deps.logAttivita;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ordini_pagamenti (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ordine_id   TEXT NOT NULL REFERENCES ordini(id),
      data        TEXT NOT NULL,
      importo     REAL NOT NULL,
      modalita    TEXT NOT NULL,
      conto       TEXT NOT NULL,
      distinta_id TEXT,
      stornato    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS distinte_versamento (
      id               TEXT PRIMARY KEY,
      agente_id        TEXT NOT NULL REFERENCES agenti(id),
      tipo             TEXT NOT NULL,
      periodo_da       TEXT NOT NULL,
      periodo_a        TEXT NOT NULL,
      data_generazione TEXT NOT NULL,
      importo_totale   REAL NOT NULL,
      note             TEXT,
      dettaglio_json   TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Mappa modalità di pagamento -> conto contabile di destinazione
  function contoPerModalita(modalita) {
    return (modalita === 'Contanti' || modalita === 'Assegno') ? '1001' : '1002';
  }

  function calcolaTotaleOrdine(ordineId) {
    const righe = db.prepare('SELECT * FROM ordini_righe WHERE ordine_id = ?').all(ordineId);
    const prodottiMap = new Map(db.prepare('SELECT id, aliquota_iva FROM prodotti').all().map(p => [p.id, p.aliquota_iva]));
    let imponibile = 0, iva = 0;
    righe.forEach(r => {
      const riga = r.quantita * r.prezzo_unitario;
      const aliquota = (r.aliquota_iva_override !== null && r.aliquota_iva_override !== undefined) ? r.aliquota_iva_override : (prodottiMap.get(r.prodotto_id) || 22);
      imponibile += riga;
      iva += riga * (aliquota / 100);
    });
    imponibile = Math.round(imponibile * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    return Math.round((imponibile + iva) * 100) / 100;
  }

  // ---------- Pagamenti su ordine (Fase 4) ----------
  app.get('/api/ordini/:id/pagamenti', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM ordini_pagamenti WHERE ordine_id = ? ORDER BY data').all(req.params.id));
  });

  // Bulk, usato dal frontend per calcolare l'esposizione cliente senza una chiamata per ordine.
  app.get('/api/ordini-pagamenti', authMiddleware, (req, res) => {
    if (req.user.tipo === 'agente') {
      res.json(db.prepare(`
        SELECT p.* FROM ordini_pagamenti p JOIN ordini o ON o.id = p.ordine_id
        WHERE p.stornato = 0 AND o.agente_id = ?
      `).all(req.user.id));
    } else {
      res.json(db.prepare('SELECT * FROM ordini_pagamenti WHERE stornato = 0').all());
    }
  });

  const registraPagamentoOrdineTx = db.transaction((ordine, importo, modalita, data, conto) => {
    db.prepare('INSERT INTO ordini_pagamenti (ordine_id, data, importo, modalita, conto) VALUES (?,?,?,?,?)')
      .run(ordine.id, data, importo, modalita, conto);
    const movId = uid('MV');
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, data, 'Incasso su ordine ' + ordine.id + ' (' + modalita + ')', ordine.id);
    const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMov.run(movId, conto, importo, 0);
    insMov.run(movId, '1100', 0, importo);
  });

  app.post('/api/ordini/:id/pagamento', authMiddleware, (req, res) => {
    const ordine = db.prepare('SELECT * FROM ordini WHERE id = ?').get(req.params.id);
    if (!ordine) return res.status(404).json({ error: 'Ordine non trovato' });
    const importo = Number(req.body.importo);
    const modalita = req.body.modalita;
    const data = req.body.data || new Date().toISOString().slice(0, 10);
    if (!importo || importo <= 0) return res.status(400).json({ error: 'Importo non valido' });
    if (!['Contanti', 'Assegno', 'Bonifico', 'Rimessa diretta'].includes(modalita)) {
      return res.status(400).json({ error: 'Modalità di pagamento non valida' });
    }

    const totale = calcolaTotaleOrdine(ordine.id);
    const pagatoFinora = db.prepare("SELECT COALESCE(SUM(importo),0) s FROM ordini_pagamenti WHERE ordine_id = ? AND stornato = 0").get(ordine.id).s;
    const residuo = Math.round((totale - pagatoFinora) * 100) / 100;
    if (importo > residuo + 0.01) return res.status(400).json({ error: 'Importo superiore al residuo (' + residuo + ')' });

    registraPagamentoOrdineTx(ordine, importo, modalita, data, contoPerModalita(modalita));
    logAttivita(req.user.id, 'pagamento_ordine', { ordineId: ordine.id, importo, modalita });
    res.status(201).json({ ok: true });
  });

  app.post('/api/ordini-pagamenti/:pagamentoId/storna', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const pagamento = db.prepare('SELECT * FROM ordini_pagamenti WHERE id = ?').get(req.params.pagamentoId);
    if (!pagamento) return res.status(404).json({ error: 'Pagamento non trovato' });
    if (pagamento.distinta_id) return res.status(400).json({ error: 'Pagamento già incluso in una distinta di versamento, non può essere stornato' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE ordini_pagamenti SET stornato = 1 WHERE id = ?').run(pagamento.id);
      const oggi = new Date().toISOString().slice(0, 10);
      const movId = uid('MV');
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, oggi, 'Storno incasso su ordine ' + pagamento.ordine_id, pagamento.ordine_id);
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, '1100', pagamento.importo, 0);
      insMov.run(movId, pagamento.conto, 0, pagamento.importo);
    });
    tx();
    res.json({ ok: true });
  });

  // ---------- Distinte di versamento agente (Fase 5) ----------
  app.get('/api/agenti/:id/versamenti', authMiddleware, (req, res) => {
    if (req.user.tipo === 'agente' && req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorizzato' });
    const righe = db.prepare('SELECT * FROM distinte_versamento WHERE agente_id = ? ORDER BY data_generazione DESC').all(req.params.id);
    res.json(righe.map(r => Object.assign({}, r, { dettaglio: JSON.parse(r.dettaglio_json || '[]') })));
  });

  app.get('/api/versamenti/:id', authMiddleware, (req, res) => {
    const r = db.prepare('SELECT * FROM distinte_versamento WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Distinta non trovata' });
    if (req.user.tipo === 'agente' && req.user.id !== r.agente_id) return res.status(403).json({ error: 'Non autorizzato' });
    res.json(Object.assign({}, r, { dettaglio: JSON.parse(r.dettaglio_json || '[]') }));
  });

  const generaVersamentoTx = db.transaction((agenteId, tipo, periodoDa, periodoA, note) => {
    const pagamenti = db.prepare(`
      SELECT p.id, p.ordine_id, p.data, p.importo, p.modalita, o.cliente_id
      FROM ordini_pagamenti p JOIN ordini o ON o.id = p.ordine_id
      WHERE o.agente_id = ? AND p.stornato = 0 AND p.distinta_id IS NULL
        AND p.data BETWEEN ? AND ?
        AND p.modalita IN ('Contanti','Assegno')
      ORDER BY p.data
    `).all(agenteId, periodoDa, periodoA);

    if (!pagamenti.length) return null;

    const clientiMap = new Map(db.prepare('SELECT id, ragione_sociale FROM clienti').all().map(c => [c.id, c.ragione_sociale]));
    const dettaglio = pagamenti.map(p => ({
      ordinePagamentoId: p.id, ordineId: p.ordine_id, data: p.data, importo: p.importo,
      modalita: p.modalita, clienteRagioneSociale: clientiMap.get(p.cliente_id) || p.cliente_id,
    }));
    const importoTotale = Math.round(dettaglio.reduce((s, d) => s + d.importo, 0) * 100) / 100;

    const id = uid('DV');
    const oggi = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO distinte_versamento (id, agente_id, tipo, periodo_da, periodo_a, data_generazione, importo_totale, note, dettaglio_json)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id, agenteId, tipo, periodoDa, periodoA, oggi, importoTotale, note || '', JSON.stringify(dettaglio));

    const updDistintaId = db.prepare('UPDATE ordini_pagamenti SET distinta_id = ? WHERE id = ?');
    dettaglio.forEach(d => updDistintaId.run(id, d.ordinePagamentoId));

    return { id, agenteId, tipo, periodoDa, periodoA, dataGenerazione: oggi, importoTotale, note: note || '', dettaglio };
  });

  app.post('/api/agenti/:id/versamenti/genera', authMiddleware, (req, res) => {
    if (req.user.tipo === 'agente' && req.user.id !== req.params.id) return res.status(403).json({ error: 'Non autorizzato' });
    const agente = db.prepare('SELECT id FROM agenti WHERE id = ?').get(req.params.id);
    if (!agente) return res.status(404).json({ error: 'Agente non trovato' });

    const tipo = req.body.tipo === 'manuale' ? 'manuale' : 'settimanale';
    let periodoDa = req.body.periodoDa, periodoA = req.body.periodoA;
    if (!periodoDa || !periodoA) {
      const oggi = new Date();
      const seiGiorniFa = new Date(oggi); seiGiorniFa.setDate(oggi.getDate() - 6);
      periodoA = oggi.toISOString().slice(0, 10);
      periodoDa = seiGiorniFa.toISOString().slice(0, 10);
    }

    const risultato = generaVersamentoTx(agente.id, tipo, periodoDa, periodoA, req.body.note);
    if (!risultato) return res.status(400).json({ error: 'Nessun incasso in contanti/assegno da versare in questo periodo.' });
    logAttivita(req.user.id, 'genera_versamento', { agenteId: agente.id, distintaId: risultato.id, importo: risultato.importoTotale });
    res.status(201).json(risultato);
  });
};

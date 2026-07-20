// ============================================================
// FILE: routes-fatturazione.js
// ============================================================

module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, uid = deps.uid, logAttivita = deps.logAttivita;

  const generaFatturaTx = db.transaction((ordineId, numero) => {
    const ordine = db.prepare('SELECT * FROM ordini WHERE id = ?').get(ordineId);
    if (!ordine) throw new Error('Ordine non trovato');
    if (ordine.stato === 'fatturato') throw new Error('Ordine giÃ  fatturato');

    const righe = db.prepare('SELECT * FROM ordini_righe WHERE ordine_id = ?').all(ordineId);
    const cliente = db.prepare('SELECT * FROM clienti WHERE id = ?').get(ordine.cliente_id);
    const prodottiMap = new Map(db.prepare('SELECT id, aliquota_iva FROM prodotti').all().map(p => [p.id, p.aliquota_iva]));

    let imponibile = 0, iva = 0;
    righe.forEach(r => {
      const riga = r.quantita * r.prezzo_unitario;
      imponibile += riga;
      iva += riga * ((prodottiMap.get(r.prodotto_id) || 22) / 100);
    });
    imponibile = Math.round(imponibile * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    const totale = Math.round((imponibile + iva) * 100) / 100;

    const id = uid('FT');
    const oggi = new Date().toISOString().slice(0, 10);
    const giorniPagamento = parseInt((cliente.pagamento || '30').replace(/\D/g, ''), 10) || 30;
    const scadenza = new Date(Date.now() + giorniPagamento * 86400000).toISOString().slice(0, 10);

    db.prepare("INSERT INTO fatture (id, numero, data, cliente_id, agente_id, ordine_id, imponibile, iva, totale, scadenza, stato) VALUES (?,?,?,?,?,?,?,?,?,?,'emessa')")
      .run(id, numero, oggi, ordine.cliente_id, ordine.agente_id, ordineId, imponibile, iva, totale, scadenza);

    const insRiga = db.prepare('INSERT INTO fatture_righe (fattura_id, prodotto_id, quantita, prezzo_unitario) VALUES (?,?,?,?)');
    righe.forEach(r => insRiga.run(id, r.prodotto_id, r.quantita, r.prezzo_unitario));

    const movId = uid('MV');
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, oggi, 'Fattura ' + numero + ' â€” ' + cliente.ragione_sociale, id);
    const insMovRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMovRiga.run(movId, '1100', totale, 0);
    insMovRiga.run(movId, '4000', 0, imponibile);
    insMovRiga.run(movId, '2500', 0, iva);

    db.prepare("UPDATE ordini SET stato = 'fatturato' WHERE id = ?").run(ordineId);
    return id;
  });

  app.post('/api/ordini/:id/fattura', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    try {
      const count = db.prepare('SELECT COUNT(*) c FROM fatture').get().c;
      const numero = new Date().getFullYear() + '/' + String(count + 1).padStart(4, '0');
      const id = generaFatturaTx(req.params.id, numero);
      logAttivita(req.user.id, 'genera_fattura', { id, ordineId: req.params.id });
      res.status(201).json({ id, numero });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/fatture/:id/pagamento', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const fattura = db.prepare('SELECT * FROM fatture WHERE id = ?').get(req.params.id);
    if (!fattura) return res.status(404).json({ error: 'Fattura non trovata' });
    const contoIncasso = req.body.contoIncasso || '1002';
    const data = req.body.data;

    const movId = uid('MV');
    const oggi = data || new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, oggi, 'Incasso fattura ' + fattura.numero, fattura.id);
    const insMovRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMovRiga.run(movId, contoIncasso, fattura.totale, 0);
    insMovRiga.run(movId, '1100', 0, fattura.totale);

    db.prepare("UPDATE fatture SET stato = 'pagata' WHERE id = ?").run(fattura.id);
    logAttivita(req.user.id, 'incassa_fattura', { id: fattura.id });
    res.json({ ok: true });
  });

  app.get('/api/fatture', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    res.json(db.prepare('SELECT * FROM fatture ORDER BY data DESC').all());
  });

  const generaCorrispettivoTx = db.transaction((body) => {
    const data = body.data, clienteId = body.clienteId, clienteOccasionale = body.clienteOccasionale, righe = body.righe, contoIncasso = body.contoIncasso;
    let totale = 0;
    righe.forEach(r => { totale += r.quantita * r.prezzoUnitario; });
    totale = Math.round(totale * 100) / 100;

    const id = uid('CO');
    db.prepare('INSERT INTO corrispettivi (id, data, cliente_id, cliente_occasionale, conto_incasso, totale) VALUES (?,?,?,?,?,?)')
      .run(id, data, clienteId || null, clienteOccasionale || null, contoIncasso, totale);
    const insRiga = db.prepare('INSERT INTO corrispettivi_righe (corrispettivo_id, prodotto_id, quantita, prezzo_unitario) VALUES (?,?,?,?)');
    const decScorta = db.prepare('UPDATE prodotti SET scorta = MAX(0, scorta - ?) WHERE id = ?');
    righe.forEach(r => { insRiga.run(id, r.prodottoId, r.quantita, r.prezzoUnitario); decScorta.run(r.quantita, r.prodottoId); });

    const movId = uid('MV');
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, data, 'Corrispettivo', id);
    const imponibile = Math.round((totale / 1.22) * 100) / 100;
    const iva = Math.round((totale - imponibile) * 100) / 100;
    const insMovRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMovRiga.run(movId, contoIncasso, totale, 0);
    insMovRiga.run(movId, '4100', 0, imponibile);
    insMovRiga.run(movId, '2500', 0, iva);
    return id;
  });

  app.post('/api/corrispettivi', authMiddleware, (req, res) => {
    try {
      const id = generaCorrispettivoTx(req.body);
      logAttivita(req.user.id, 'crea_corrispettivo', { id });
      res.status(201).json({ id });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  const riceviOrdineAcquistoTx = db.transaction((ordineAcquistoId) => {
    const oa = db.prepare('SELECT * FROM ordini_acquisto WHERE id = ?').get(ordineAcquistoId);
    if (!oa) throw new Error('Ordine acquisto non trovato');
    const righe = db.prepare('SELECT * FROM ordini_acquisto_righe WHERE ordine_acquisto_id = ?').all(ordineAcquistoId);

    let totale = 0, kgTotali = 0;
    righe.forEach(r => { totale += r.kg * r.prezzo_kg; kgTotali += r.kg; });
    const imponibile = Math.round(totale * 100) / 100;
    const iva = Math.round(imponibile * (oa.aliquota_iva / 100) * 100) / 100;

    const movId = 'MV' + require('crypto').randomUUID().slice(0, 8);
    const oggi = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, oggi, 'Ricevimento ordine acquisto caffÃ¨ verde', ordineAcquistoId);
    const insMovRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMovRiga.run(movId, '1200', imponibile, 0);
    insMovRiga.run(movId, '1500', iva, 0);
    insMovRiga.run(movId, '2100', 0, imponibile + iva);

    db.prepare('UPDATE magazzino_verde SET kg_disponibili = kg_disponibili + ? WHERE id = 1').run(kgTotali);
    db.prepare("UPDATE ordini_acquisto SET stato = 'ricevuto' WHERE id = ?").run(ordineAcquistoId);
    return kgTotali;
  });

  app.post('/api/ordini-acquisto/:id/ricevi', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    try {
      const kg = riceviOrdineAcquistoTx(req.params.id);
      logAttivita(req.user.id, 'ricevi_ordine_acquisto', { id: req.params.id, kg });
      res.json({ ok: true, kgRicevuti: kg });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/magazzino-verde', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM magazzino_verde WHERE id = 1').get());
  });

  app.get('/api/lotti', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM lotti ORDER BY data_tostatura DESC').all());
  });
};
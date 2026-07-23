module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, uid = deps.uid, logAttivita = deps.logAttivita;

  db.exec(`
    CREATE TABLE IF NOT EXISTS fatture_pagamenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fattura_id TEXT NOT NULL REFERENCES fatture(id),
      data TEXT NOT NULL,
      importo REAL NOT NULL,
      conto TEXT NOT NULL,
      stornato INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS insoluti_solleciti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insoluto_id TEXT NOT NULL REFERENCES insoluti(id),
      data TEXT NOT NULL,
      canale TEXT NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS categorie_prodotto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE
    );
  `);

  // Migrazione: aliquota IVA modificabile per riga (fattura/corrispettivo/ordine)
  function ensureColumn(tabella, colonna, tipo) {
    const cols = db.prepare('PRAGMA table_info(' + tabella + ')').all();
    if (!cols.some(c => c.name === colonna)) {
      db.exec('ALTER TABLE ' + tabella + ' ADD COLUMN ' + colonna + ' ' + tipo);
    }
  }
  ensureColumn('ordini_righe', 'aliquota_iva_override', 'REAL');
  ensureColumn('fatture_righe', 'aliquota_iva_override', 'REAL');
  ensureColumn('corrispettivi_righe', 'aliquota_iva_override', 'REAL');

  // Migrazione: anagrafica cliente estesa (PEC, Codice Univoco, tipo_pagamento strutturato)
  ensureColumn('clienti', 'pec', 'TEXT');
  ensureColumn('clienti', 'codice_univoco', 'TEXT');
  ensureColumn('clienti', 'tipo_pagamento', "TEXT NOT NULL DEFAULT 'Bonifico'");
  db.exec("UPDATE clienti SET tipo_pagamento = 'Bonifico' WHERE tipo_pagamento IS NULL OR tipo_pagamento = ''");

  // Seed categorie di base, solo se la tabella è vuota (idempotente: non duplica ad ogni avvio)
  const categorieEsistenti = db.prepare('SELECT COUNT(*) as n FROM categorie_prodotto').get().n;
  if (categorieEsistenti === 0) {
    const seedCategorie = db.prepare('INSERT INTO categorie_prodotto (nome) VALUES (?)');
    ['Miscela', 'Monorigine', 'Decaffeinato', 'Macinato', 'Capsule', 'Cialde', 'Ginseng', 'Orzo'].forEach(nome => seedCategorie.run(nome));
  }

  // ============================================================
  // CATEGORIE PRODOTTO
  // ============================================================
  app.get('/api/categorie-prodotto', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM categorie_prodotto ORDER BY nome').all());
  });
  app.post('/api/categorie-prodotto', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome categoria richiesto' });
    try {
      const info = db.prepare('INSERT INTO categorie_prodotto (nome) VALUES (?)').run(nome);
      res.status(201).json({ id: info.lastInsertRowid, nome });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Categoria già esistente' });
      throw e;
    }
  });

  app.get('/api/giri-consegna', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM giri_consegna ORDER BY data DESC').all());
  });
  app.post('/api/giri-consegna', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('GC');
    db.prepare('INSERT INTO giri_consegna (id, furgone_id, data, zona, note) VALUES (?,?,?,?,?)')
      .run(id, b.furgoneId || null, b.data, b.zona, b.note || '');
    res.status(201).json({ id });
  });

  app.get('/api/ammortamenti', authMiddleware, (req, res) => {
    res.json(db.prepare("SELECT DISTINCT substr(data,1,7) as mese FROM ammortamenti_registrati ORDER BY mese DESC").all());
  });
  app.post('/api/ammortamenti/registra', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const mese = req.body.mese;
    if (!mese) return res.status(400).json({ error: 'Mese richiesto (formato YYYY-MM)' });
    const giaFatto = db.prepare("SELECT 1 FROM ammortamenti_registrati WHERE substr(data,1,7) = ?").get(mese);
    if (giaFatto) return res.status(400).json({ error: 'Ammortamento già registrato per questo mese' });

    const attrezzature = db.prepare('SELECT * FROM attrezzature').all();
    const totaleAnnuo = attrezzature.reduce((s, a) => s + (a.costo || 0) / 5, 0);
    const importo = Math.round((totaleAnnuo / 12) * 100) / 100;
    if (importo <= 0) return res.json({ ok: true, importo: 0 });

    const tx = db.transaction(() => {
      const movId = uid('MV');
      const dataReg = mese + '-28';
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, dataReg, 'Ammortamento mensile attrezzature comodato', mese);
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, '5900', importo, 0);
      insMov.run(movId, '1250', 0, importo);
      db.prepare('INSERT INTO ammortamenti_registrati (id, attrezzatura_id, data, importo) VALUES (?,?,?,?)')
        .run(uid('AMM'), null, dataReg, importo);
    });
    tx();
    res.json({ ok: true, importo });
  });

  app.get('/api/fatture/:id/pagamenti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    res.json(db.prepare('SELECT * FROM fatture_pagamenti WHERE fattura_id = ? ORDER BY data').all(req.params.id));
  });

  app.post('/api/fatture/:id/pagamento-parziale', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const fattura = db.prepare('SELECT * FROM fatture WHERE id = ?').get(req.params.id);
    if (!fattura) return res.status(404).json({ error: 'Fattura non trovata' });
    const importo = req.body.importo, conto = req.body.conto, data = req.body.data;
    if (!importo || importo <= 0) return res.status(400).json({ error: 'Importo non valido' });

    const pagatoFinora = db.prepare("SELECT COALESCE(SUM(importo),0) s FROM fatture_pagamenti WHERE fattura_id = ? AND stornato = 0").get(fattura.id).s;
    const residuo = Math.round((fattura.totale - pagatoFinora) * 100) / 100;
    if (importo > residuo + 0.01) return res.status(400).json({ error: 'Importo superiore al residuo (' + residuo + ')' });

    const oggi = data || new Date().toISOString().slice(0,10);
    const contoIncasso = conto || '1002';

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO fatture_pagamenti (fattura_id, data, importo, conto) VALUES (?,?,?,?)')
        .run(fattura.id, oggi, importo, contoIncasso);
      const movId = uid('MV');
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, oggi, 'Pagamento parziale fattura ' + fattura.numero, fattura.numero);
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, contoIncasso, importo, 0);
      insMov.run(movId, '1100', 0, importo);

      const nuovoPagato = pagatoFinora + importo;
      if (nuovoPagato >= fattura.totale - 0.01) {
        db.prepare("UPDATE fatture SET stato = 'pagata' WHERE id = ?").run(fattura.id);
      }
    });
    tx();
    logAttivita(req.user.id, 'pagamento_parziale', { fatturaId: fattura.id, importo: importo });
    res.json({ ok: true });
  });

  app.post('/api/fatture-pagamenti/:pagamentoId/storna', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const pagamento = db.prepare('SELECT * FROM fatture_pagamenti WHERE id = ?').get(req.params.pagamentoId);
    if (!pagamento) return res.status(404).json({ error: 'Pagamento non trovato' });
    const fattura = db.prepare('SELECT * FROM fatture WHERE id = ?').get(pagamento.fattura_id);

    const tx = db.transaction(() => {
      db.prepare('UPDATE fatture_pagamenti SET stornato = 1 WHERE id = ?').run(pagamento.id);
      const oggi = new Date().toISOString().slice(0,10);
      const movId = uid('MV');
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, oggi, 'Storno pagamento fattura ' + fattura.numero, fattura.numero);
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, '1100', pagamento.importo, 0);
      insMov.run(movId, pagamento.conto, 0, pagamento.importo);
      db.prepare("UPDATE fatture SET stato = 'da_pagare' WHERE id = ?").run(fattura.id);
    });
    tx();
    res.json({ ok: true });
  });

  app.get('/api/insoluti/:id/solleciti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    res.json(db.prepare('SELECT * FROM insoluti_solleciti WHERE insoluto_id = ? ORDER BY data DESC').all(req.params.id));
  });
  app.post('/api/insoluti/:id/sollecito', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const insoluto = db.prepare('SELECT * FROM insoluti WHERE id = ?').get(req.params.id);
    if (!insoluto) return res.status(404).json({ error: 'Insoluto non trovato' });
    const canale = req.body.canale, note = req.body.note, data = req.body.data;
    db.prepare('INSERT INTO insoluti_solleciti (insoluto_id, data, canale, note) VALUES (?,?,?,?)')
      .run(insoluto.id, data || new Date().toISOString().slice(0,10), canale || 'telefono', note || '');
    res.status(201).json({ ok: true });
  });

  // ============================================================
  // LOTTI — produzione/tostatura reale
  // ============================================================
  app.post('/api/lotti', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    const prodotto = db.prepare('SELECT * FROM prodotti WHERE id = ?').get(b.prodottoId);
    if (!prodotto) return res.status(404).json({ error: 'Prodotto non trovato' });
    const magazzino = db.prepare('SELECT * FROM magazzino_verde WHERE id = 1').get();
    const kgVerde = parseFloat(b.kgVerde) || 0;
    if (kgVerde <= 0) return res.status(400).json({ error: 'Kg caffè verde non validi' });
    if (kgVerde > magazzino.kg_disponibili) return res.status(400).json({ error: 'Kg insufficienti in magazzino verde (disponibili: ' + magazzino.kg_disponibili + ')' });

    const rendimento = prodotto.rendimento_tostatura || 84;
    const kgOttenuti = Math.round(kgVerde * (rendimento / 100) * 100) / 100;
    const dataTostatura = b.data || new Date().toISOString().slice(0, 10);
    const giorniScadenza = prodotto.unita === 'kg' ? 365 : 540;
    const scadenza = new Date(new Date(dataTostatura).getTime() + giorniScadenza * 86400000).toISOString().slice(0, 10);
    const id = uid('LT');

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO lotti (id, prodotto_id, data_tostatura, scadenza, quantita_iniziale, quantita_residua) VALUES (?,?,?,?,?,?)')
        .run(id, b.prodottoId, dataTostatura, scadenza, kgOttenuti, kgOttenuti);
      db.prepare('UPDATE prodotti SET scorta = scorta + ? WHERE id = ?').run(kgOttenuti, b.prodottoId);
      db.prepare('UPDATE magazzino_verde SET kg_disponibili = kg_disponibili - ? WHERE id = 1').run(kgVerde);
    });
    tx();
    logAttivita(req.user.id, 'avvia_tostatura', { id, kgOttenuti });
    res.status(201).json({ id, kgOttenuti });
  });
};

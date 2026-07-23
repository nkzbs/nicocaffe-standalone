// ============================================================
// NICO CAFFÈ — routes-extra4.js
// Flotta Fase 3 (CRM update, punti 2-3-4):
//   - furgone assegnato 1:1 fisso all'agente
//   - magazzino/giacenza separato per furgone
//   - carico furgone (trasferimento da magazzino centrale)
// Lo scarico automatico ad ogni vendita è in server.js (creaOrdineTx).
// ============================================================
module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, uid = deps.uid, logAttivita = deps.logAttivita;

  function ensureColumn(tabella, colonna, tipo) {
    const cols = db.prepare('PRAGMA table_info(' + tabella + ')').all();
    if (!cols.some(c => c.name === colonna)) {
      db.exec('ALTER TABLE ' + tabella + ' ADD COLUMN ' + colonna + ' ' + tipo);
    }
  }
  ensureColumn('furgoni', 'agente_id', 'TEXT REFERENCES agenti(id)');
  ensureColumn('ordini', 'scorta_furgone_insufficiente', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS giacenza_furgone (
      furgone_id  TEXT NOT NULL REFERENCES furgoni(id),
      prodotto_id TEXT NOT NULL REFERENCES prodotti(id),
      quantita    REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (furgone_id, prodotto_id)
    );
  `);

  // ---------- Assegnazione furgone <-> agente (1:1 fisso) ----------
  app.put('/api/furgoni/:id/agente', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const agenteId = req.body.agenteId || null;
    const assegnaTx = db.transaction(() => {
      if (agenteId) {
        // un agente ha un solo furgone: libera l'eventuale furgone già assegnato a questo agente
        db.prepare('UPDATE furgoni SET agente_id = NULL WHERE agente_id = ? AND id != ?').run(agenteId, req.params.id);
      }
      db.prepare('UPDATE furgoni SET agente_id = ? WHERE id = ?').run(agenteId, req.params.id);
    });
    assegnaTx();
    logAttivita(req.user.id, 'assegna_furgone_agente', { furgoneId: req.params.id, agenteId });
    res.json({ ok: true });
  });

  // ---------- Giacenza per furgone ----------
  app.get('/api/furgoni/:id/giacenza', authMiddleware, (req, res) => {
    const righe = db.prepare(`
      SELECT g.prodotto_id, g.quantita, p.nome, p.unita
      FROM giacenza_furgone g JOIN prodotti p ON p.id = g.prodotto_id
      WHERE g.furgone_id = ?
      ORDER BY p.nome
    `).all(req.params.id);
    res.json(righe);
  });

  // ---------- Carico furgone (trasferimento da magazzino centrale) ----------
  const caricoFurgoneTx = db.transaction((furgoneId, prodottoId, quantita) => {
    db.prepare('UPDATE prodotti SET scorta = MAX(0, scorta - ?) WHERE id = ?').run(quantita, prodottoId);
    db.prepare(`
      INSERT INTO giacenza_furgone (furgone_id, prodotto_id, quantita) VALUES (?, ?, ?)
      ON CONFLICT(furgone_id, prodotto_id) DO UPDATE SET quantita = quantita + excluded.quantita
    `).run(furgoneId, prodottoId, quantita);
  });

  app.post('/api/furgoni/:id/carico', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    if (!b.prodottoId || !b.quantita || Number(b.quantita) <= 0) {
      return res.status(400).json({ error: 'Prodotto e quantità (positiva) sono obbligatori.' });
    }
    caricoFurgoneTx(req.params.id, b.prodottoId, Number(b.quantita));
    logAttivita(req.user.id, 'carico_furgone', { furgoneId: req.params.id, prodottoId: b.prodottoId, quantita: b.quantita });
    res.status(201).json({ ok: true });
  });
};

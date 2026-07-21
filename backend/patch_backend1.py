with open('routes-extra3.js', 'r') as f:
    content = f.read()

def apply(old, new, label):
    global content
    count = content.count(old)
    if count != 1:
        print(f"ATTENZIONE: '{label}' trovato {count} volte (atteso 1) — patch NON applicata.")
        return
    content = content.replace(old, new, 1)
    print(f"OK: '{label}' applicata.")

old1 = """  app.post('/api/insoluti/:id/sollecito', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const insoluto = db.prepare('SELECT * FROM insoluti WHERE id = ?').get(req.params.id);
    if (!insoluto) return res.status(404).json({ error: 'Insoluto non trovato' });
    const canale = req.body.canale, note = req.body.note, data = req.body.data;
    db.prepare('INSERT INTO insoluti_solleciti (insoluto_id, data, canale, note) VALUES (?,?,?,?)')
      .run(insoluto.id, data || new Date().toISOString().slice(0,10), canale || 'telefono', note || '');
    res.status(201).json({ ok: true });
  });
};"""

new1 = """  app.post('/api/insoluti/:id/sollecito', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
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
};"""

apply(old1, new1, "routes-extra3 aggiunge POST /api/lotti")

with open('routes-extra3.js', 'w') as f:
    f.write(content)

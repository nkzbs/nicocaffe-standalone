module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, uid = deps.uid, logAttivita = deps.logAttivita;

  const colonne = db.prepare("PRAGMA table_info(fatture)").all().map(c => c.name);
  if (!colonne.includes('provvigione_registrata')) {
    db.exec("ALTER TABLE fatture ADD COLUMN provvigione_registrata INTEGER DEFAULT 0");
  }

  function calcoloProvvigione(agente, fatturato) {
    const scaglioni = JSON.parse(agente.scaglioni || '[]').sort((a, b) => b.soglia - a.soglia);
    const scaglione = scaglioni.find(s => fatturato >= s.soglia) || scaglioni[scaglioni.length - 1] || { perc: 0 };
    const perc = scaglione.perc || 0;
    const base = Math.round(fatturato * perc / 100 * 100) / 100;
    const targetRaggiunto = agente.target ? fatturato >= agente.target : false;
    const bonus = targetRaggiunto ? (agente.bonus_target || 0) : 0;
    return { perc, base, bonus, targetRaggiunto, totale: Math.round((base + bonus) * 100) / 100 };
  }

  app.delete('/api/clienti/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    db.prepare('UPDATE clienti SET attivo = 0 WHERE id = ?').run(req.params.id);
    logAttivita(req.user.id, 'disattiva_cliente', { id: req.params.id });
    res.json({ ok: true });
  });

  app.put('/api/agenti/:id', authMiddleware, requireRole('Amministratore'), (req, res) => {
    const b = req.body;
    db.prepare(`UPDATE agenti SET nome=?, cognome=?, zona=?, email=?, telefono=?, scaglioni=?, target=?, bonus_target=? WHERE id=?`)
      .run(b.nome, b.cognome, b.zona, (b.email || '').toLowerCase(), b.telefono, JSON.stringify(b.scaglioni || []), b.target || 0, b.bonusTarget || 0, req.params.id);
    logAttivita(req.user.id, 'modifica_agente', { id: req.params.id });
    res.json({ ok: true });
  });
  app.delete('/api/agenti/:id', authMiddleware, requireRole('Amministratore'), (req, res) => {
    db.prepare('UPDATE agenti SET attivo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/agenti/:id/reset-password', authMiddleware, requireRole('Amministratore'), (req, res) => {
    const bcrypt = require('bcryptjs');
    const agente = db.prepare('SELECT id FROM agenti WHERE id = ?').get(req.params.id);
    if (!agente) return res.status(404).json({ error: 'Agente non trovato' });
    const scelta = (req.body && req.body.nuovaPassword) || '';
    if (scelta && scelta.length < 6) return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
    const passwordProvvisoria = scelta || Math.random().toString(36).slice(2, 10);
    db.prepare('UPDATE agenti SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(passwordProvvisoria, 10), req.params.id);
    logAttivita(req.user.id, 'reset_password_agente', { id: req.params.id });
    res.json({ ok: true, passwordProvvisoria });
  });

  app.post('/api/prodotti', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    const id = uid('PR');
    db.prepare(`INSERT INTO prodotti (id, nome, categoria, formato, prezzo, costo, scorta, scorta_minima, unita, aliquota_iva, rendimento_tostatura, sconti_quantita) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, b.nome, b.categoria, b.formato, b.prezzo || 0, b.costo || 0, b.scorta || 0, b.scortaMinima || 0, b.unita || 'conf', b.aliquotaIva || 22, b.rendimentoTostatura || 84, JSON.stringify(b.scontiQuantita || []));
    res.status(201).json({ id });
  });
  app.delete('/api/prodotti/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    try {
      db.prepare('DELETE FROM prodotti WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: 'Impossibile eliminare: prodotto referenziato da ordini/fatture esistenti.' });
    }
  });

  app.get('/api/fornitori', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM fornitori').all());
  });
  app.post('/api/fornitori', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('FO');
    db.prepare('INSERT INTO fornitori (id, ragione_sociale, piva, paese, telefono, email, referente) VALUES (?,?,?,?,?,?,?)')
      .run(id, b.ragioneSociale, b.piva, b.paese, b.telefono, b.email, b.referente);
    res.status(201).json({ id });
  });
  app.put('/api/fornitori/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    db.prepare('UPDATE fornitori SET ragione_sociale=?, piva=?, paese=?, telefono=?, email=?, referente=? WHERE id=?')
      .run(b.ragioneSociale, b.piva, b.paese, b.telefono, b.email, b.referente, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/fornitori/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    try { db.prepare('DELETE FROM fornitori WHERE id = ?').run(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: 'Impossibile eliminare: fornitore referenziato da ordini d\'acquisto.' }); }
  });

  app.get('/api/listini', authMiddleware, (req, res) => {
    const listini = db.prepare('SELECT * FROM listini').all();
    const righeStmt = db.prepare('SELECT prodotto_id, prezzo, attivo FROM listini_righe WHERE listino_id = ?');
    res.json(listini.map(l => ({ ...l, righe: righeStmt.all(l.id) })));
  });
  const salvaListinoTx = db.transaction((id, b) => {
    db.prepare('INSERT OR REPLACE INTO listini (id, nome, descrizione) VALUES (?,?,?)').run(id, b.nome, b.descrizione || '');
    db.prepare('DELETE FROM listini_righe WHERE listino_id = ?').run(id);
    const ins = db.prepare('INSERT INTO listini_righe (listino_id, prodotto_id, prezzo, attivo) VALUES (?,?,?,1)');
    (b.righe || []).forEach(r => ins.run(id, r.prodottoId, r.prezzo));
  });
  app.post('/api/listini', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const id = uid('LI');
    salvaListinoTx(id, req.body);
    res.status(201).json({ id });
  });
  app.put('/api/listini/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    salvaListinoTx(req.params.id, req.body);
    res.json({ ok: true });
  });
  app.delete('/api/listini/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    db.prepare('DELETE FROM listini WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/corrispettivi', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT * FROM corrispettivi ORDER BY data DESC').all();
    const righeStmt = db.prepare('SELECT prodotto_id, quantita, prezzo_unitario FROM corrispettivi_righe WHERE corrispettivo_id = ?');
    res.json(rows.map(c => ({ ...c, righe: righeStmt.all(c.id) })));
  });

  app.get('/api/ordini-acquisto', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT * FROM ordini_acquisto ORDER BY data DESC').all();
    const righeStmt = db.prepare('SELECT descrizione, kg, prezzo_kg FROM ordini_acquisto_righe WHERE ordine_acquisto_id = ?');
    res.json(rows.map(o => ({ ...o, righe: righeStmt.all(o.id) })));
  });
  app.post('/api/ordini-acquisto', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('OA');
    db.prepare('INSERT INTO ordini_acquisto (id, data, fornitore_id, aliquota_iva, stato) VALUES (?,?,?,?,?)')
      .run(id, b.data, b.fornitoreId, b.aliquotaIva || 22, 'in_attesa');
    const ins = db.prepare('INSERT INTO ordini_acquisto_righe (ordine_acquisto_id, descrizione, kg, prezzo_kg) VALUES (?,?,?,?)');
    (b.righe || []).forEach(r => ins.run(id, r.descrizione, r.kg, r.prezzoKg));
    res.status(201).json({ id });
  });

  app.get('/api/attrezzature', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM attrezzature').all());
  });
  app.post('/api/attrezzature', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('ATT');
    db.prepare('INSERT INTO attrezzature (id, nome, cliente_id, data_acquisto, costo, vita_utile_anni) VALUES (?,?,?,?,?,?)')
      .run(id, b.nome, b.clienteId || null, b.dataConsegna || null, b.valore || 0, 5);
    res.status(201).json({ id });
  });
  app.put('/api/attrezzature/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    db.prepare('UPDATE attrezzature SET nome=?, cliente_id=?, data_acquisto=?, costo=? WHERE id=?')
      .run(b.nome, b.clienteId || null, b.dataConsegna || null, b.valore || 0, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/attrezzature/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    db.prepare('DELETE FROM attrezzature WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  const registraCostoInterventoTx = db.transaction((b) => {
    const id = uid('INT');
    db.prepare('INSERT INTO interventi (id, attrezzatura_id, data, descrizione, costo) VALUES (?,?,?,?,?)')
      .run(id, b.attrezzaturaId, b.data, b.descrizione, b.costo || 0);
    if (b.costo > 0) {
      const movId = uid('MV');
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, b.data, 'Intervento tecnico — ' + b.descrizione, 'Comodati');
      const conto = b.conto || '1002';
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, '5800', b.costo, 0);
      insMov.run(movId, conto, 0, b.costo);
    }
    return id;
  });
  app.get('/api/interventi', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM interventi ORDER BY data DESC').all());
  });
  app.post('/api/interventi', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const id = registraCostoInterventoTx(req.body);
    res.status(201).json({ id });
  });

  app.get('/api/furgoni', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM furgoni').all());
  });
  app.post('/api/furgoni', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('FU');
    db.prepare('INSERT INTO furgoni (id, targa, modello, km_attuali) VALUES (?,?,?,?)')
      .run(id, b.targa, b.modello, b.kmAttuali || 0);
    res.status(201).json({ id });
  });
  app.put('/api/furgoni/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body;
    db.prepare('UPDATE furgoni SET targa=?, modello=?, km_attuali=? WHERE id=?').run(b.targa, b.modello, b.kmAttuali || 0, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/furgoni/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    db.prepare('DELETE FROM furgoni WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  const registraCostoMezzoTx = db.transaction((b) => {
    const id = uid('CM');
    db.prepare('INSERT INTO costi_mezzo (id, furgone_id, data, tipo, importo) VALUES (?,?,?,?,?)')
      .run(id, b.furgoneId, b.data, b.tipo, b.costo || 0);
    const movId = uid('MV');
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, b.data, (b.tipo || 'Costo') + ' — ' + (b.descrizione || ''), b.furgoneId);
    const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMov.run(movId, '5700', b.costo || 0, 0);
    insMov.run(movId, '1002', 0, b.costo || 0);
    return id;
  });
  app.get('/api/costi-mezzo', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM costi_mezzo ORDER BY data DESC').all());
  });
  app.post('/api/costi-mezzo', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const id = registraCostoMezzoTx(req.body);
    res.status(201).json({ id });
  });

  app.get('/api/visite', authMiddleware, (req, res) => {
    const rows = req.user.tipo === 'agente'
      ? db.prepare('SELECT * FROM visite WHERE agente_id = ? ORDER BY data DESC').all(req.user.id)
      : db.prepare('SELECT * FROM visite ORDER BY data DESC').all();
    res.json(rows);
  });
  app.post('/api/visite', authMiddleware, (req, res) => {
    const b = req.body; const id = uid('VI');
    const agenteId = req.user.tipo === 'agente' ? req.user.id : b.agenteId;
    db.prepare('INSERT INTO visite (id, cliente_id, agente_id, data, esito, prossima_visita) VALUES (?,?,?,?,?,?)')
      .run(id, b.clienteId, agenteId, b.data, b.esito, b.prossimaVisita || null);
    res.status(201).json({ id });
  });

  app.get('/api/comunicazioni', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT * FROM comunicazioni ORDER BY data DESC').all());
  });
  app.post('/api/comunicazioni', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const b = req.body; const id = uid('CM');
    db.prepare('INSERT INTO comunicazioni (id, agente_id, data, oggetto, corpo) VALUES (?,?,?,?,?)')
      .run(id, b.agenteId || null, b.data || new Date().toISOString().slice(0,10), b.titolo, b.messaggio);
    res.status(201).json({ id });
  });
  app.delete('/api/comunicazioni/:id', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    db.prepare('DELETE FROM comunicazioni WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/utenti', authMiddleware, requireRole('Amministratore'), (req, res) => {
    res.json(db.prepare('SELECT id, nome, cognome, ruolo, email, attivo FROM utenti').all());
  });
  app.post('/api/utenti', authMiddleware, requireRole('Amministratore'), (req, res) => {
    const bcrypt = require('bcryptjs');
    const b = req.body; const id = uid('U');
    const passwordProvvisoria = b.password || Math.random().toString(36).slice(2, 10);
    db.prepare('INSERT INTO utenti (id, nome, cognome, ruolo, email, password_hash) VALUES (?,?,?,?,?,?)')
      .run(id, b.nome, b.cognome, b.ruolo, (b.email || '').toLowerCase(), bcrypt.hashSync(passwordProvvisoria, 10));
    res.status(201).json({ id, passwordProvvisoria });
  });
  app.delete('/api/utenti/:id', authMiddleware, requireRole('Amministratore'), (req, res) => {
    db.prepare('UPDATE utenti SET attivo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/utenti/:id/reset-password', authMiddleware, requireRole('Amministratore'), (req, res) => {
    const bcrypt = require('bcryptjs');
    const utente = db.prepare('SELECT id FROM utenti WHERE id = ?').get(req.params.id);
    if (!utente) return res.status(404).json({ error: 'Utente non trovato' });
    const scelta = (req.body && req.body.nuovaPassword) || '';
    if (scelta && scelta.length < 6) return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
    const passwordProvvisoria = scelta || Math.random().toString(36).slice(2, 10);
    db.prepare('UPDATE utenti SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(passwordProvvisoria, 10), req.params.id);
    logAttivita(req.user.id, 'reset_password_utente', { id: req.params.id });
    res.json({ ok: true, passwordProvvisoria });
  });

  app.get('/api/insoluti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    res.json(db.prepare('SELECT * FROM insoluti ORDER BY data DESC').all());
  });
  app.post('/api/insoluti', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const b = req.body; const id = uid('INS');
    const fattura = db.prepare('SELECT * FROM fatture WHERE id = ?').get(b.fatturaId);
    if (!fattura) return res.status(404).json({ error: 'Fattura non trovata' });
    db.prepare('INSERT INTO insoluti (id, fattura_id, data, note, risolto) VALUES (?,?,?,?,0)')
      .run(id, b.fatturaId, b.data || new Date().toISOString().slice(0,10), b.note || '');
    res.status(201).json({ id });
  });
  app.post('/api/insoluti/:id/azione', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const insoluto = db.prepare('SELECT * FROM insoluti WHERE id = ?').get(req.params.id);
    if (!insoluto) return res.status(404).json({ error: 'Insoluto non trovato' });
    const { tipo, importo, data, conto } = req.body;
    if (!importo || importo <= 0) return res.status(400).json({ error: 'Importo non valido' });
    const movId = uid('MV');
    const oggi = data || new Date().toISOString().slice(0,10);
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, oggi, (tipo === 'perdita' ? 'Perdita su crediti — ' : 'Recupero insoluto — ') + insoluto.id, insoluto.id);
    const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    if (tipo === 'perdita') {
      insMov.run(movId, '5400', importo, 0);
      insMov.run(movId, '1100', 0, importo);
    } else {
      insMov.run(movId, conto || '1002', importo, 0);
      insMov.run(movId, '1100', 0, importo);
    }
    db.prepare("UPDATE insoluti SET risolto = 1 WHERE id = ?").run(insoluto.id);
    res.json({ ok: true });
  });

  app.get('/api/note-credito', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    res.json(db.prepare('SELECT * FROM note_credito ORDER BY data DESC').all());
  });
  app.post('/api/note-credito', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const b = req.body;
    const fattura = db.prepare('SELECT * FROM fatture WHERE id = ?').get(b.fatturaId);
    if (!fattura) return res.status(404).json({ error: 'Fattura non trovata' });
    const aliquotaMedia = fattura.imponibile > 0 ? fattura.iva / fattura.imponibile : 0.22;
    const iva = Math.round(b.importo * aliquotaMedia * 100) / 100;
    const totale = Math.round((b.importo + iva) * 100) / 100;
    const id = uid('NDC');
    db.prepare('INSERT INTO note_credito (id, data, fattura_id, importo, motivo) VALUES (?,?,?,?,?)')
      .run(id, b.data || new Date().toISOString().slice(0,10), b.fatturaId, totale, b.motivo || '');
    const movId = uid('MV');
    db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
      .run(movId, b.data || new Date().toISOString().slice(0,10), 'Nota di credito su fattura ' + fattura.numero, fattura.numero);
    const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
    insMov.run(movId, '4000', b.importo, 0);
    insMov.run(movId, '2500', iva, 0);
    insMov.run(movId, '1100', 0, totale);
    res.status(201).json({ id });
  });

  app.post('/api/agenti/:id/registra-provvigione', authMiddleware, requireRole('utente', 'Amministratore', 'Contabile'), (req, res) => {
    const agente = db.prepare('SELECT * FROM agenti WHERE id = ?').get(req.params.id);
    if (!agente) return res.status(404).json({ error: 'Agente non trovato' });
    const fattureDaRegistrare = db.prepare('SELECT * FROM fatture WHERE agente_id = ? AND provvigione_registrata = 0').all(agente.id);
    if (!fattureDaRegistrare.length) return res.json({ ok: true, importo: 0 });
    const fatturatoTotale = db.prepare('SELECT COALESCE(SUM(imponibile),0) s FROM fatture WHERE agente_id = ?').get(agente.id).s;
    const provv = calcoloProvvigione(agente, fatturatoTotale);
    const imponibileDaRegistrare = fattureDaRegistrare.reduce((s, f) => s + f.imponibile, 0);
    const importo = Math.round(imponibileDaRegistrare * provv.perc / 100 * 100) / 100;
    if (importo <= 0) return res.json({ ok: true, importo: 0 });

    const tx = db.transaction(() => {
      const movId = uid('MV');
      db.prepare('INSERT INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)')
        .run(movId, new Date().toISOString().slice(0,10), 'Provvigioni — ' + agente.nome + ' ' + agente.cognome, 'Provvigioni');
      const insMov = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
      insMov.run(movId, '5200', importo, 0);
      insMov.run(movId, '2600', 0, importo);
      const upd = db.prepare('UPDATE fatture SET provvigione_registrata = 1 WHERE id = ?');
      fattureDaRegistrare.forEach(f => upd.run(f.id));
    });
    tx();
    res.json({ ok: true, importo });
  });
};

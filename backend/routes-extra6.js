// ============================================================
// NICO CAFFÈ — routes-extra6.js
// Backup automatico e leggero del DB SQLite.
// Principio: SQLite è un file singolo — un backup fatto con VACUUM INTO
// è una copia consistente e immediatamente utilizzabile. Il restore in
// caso di fermo macchina è: stop container, sostituzione file, restart
// (pochi secondi, nessun rischio di corruzione dovuto a "hot swap" della
// connessione DB attiva nel processo Node).
//
// I backup vengono scritti su /backups, una volume Docker SEPARATA da
// quella dati (nicocaffe_data): se la volume dati va persa/corrotta, i
// backup su un'altra volume restano intatti.
// ============================================================
const fs = require('fs');
const path = require('path');

module.exports = function (app, db, deps) {
  const authMiddleware = deps.authMiddleware, requireRole = deps.requireRole, logAttivita = deps.logAttivita;

  const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
  const RETENTION = 30;
  const INTERVALLO_MS = 24 * 60 * 60 * 1000; // 24 ore

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  function nomeFileBackup() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(BACKUP_DIR, `nicocaffe-${ts}.db`);
  }

  function eseguiBackup() {
    const file = nomeFileBackup();
    db.prepare('VACUUM INTO ?').run(file);
    potaVecchiBackup();
    return file;
  }

  function potaVecchiBackup() {
    const file = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('nicocaffe-') && f.endsWith('.db'))
      .map(f => ({ nome: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    file.slice(RETENTION).forEach(f => fs.unlinkSync(f.path));
  }

  // Backup automatico ogni 24h. Nessun cron esterno: il container si autogestisce,
  // portabile su qualsiasi host Docker (Synology, Linode, altro) senza configurazione.
  setInterval(() => {
    try {
      eseguiBackup();
      console.log('Backup automatico completato:', new Date().toISOString());
    } catch (e) {
      console.error('Backup automatico fallito:', e.message);
    }
  }, INTERVALLO_MS);

  app.get('/api/backup', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    const lista = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('nicocaffe-') && f.endsWith('.db'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { nome: f, dimensioneKb: Math.round(st.size / 1024), data: new Date(st.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.data.localeCompare(a.data));
    res.json(lista);
  });

  app.post('/api/backup', authMiddleware, requireRole('utente', 'Amministratore'), (req, res) => {
    try {
      const file = eseguiBackup();
      logAttivita(req.user.id, 'backup_manuale', { file: path.basename(file) });
      res.status(201).json({ ok: true, file: path.basename(file) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

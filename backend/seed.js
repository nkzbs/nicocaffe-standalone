const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'nicocaffe.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const run = db.transaction(() => {

  const utenti = [
    { id: 'U1', nome: 'Nico', cognome: 'Esposito', ruolo: 'Amministratore', email: 'nico@nicocaffe.it', password: 'admin123' },
    { id: 'U2', nome: 'Elena', cognome: 'Forte', ruolo: 'Contabile', email: 'elena.forte@nicocaffe.it', password: 'contabile123' },
  ];
  const insUtente = db.prepare('INSERT OR IGNORE INTO utenti (id, nome, cognome, ruolo, email, password_hash) VALUES (?,?,?,?,?,?)');
  utenti.forEach(u => insUtente.run(u.id, u.nome, u.cognome, u.ruolo, u.email, hash(u.password)));

  const agenti = [
    { id: 'AG1', nome: 'Marco', cognome: 'Bianchi', zona: 'Lombardia', email: 'marco.bianchi@nicocaffe.it', telefono: '333 100 2001', scaglioni: [{ soglia: 0, perc: 4 }, { soglia: 8000, perc: 5 }, { soglia: 15000, perc: 6 }], target: 12000, bonusTarget: 300 },
    { id: 'AG2', nome: 'Laura', cognome: 'Verdi', zona: 'Toscana', email: 'laura.verdi@nicocaffe.it', telefono: '333 100 2002', scaglioni: [{ soglia: 0, perc: 3.5 }, { soglia: 8000, perc: 4.5 }, { soglia: 15000, perc: 5.5 }], target: 10000, bonusTarget: 250 },
    { id: 'AG3', nome: 'Paolo', cognome: 'Neri', zona: 'Campania', email: 'paolo.neri@nicocaffe.it', telefono: '333 100 2003', scaglioni: [{ soglia: 0, perc: 4 }, { soglia: 8000, perc: 5 }, { soglia: 15000, perc: 6 }], target: 9000, bonusTarget: 250 },
    { id: 'AG4', nome: 'Giulia', cognome: 'Rossi', zona: 'Veneto', email: 'giulia.rossi@nicocaffe.it', telefono: '333 100 2004', scaglioni: [{ soglia: 0, perc: 3.5 }, { soglia: 8000, perc: 4.5 }], target: 8000, bonusTarget: 200 },
  ];
  const insAgente = db.prepare('INSERT OR IGNORE INTO agenti (id, nome, cognome, zona, email, telefono, password_hash, scaglioni, target, bonus_target) VALUES (?,?,?,?,?,?,?,?,?,?)');
  agenti.forEach(a => insAgente.run(a.id, a.nome, a.cognome, a.zona, a.email, a.telefono, hash(a.cognome.toLowerCase() + '2026'), JSON.stringify(a.scaglioni), a.target, a.bonusTarget));

  const clienti = [
    { id: 'CL1', ragioneSociale: 'Bar Centrale Milano', piva: '01234560011', citta: 'Milano', indirizzo: 'Via Torino 12', telefono: '02 5551234', email: 'info@barcentrale.it', pagamento: '30 gg', fido: 3000, agenteId: 'AG1', scontoPercent: 0 },
    { id: 'CL2', ragioneSociale: 'Ristorante La Tavola', piva: '01234560012', citta: 'Bergamo', indirizzo: 'Via Roma 45', telefono: '035 5552345', email: 'amministrazione@latavola.it', pagamento: '60 gg', fido: 4000, agenteId: 'AG1', scontoPercent: 0 },
    { id: 'CL3', ragioneSociale: 'Caffetteria Duomo', piva: '01234560013', citta: 'Firenze', indirizzo: 'Piazza Duomo 3', telefono: '055 5553456', email: 'caffetteriaduomo@gmail.com', pagamento: '30 gg', fido: 2500, agenteId: 'AG2', scontoPercent: 0 },
    { id: 'CL4', ragioneSociale: 'Hotel Toscana Resort', piva: '01234560014', citta: 'Siena', indirizzo: 'Strada delle Crete 8', telefono: '0577 5554567', email: 'acquisti@toscanaresort.it', pagamento: '60 gg', fido: 6000, agenteId: 'AG2', scontoPercent: 5 },
    { id: 'CL5', ragioneSociale: 'Bar Partenope', piva: '01234560015', citta: 'Napoli', indirizzo: 'Via Caracciolo 21', telefono: '081 5555678', email: 'barpartenope@libero.it', pagamento: '30 gg', fido: 2000, agenteId: 'AG3', scontoPercent: 0 },
    { id: 'CL6', ragioneSociale: 'Pasticceria Vesuvio', piva: '01234560016', citta: 'Salerno', indirizzo: 'Corso Garibaldi 67', telefono: '089 5556789', email: 'info@pasticceriavesuvio.it', pagamento: '30 gg', fido: 2500, agenteId: 'AG3', scontoPercent: 0 },
    { id: 'CL7', ragioneSociale: 'Bistrot Venezia', piva: '01234560017', citta: 'Venezia', indirizzo: 'Fondamenta Nuove 9', telefono: '041 5557890', email: 'bistrotvenezia@gmail.com', pagamento: 'Immediato', fido: 1500, agenteId: 'AG4', scontoPercent: 0 },
    { id: 'CL8', ragioneSociale: 'CaffÃ¨ Storico Verona', piva: '01234560018', citta: 'Verona', indirizzo: 'Via Mazzini 5', telefono: '045 5558901', email: 'storicoverona@pec.it', pagamento: '30 gg', fido: 3000, agenteId: 'AG4', scontoPercent: 3 },
  ];
  const insCliente = db.prepare('INSERT OR IGNORE INTO clienti (id, ragione_sociale, piva, citta, indirizzo, telefono, email, pagamento, fido, agente_id, sconto_percent) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  clienti.forEach(c => insCliente.run(c.id, c.ragioneSociale, c.piva, c.citta, c.indirizzo, c.telefono, c.email, c.pagamento, c.fido, c.agenteId, c.scontoPercent));

  const fornitori = [
    { id: 'FO1', ragioneSociale: 'CaffÃ¨ Verde Import Srl', piva: '02234560021', paese: 'Italia', telefono: '010 111 2233', email: 'ordini@caffeverdeimport.it', referente: 'Bruno Tassi' },
    { id: 'FO2', ragioneSociale: 'Brasil Green Beans Export', piva: 'BR-998877', paese: 'Brasile', telefono: '+55 11 5551234', email: 'sales@brasilgreenbeans.com', referente: 'Carlos Mendes' },
    { id: 'FO3', ragioneSociale: 'Vietnam Robusta Trading', piva: 'VN-554433', paese: 'Vietnam', telefono: '+84 28 5556789', email: 'export@vietnamrobusta.vn', referente: 'Nguyen Tran' },
  ];
  const insFornitore = db.prepare('INSERT OR IGNORE INTO fornitori (id, ragione_sociale, piva, paese, telefono, email, referente) VALUES (?,?,?,?,?,?,?)');
  fornitori.forEach(f => insFornitore.run(f.id, f.ragioneSociale, f.piva, f.paese, f.telefono, f.email, f.referente));

  const prodotti = [
    { id: 'PR1', nome: 'Miscela Bar Intenso', categoria: 'Miscela', formato: 'Grani 1kg', prezzo: 14.50, costo: 8.20, scorta: 120, scortaMinima: 30, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [{ soglia: 50, sconto: 5 }, { soglia: 100, sconto: 10 }] },
    { id: 'PR2', nome: 'Miscela Bar Cremoso', categoria: 'Miscela', formato: 'Grani 1kg', prezzo: 13.80, costo: 7.90, scorta: 95, scortaMinima: 30, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [{ soglia: 50, sconto: 5 }, { soglia: 100, sconto: 10 }] },
    { id: 'PR3', nome: 'Arabica 100% Etiopia', categoria: 'Monorigine', formato: 'Grani 1kg', prezzo: 19.90, costo: 11.50, scorta: 40, scortaMinima: 20, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 82, sconti: [{ soglia: 30, sconto: 4 }] },
    { id: 'PR4', nome: 'Robusta Forte Espresso', categoria: 'Monorigine', formato: 'Grani 1kg', prezzo: 12.50, costo: 6.80, scorta: 75, scortaMinima: 25, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 86, sconti: [{ soglia: 50, sconto: 5 }] },
    { id: 'PR5', nome: 'Decaffeinato Dolce', categoria: 'Decaffeinato', formato: 'Grani 1kg', prezzo: 16.90, costo: 9.70, scorta: 28, scortaMinima: 20, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 80, sconti: [] },
    { id: 'PR6', nome: 'Macinato Moka Classico', categoria: 'Macinato', formato: 'Conf. 250g', prezzo: 4.20, costo: 2.10, scorta: 300, scortaMinima: 50, unita: 'conf', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [{ soglia: 100, sconto: 8 }] },
    { id: 'PR7', nome: 'Capsule Compatibili', categoria: 'Capsule', formato: 'Conf. 10 cps', prezzo: 3.50, costo: 1.60, scorta: 600, scortaMinima: 100, unita: 'conf', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [{ soglia: 200, sconto: 6 }] },
    { id: 'PR8', nome: 'Cialde ESE 44mm', categoria: 'Cialde', formato: 'Conf. 50', prezzo: 9.90, costo: 5.20, scorta: 80, scortaMinima: 20, unita: 'conf', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [] },
    { id: 'PR9', nome: "Crema d'Oro Grani", categoria: 'Miscela', formato: 'Grani 1kg', prezzo: 15.50, costo: 8.90, scorta: 15, scortaMinima: 20, unita: 'kg', aliquotaIva: 22, rendimentoTostatura: 84, sconti: [{ soglia: 30, sconto: 5 }] },
  ];
  const insProdotto = db.prepare('INSERT OR IGNORE INTO prodotti (id, nome, categoria, formato, prezzo, costo, scorta, scorta_minima, unita, aliquota_iva, rendimento_tostatura, sconti_quantita) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  prodotti.forEach(p => insProdotto.run(p.id, p.nome, p.categoria, p.formato, p.prezzo, p.costo, p.scorta, p.scortaMinima, p.unita, p.aliquotaIva, p.rendimentoTostatura, JSON.stringify(p.sconti)));

  const listini = [
    { id: 'LI1', nome: 'Listino HoReCa Premium', descrizione: 'Prezzi dedicati per hotel e ristoranti ad alto volume', righe: [{ prodottoId: 'PR1', prezzo: 13.00 }, { prodottoId: 'PR2', prezzo: 12.50 }, { prodottoId: 'PR3', prezzo: 18.00 }, { prodottoId: 'PR7', prezzo: 3.10 }] },
    { id: 'LI2', nome: 'Listino Bar Medio', descrizione: 'Prezzi per bar con volumi medi', righe: [{ prodottoId: 'PR1', prezzo: 14.00 }, { prodottoId: 'PR2', prezzo: 13.20 }, { prodottoId: 'PR6', prezzo: 3.90 }] },
  ];
  const insListino = db.prepare('INSERT OR IGNORE INTO listini (id, nome, descrizione) VALUES (?,?,?)');
  const insListinoRiga = db.prepare('INSERT OR IGNORE INTO listini_righe (listino_id, prodotto_id, prezzo, attivo) VALUES (?,?,?,1)');
  listini.forEach(l => { insListino.run(l.id, l.nome, l.descrizione); l.righe.forEach(r => insListinoRiga.run(l.id, r.prodottoId, r.prezzo)); });

  const insMov = db.prepare('INSERT OR IGNORE INTO movimenti (id, data, descrizione, riferimento) VALUES (?,?,?,?)');
  const insMovRiga = db.prepare('INSERT INTO movimenti_righe (movimento_id, conto, dare, avere) VALUES (?,?,?,?)');
  const movApertura = db.prepare("SELECT id FROM movimenti WHERE id = 'MV_APERTURA'").get();
  if (!movApertura) {
    insMov.run('MV_APERTURA', '2026-01-02', 'Versamento capitale sociale', 'Atto costitutivo');
    insMovRiga.run('MV_APERTURA', '1002', 20000, 0);
    insMovRiga.run('MV_APERTURA', '3000', 0, 20000);
  }

  console.log('Seed completato.');
  console.log('--- Credenziali di test ---');
  console.log('Admin:      nico@nicocaffe.it / admin123');
  console.log('Contabile:  elena.forte@nicocaffe.it / contabile123');
  console.log('Agente:     marco.bianchi@nicocaffe.it / bianchi2026');
});

run();
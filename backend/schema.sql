PRAGMA foreign_keys = ON;

CREATE TABLE utenti (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  cognome       TEXT NOT NULL,
  ruolo         TEXT NOT NULL CHECK (ruolo IN ('Amministratore','Contabile')),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  attivo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agenti (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  cognome     TEXT NOT NULL,
  zona        TEXT,
  email       TEXT NOT NULL UNIQUE,
  telefono    TEXT,
  password_hash TEXT NOT NULL,
  scaglioni   TEXT NOT NULL DEFAULT '[]',
  target      REAL DEFAULT 0,
  bonus_target REAL DEFAULT 0,
  attivo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE clienti (
  id              TEXT PRIMARY KEY,
  ragione_sociale TEXT NOT NULL,
  piva            TEXT,
  pec             TEXT,
  codice_univoco  TEXT,
  citta           TEXT,
  indirizzo       TEXT,
  telefono        TEXT,
  email           TEXT,
  pagamento       TEXT,
  tipo_pagamento  TEXT NOT NULL DEFAULT 'Bonifico' CHECK (tipo_pagamento IN ('Ri.Ba.30','Ri.Ba.30FM','Ri.Ba.60','Ri.Ba.60FM','Rimessa diretta','Contanti','Assegno','Bonifico')),
  fido            REAL DEFAULT 0,
  agente_id       TEXT REFERENCES agenti(id),
  sconto_percent  REAL DEFAULT 0,
  documenti       TEXT NOT NULL DEFAULT '[]',
  attivo          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_clienti_agente ON clienti(agente_id);

CREATE TABLE fornitori (
  id              TEXT PRIMARY KEY,
  ragione_sociale TEXT NOT NULL,
  piva            TEXT,
  paese           TEXT,
  telefono        TEXT,
  email           TEXT,
  referente       TEXT
);

CREATE TABLE prodotti (
  id                  TEXT PRIMARY KEY,
  nome                TEXT NOT NULL,
  categoria           TEXT,
  formato             TEXT,
  prezzo              REAL NOT NULL DEFAULT 0,
  costo               REAL NOT NULL DEFAULT 0,
  scorta              REAL NOT NULL DEFAULT 0,
  scorta_minima       REAL NOT NULL DEFAULT 0,
  unita               TEXT NOT NULL DEFAULT 'conf',
  aliquota_iva        REAL NOT NULL DEFAULT 22,
  rendimento_tostatura REAL,
  sconti_quantita     TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE listini (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  descrizione TEXT
);
CREATE TABLE listini_righe (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listino_id  TEXT NOT NULL REFERENCES listini(id) ON DELETE CASCADE,
  prodotto_id TEXT NOT NULL REFERENCES prodotti(id),
  prezzo      REAL NOT NULL,
  attivo      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(listino_id, prodotto_id)
);
CREATE TABLE clienti_listini (
  cliente_id TEXT PRIMARY KEY REFERENCES clienti(id) ON DELETE CASCADE,
  listino_id TEXT NOT NULL REFERENCES listini(id)
);

CREATE TABLE ordini (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clienti(id),
  agente_id  TEXT REFERENCES agenti(id),
  stato      TEXT NOT NULL CHECK (stato IN ('bozza','confermato','fatturato','annullato')) DEFAULT 'bozza',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE ordini_righe (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ordine_id       TEXT NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
  prodotto_id     TEXT NOT NULL REFERENCES prodotti(id),
  quantita        REAL NOT NULL,
  prezzo_unitario REAL NOT NULL
);
CREATE INDEX idx_ordini_cliente ON ordini(cliente_id);
CREATE INDEX idx_ordini_agente ON ordini(agente_id);

CREATE TABLE fatture (
  id          TEXT PRIMARY KEY,
  numero      TEXT NOT NULL UNIQUE,
  data        TEXT NOT NULL,
  cliente_id  TEXT NOT NULL REFERENCES clienti(id),
  agente_id   TEXT REFERENCES agenti(id),
  ordine_id   TEXT REFERENCES ordini(id),
  imponibile  REAL NOT NULL,
  iva         REAL NOT NULL,
  totale      REAL NOT NULL,
  scadenza    TEXT,
  stato       TEXT NOT NULL CHECK (stato IN ('emessa','pagata','insoluta','stornata')) DEFAULT 'emessa'
);
CREATE TABLE fatture_righe (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fattura_id      TEXT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  prodotto_id     TEXT NOT NULL REFERENCES prodotti(id),
  quantita        REAL NOT NULL,
  prezzo_unitario REAL NOT NULL
);

CREATE TABLE corrispettivi (
  id                  TEXT PRIMARY KEY,
  data                TEXT NOT NULL,
  cliente_id          TEXT REFERENCES clienti(id),
  cliente_occasionale TEXT,
  conto_incasso       TEXT NOT NULL,
  totale              REAL NOT NULL
);
CREATE TABLE corrispettivi_righe (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  corrispettivo_id TEXT NOT NULL REFERENCES corrispettivi(id) ON DELETE CASCADE,
  prodotto_id      TEXT NOT NULL REFERENCES prodotti(id),
  quantita         REAL NOT NULL,
  prezzo_unitario  REAL NOT NULL
);

CREATE TABLE note_credito (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fattura_id TEXT NOT NULL REFERENCES fatture(id),
  importo    REAL NOT NULL,
  motivo     TEXT
);

CREATE TABLE insoluti (
  id         TEXT PRIMARY KEY,
  fattura_id TEXT NOT NULL REFERENCES fatture(id),
  data       TEXT NOT NULL,
  note       TEXT,
  risolto    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE piano_conti (
  codice TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  tipo   TEXT NOT NULL CHECK (tipo IN ('attivo','passivo','patrimonio','ricavo','costo'))
);
CREATE TABLE movimenti (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  descrizione TEXT NOT NULL,
  riferimento TEXT
);
CREATE TABLE movimenti_righe (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  movimento_id TEXT NOT NULL REFERENCES movimenti(id) ON DELETE CASCADE,
  conto      TEXT NOT NULL REFERENCES piano_conti(codice),
  dare       REAL NOT NULL DEFAULT 0,
  avere      REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_mov_righe_conto ON movimenti_righe(conto);

CREATE TABLE movimenti_bancari (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  descrizione TEXT,
  importo     REAL NOT NULL,
  riconciliato INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attrezzature (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  cliente_id    TEXT REFERENCES clienti(id),
  data_acquisto TEXT,
  costo         REAL,
  vita_utile_anni REAL
);

CREATE TABLE ammortamenti_registrati (
  id           TEXT PRIMARY KEY,
  attrezzatura_id TEXT REFERENCES attrezzature(id),
  data         TEXT NOT NULL,
  importo      REAL NOT NULL
);

CREATE TABLE ordini_acquisto (
  id            TEXT PRIMARY KEY,
  data          TEXT NOT NULL,
  fornitore_id  TEXT NOT NULL REFERENCES fornitori(id),
  aliquota_iva  REAL NOT NULL DEFAULT 22,
  stato         TEXT NOT NULL CHECK (stato IN ('in_attesa','ricevuto','annullato')) DEFAULT 'in_attesa'
);
CREATE TABLE ordini_acquisto_righe (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ordine_acquisto_id TEXT NOT NULL REFERENCES ordini_acquisto(id) ON DELETE CASCADE,
  descrizione       TEXT NOT NULL,
  kg                REAL NOT NULL,
  prezzo_kg         REAL NOT NULL
);

CREATE TABLE magazzino_verde (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  kg_disponibili REAL NOT NULL DEFAULT 0
);
INSERT INTO magazzino_verde (id, kg_disponibili) VALUES (1, 0);

CREATE TABLE lotti (
  id                  TEXT PRIMARY KEY,
  prodotto_id         TEXT NOT NULL REFERENCES prodotti(id),
  data_tostatura      TEXT NOT NULL,
  scadenza            TEXT NOT NULL,
  quantita_iniziale   REAL NOT NULL,
  quantita_residua    REAL NOT NULL
);

CREATE TABLE furgoni (
  id          TEXT PRIMARY KEY,
  targa       TEXT NOT NULL,
  modello     TEXT,
  km_attuali  REAL DEFAULT 0
);
CREATE TABLE costi_mezzo (
  id         TEXT PRIMARY KEY,
  furgone_id TEXT NOT NULL REFERENCES furgoni(id),
  data       TEXT NOT NULL,
  tipo       TEXT,
  importo    REAL NOT NULL
);
CREATE TABLE giri_consegna (
  id         TEXT PRIMARY KEY,
  furgone_id TEXT REFERENCES furgoni(id),
  data       TEXT NOT NULL,
  zona       TEXT,
  note       TEXT
);

CREATE TABLE interventi (
  id              TEXT PRIMARY KEY,
  attrezzatura_id TEXT NOT NULL REFERENCES attrezzature(id),
  data            TEXT NOT NULL,
  descrizione     TEXT,
  costo           REAL DEFAULT 0
);

CREATE TABLE visite (
  id             TEXT PRIMARY KEY,
  cliente_id     TEXT NOT NULL REFERENCES clienti(id),
  agente_id      TEXT NOT NULL REFERENCES agenti(id),
  data           TEXT NOT NULL,
  esito          TEXT,
  prossima_visita TEXT
);
CREATE TABLE comunicazioni (
  id         TEXT PRIMARY KEY,
  agente_id  TEXT REFERENCES agenti(id),
  data       TEXT NOT NULL,
  oggetto    TEXT,
  corpo      TEXT
);

CREATE TABLE log_attivita (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  utente_id  TEXT,
  azione     TEXT NOT NULL,
  dettaglio  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO piano_conti (codice, nome, tipo) VALUES
 ('1001','Cassa','attivo'),
 ('1002','Banca c/c','attivo'),
 ('1100','Clienti','attivo'),
 ('1200','Magazzino caffÃ¨','attivo'),
 ('1250','Fondo ammortamento attrezzature','attivo'),
 ('1500','IVA a credito','attivo'),
 ('2100','Fornitori','passivo'),
 ('2500','IVA a debito','passivo'),
 ('2600','Debiti v/agenti per provvigioni','passivo'),
 ('3000','Capitale sociale','patrimonio'),
 ('4000','Ricavi vendite fatturate','ricavo'),
 ('4100','Ricavi da corrispettivi','ricavo'),
 ('5000','Acquisti materie prime','costo'),
 ('5200','Costi provvigioni agenti','costo'),
 ('5400','Spese generali e utenze','costo'),
 ('5600','Affitto stabilimento','costo'),
 ('5700','Costi flotta e trasporto','costo'),
 ('5800','Interventi tecnici comodati','costo'),
 ('5900','Ammortamenti','costo');
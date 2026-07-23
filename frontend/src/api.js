const TOKEN_KEY = 'nicocaffe_token';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

function snakeToCamelKey(k) {
  return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function camelToSnakeKey(k) {
  return k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}
function deepConvert(value, keyFn) {
  if (Array.isArray(value)) return value.map(v => deepConvert(v, keyFn));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[keyFn(k)] = deepConvert(v, keyFn);
    return out;
  }
  return value;
}
function toCamel(v) { return deepConvert(v, snakeToCamelKey); }
function toSnake(v) { return deepConvert(v, camelToSnakeKey); }

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Errore ' + res.status));
  return toCamel(data);
}

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),

  clienti: {
    list: () => request('GET', '/clienti'),
    create: (b) => request('POST', '/clienti', b),
    update: (id, b) => request('PUT', '/clienti/' + id, b),
    remove: (id) => request('DELETE', '/clienti/' + id),
  },
  agenti: {
    list: () => request('GET', '/agenti'),
    create: (b) => request('POST', '/agenti', b),
    update: (id, b) => request('PUT', '/agenti/' + id, b),
    remove: (id) => request('DELETE', '/agenti/' + id),
    registraProvvigione: (id) => request('POST', '/agenti/' + id + '/registra-provvigione'),
    resetPassword: (id, nuovaPassword) => request('POST', '/agenti/' + id + '/reset-password', { nuovaPassword }),
  },
  prodotti: {
    list: () => request('GET', '/prodotti'),
    create: (b) => request('POST', '/prodotti', b),
    update: (id, b) => request('PUT', '/prodotti/' + id, b),
    remove: (id) => request('DELETE', '/prodotti/' + id),
  },
  categorieProdotto: {
    list: () => request('GET', '/categorie-prodotto'),
    create: (nome) => request('POST', '/categorie-prodotto', { nome }),
  },
  ordini: {
    list: () => request('GET', '/ordini'),
    create: (b) => request('POST', '/ordini', b),
    fattura: (id) => request('POST', '/ordini/' + id + '/fattura'),
    pagamenti: (id) => request('GET', '/ordini/' + id + '/pagamenti'),
    pagamento: (id, b) => request('POST', '/ordini/' + id + '/pagamento', b),
  },
  ordiniPagamenti: {
    list: () => request('GET', '/ordini-pagamenti'),
    storna: (id) => request('POST', '/ordini-pagamenti/' + id + '/storna'),
  },
  versamenti: {
    list: (agenteId) => request('GET', '/agenti/' + agenteId + '/versamenti'),
    genera: (agenteId, b) => request('POST', '/agenti/' + agenteId + '/versamenti/genera', b),
    get: (id) => request('GET', '/versamenti/' + id),
  },
  fatture: {
    list: () => request('GET', '/fatture'),
    pagamento: (id, b) => request('POST', '/fatture/' + id + '/pagamento', b),
    pagamentoParziale: (id, b) => request('POST', '/fatture/' + id + '/pagamento-parziale', b),
    pagamenti: (id) => request('GET', '/fatture/' + id + '/pagamenti'),
  },
  fatturePagamenti: {
    storna: (pagamentoId) => request('POST', '/fatture-pagamenti/' + pagamentoId + '/storna'),
  },
  corrispettivi: {
    list: () => request('GET', '/corrispettivi'),
    create: (b) => request('POST', '/corrispettivi', b),
  },
  contabilita: {
    movimenti: () => request('GET', '/contabilita/movimenti'),
    registra: (b) => request('POST', '/contabilita/movimenti', b),
    pianoConti: () => request('GET', '/contabilita/piano-conti'),
  },
  ordiniAcquisto: {
    list: () => request('GET', '/ordini-acquisto'),
    create: (b) => request('POST', '/ordini-acquisto', b),
    ricevi: (id) => request('POST', '/ordini-acquisto/' + id + '/ricevi'),
  },
  magazzinoVerde: {
    get: () => request('GET', '/magazzino-verde'),
  },
  lotti: {
    list: () => request('GET', '/lotti'),
    create: (b) => request('POST', '/lotti', b),
  },
  fornitori: {
    list: () => request('GET', '/fornitori'),
    create: (b) => request('POST', '/fornitori', b),
    update: (id, b) => request('PUT', '/fornitori/' + id, b),
    remove: (id) => request('DELETE', '/fornitori/' + id),
  },
  listini: {
    list: () => request('GET', '/listini'),
    create: (b) => request('POST', '/listini', b),
    update: (id, b) => request('PUT', '/listini/' + id, b),
    remove: (id) => request('DELETE', '/listini/' + id),
  },
  attrezzature: {
    list: () => request('GET', '/attrezzature'),
    create: (b) => request('POST', '/attrezzature', b),
    update: (id, b) => request('PUT', '/attrezzature/' + id, b),
    remove: (id) => request('DELETE', '/attrezzature/' + id),
  },
  interventi: {
    list: () => request('GET', '/interventi'),
    create: (b) => request('POST', '/interventi', b),
  },
  furgoni: {
    list: () => request('GET', '/furgoni'),
    create: (b) => request('POST', '/furgoni', b),
    update: (id, b) => request('PUT', '/furgoni/' + id, b),
    remove: (id) => request('DELETE', '/furgoni/' + id),
    assegnaAgente: (id, agenteId) => request('PUT', '/furgoni/' + id + '/agente', { agenteId }),
    giacenza: (id) => request('GET', '/furgoni/' + id + '/giacenza'),
    carico: (id, prodottoId, quantita) => request('POST', '/furgoni/' + id + '/carico', { prodottoId, quantita }),
  },
  costiMezzo: {
    list: () => request('GET', '/costi-mezzo'),
    create: (b) => request('POST', '/costi-mezzo', b),
  },
  giriConsegna: {
    list: () => request('GET', '/giri-consegna'),
    create: (b) => request('POST', '/giri-consegna', b),
  },
  visite: {
    list: () => request('GET', '/visite'),
    create: (b) => request('POST', '/visite', b),
  },
  comunicazioni: {
    list: () => request('GET', '/comunicazioni'),
    create: (b) => request('POST', '/comunicazioni', b),
    remove: (id) => request('DELETE', '/comunicazioni/' + id),
  },
  utenti: {
    list: () => request('GET', '/utenti'),
    create: (b) => request('POST', '/utenti', b),
    remove: (id) => request('DELETE', '/utenti/' + id),
    resetPassword: (id, nuovaPassword) => request('POST', '/utenti/' + id + '/reset-password', { nuovaPassword }),
  },
  insoluti: {
    list: () => request('GET', '/insoluti'),
    create: (b) => request('POST', '/insoluti', b),
    azione: (id, b) => request('POST', '/insoluti/' + id + '/azione', b),
    sollecito: (id, b) => request('POST', '/insoluti/' + id + '/sollecito', b),
    solleciti: (id) => request('GET', '/insoluti/' + id + '/solleciti'),
  },
  noteCredito: {
    list: () => request('GET', '/note-credito'),
    create: (b) => request('POST', '/note-credito', b),
  },
  ammortamenti: {
    list: () => request('GET', '/ammortamenti'),
    registra: (b) => request('POST', '/ammortamenti/registra', b),
  },
};

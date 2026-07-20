const TOKEN_KEY = 'nicocaffe_token';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

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
  return data;
}

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),

  clienti: {
    list: () => request('GET', '/clienti'),
    create: (b) => request('POST', '/clienti', b),
    update: (id, b) => request('PUT', '/clienti/' + id, b),
  },
  agenti: {
    list: () => request('GET', '/agenti'),
    create: (b) => request('POST', '/agenti', b),
  },
  prodotti: {
    list: () => request('GET', '/prodotti'),
    update: (id, b) => request('PUT', '/prodotti/' + id, b),
  },
  ordini: {
    list: () => request('GET', '/ordini'),
    create: (b) => request('POST', '/ordini', b),
    fattura: (id) => request('POST', '/ordini/' + id + '/fattura'),
  },
  fatture: {
    list: () => request('GET', '/fatture'),
    pagamento: (id, b) => request('POST', '/fatture/' + id + '/pagamento', b),
  },
  corrispettivi: {
    create: (b) => request('POST', '/corrispettivi', b),
  },
  contabilita: {
    movimenti: () => request('GET', '/contabilita/movimenti'),
    registra: (b) => request('POST', '/contabilita/movimenti', b),
    pianoConti: () => request('GET', '/contabilita/piano-conti'),
  },
  ordiniAcquisto: {
    ricevi: (id) => request('POST', '/ordini-acquisto/' + id + '/ricevi'),
  },
  magazzinoVerde: {
    get: () => request('GET', '/magazzino-verde'),
  },
  lotti: {
    list: () => request('GET', '/lotti'),
  },
};
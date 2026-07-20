# Integrazione API nel frontend esistente

Il file nicocaffe-gestionale.jsx.tsx originale usa window.storage (non il
vero localStorage) per persistere i dati. Va sostituito con chiamate reali
verso il backend, importando frontend/src/api.js.

## 1. Bootstrap App() â€” sostituisci useEffect + setDb

```jsx
import { useState, useEffect } from 'react';
import { api, getToken, setToken, clearToken } from './api';

export default function App() {
  const [db, setDbRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [errore, setErrore] = useState('');

  async function caricaDatiReali() {
    const [clienti, agenti, prodotti, ordini, fatture, movimenti, pianoConti, magazzinoVerde, lotti] = await Promise.all([
      api.clienti.list(), api.agenti.list(), api.prodotti.list(), api.ordini.list(),
      api.fatture.list(), api.contabilita.movimenti(), api.contabilita.pianoConti(),
      api.magazzinoVerde.get(), api.lotti.list(),
    ]);
    setDbRaw({
      clienti, agenti, prodotti, ordini, fatture, movimenti, pianoConti,
      magazzinoVerde, lotti,
      fornitori: [], listini: [], attrezzature: [], interventi: [],
      furgoni: [], costiMezzo: [], giriConsegna: [], insoluti: [],
      corrispettivi: [], noteCredito: [], ordiniAcquisto: [],
      visite: [], comunicazioni: [], movimentiBancari: [], logAttivita: [], utenti: [],
    });
  }

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    api.me()
      .then(profilo => { setSession(profilo); return caricaDatiReali(); })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  function setDb(updater) {
    setDbRaw(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }

  async function handleLogin(email, password) {
    setErrore('');
    try {
      const { token, profilo } = await api.login(email, password);
      setToken(token);
      setSession(profilo);
      await caricaDatiReali();
    } catch (e) {
      setErrore(e.message);
    }
  }

  function handleLogout() {
    clearToken();
    setSession(null);
    setDbRaw(null);
  }

  if (loading) return <div>Caricamento gestionale...</div>;
  if (!session || !db) return <LoginScreen onLogin={handleLogin} errore={errore} />;

  if (session.tipo === 'utente') {
    return <AdminApp db={db} setDb={setDb} onLogout={handleLogout} utente={session} />;
  }
  const agente = db.agenti.find(a => a.id === session.id);
  return <AgentApp db={db} setDb={setDb} agente={agente} onLogout={handleLogout} />;
}
```

## 2. LoginScreen â€” sostituisci handleLogin

```jsx
function handleLogin() {
  setError('');
  onLogin(email.trim(), password);
}
```

Sostituisci lo state locale `error` con `props.errore` nel JSX, oppure aggiungi:
```jsx
useEffect(() => setError(props.errore || ''), [props.errore]);
```

## 3. Ancora da fare (vista per vista)

Ogni chiamata setDb(...) che crea/modifica un'entitÃ  (nuovo cliente, nuovo
ordine, nuova fattura, ecc.) va sostituita con la relativa chiamata api.*,
seguita da un refresh della lista interessata. Esempio per ClientiView:

```jsx
// PRIMA
setDb(d => ({ ...d, clienti: [...d.clienti, nuovoCliente] }));

// DOPO
await api.clienti.create(nuovoCliente);
const clienti = await api.clienti.list();
setDb(d => ({ ...d, clienti }));
```

Stesso pattern per: agenti, prodotti, ordini (+ fattura), corrispettivi,
movimenti contabili, ordini d'acquisto (ricevi).

Flotta, CRM (visite/comunicazioni) e provvigioni non hanno ancora route
backend â€” restano locali/vuote finchÃ© non le aggiungiamo.
with open('App.jsx', 'r') as f:
    content = f.read()

def apply(old, new, label):
    global content
    count = content.count(old)
    if count != 1:
        print(f"ATTENZIONE: '{label}' trovato {count} volte (atteso 1) — patch NON applicata.")
        return
    content = content.replace(old, new, 1)
    print(f"OK: '{label}' applicata.")

# ---------- PATCH: aggiungi state pagamentoParziale in FatturazioneView ----------
old1 = """  const [payFattura, setPayFattura] = useState(null);
  const [notaTarget, setNotaTarget] = useState(null);"""

new1 = """  const [payFattura, setPayFattura] = useState(null);
  const [parzialeFattura, setParzialeFattura] = useState(null);
  const [importoParziale, setImportoParziale] = useState('');
  const [notaTarget, setNotaTarget] = useState(null);"""

apply(old1, new1, "FatturazioneView state parziale")

# ---------- PATCH: aggiungi funzione confermaPagamentoParziale dopo confermaPagamento ----------
old2 = """  async function emettiNota() {"""

new2 = """  async function confermaPagamentoParziale() {
    const imp = parseFloat(importoParziale);
    if (!imp || imp <= 0) return;
    setBusy(true);
    try {
      await api.fatture.pagamentoParziale(parzialeFattura.id, { importo: imp, conto: contoPagamento });
      await refreshDopoContabile();
      setParzialeFattura(null); setImportoParziale('');
    } catch (e) {
      alert('Errore pagamento parziale: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function emettiNota() {"""

apply(old2, new2, "FatturazioneView confermaPagamentoParziale")

# ---------- PATCH: aggiungi pulsante "Parziale" accanto a "Incassa" ----------
old3 = """                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => setPayFattura(r)}>Incassa</Button>}"""

new3 = """                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => setPayFattura(r)}>Incassa</Button>}
                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => { setParzialeFattura(r); setImportoParziale(''); }}>Parziale</Button>}"""

apply(old3, new3, "FatturazioneView pulsante Parziale")

# ---------- PATCH: aggiungi il Modal del pagamento parziale, subito prima di {notaTarget && ( ----------
old4 = """      {notaTarget && ("""

new4 = """      {parzialeFattura && (
        <Modal title={`Pagamento parziale — ${parzialeFattura.numero}`} onClose={() => setParzialeFattura(null)}>
          <div className="space-y-4">
            <div className="flex justify-between text-sm"><span className="text-stone-500">Totale fattura</span><span className="font-mono-num">{formatEUR(parzialeFattura.totale)}</span></div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Importo incassato ora (€)</label>
              <input type="number" step="0.01" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={importoParziale} onChange={e => setImportoParziale(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Conto</label>
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" value={contoPagamento} onChange={e => setContoPagamento(e.target.value)}>
                <option value="1002">Banca c/c</option>
                <option value="1001">Cassa</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setParzialeFattura(null)}>Annulla</Button>
              <Button onClick={confermaPagamentoParziale} disabled={busy}>{busy ? 'Registrazione…' : 'Registra pagamento parziale'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {notaTarget && ("""

apply(old4, new4, "FatturazioneView modal pagamento parziale")

with open('App.jsx', 'w') as f:
    f.write(content)

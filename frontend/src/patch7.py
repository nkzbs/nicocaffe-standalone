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

# ---------- PATCH: aggiungi state per lista pagamenti + funzione storno ----------
old1 = """  const [parzialeFattura, setParzialeFattura] = useState(null);
  const [importoParziale, setImportoParziale] = useState('');"""

new1 = """  const [parzialeFattura, setParzialeFattura] = useState(null);
  const [importoParziale, setImportoParziale] = useState('');
  const [pagamentiFattura, setPagamentiFattura] = useState([]);"""

apply(old1, new1, "FatturazioneView state pagamentiFattura")

# ---------- PATCH: quando si apre il modal Incassa, carica anche i pagamenti fatti finora ----------
old2 = """                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => setPayFattura(r)}>Incassa</Button>}"""

new2 = """                {r.stato !== 'pagata' && <Button size="sm" variant="ghost" onClick={() => { setPayFattura(r); api.fatture.pagamenti(r.id).then(setPagamentiFattura).catch(() => setPagamentiFattura([])); }}>Incassa</Button>}"""

apply(old2, new2, "FatturazioneView carica pagamenti su apertura modal")

# ---------- PATCH: aggiungi funzione stornaPagamento ----------
old3 = """  async function confermaPagamentoParziale() {"""

new3 = """  async function stornaPagamento(pagamentoId) {
    try {
      await api.fatturePagamenti.storna(pagamentoId);
      await refreshDopoContabile();
      const pagamenti = await api.fatture.pagamenti(payFattura.id);
      setPagamentiFattura(pagamenti);
    } catch (e) {
      alert('Errore storno: ' + e.message);
    }
  }

  async function confermaPagamentoParziale() {"""

apply(old3, new3, "FatturazioneView funzione stornaPagamento")

# ---------- PATCH: mostra la lista pagamenti con storno dentro il modal "Incassa" ----------
old4 = """            <div className="flex justify-between text-sm"><span className="text-stone-500">Totale fattura</span><span className="font-mono-num">{formatEUR(payFattura.totale)}</span></div>
            <p className="text-xs text-stone-400">Il backend reale registra sempre l'incasso completo del residuo (i pagamenti parziali non sono ancora supportati).</p>"""

new4 = """            <div className="flex justify-between text-sm"><span className="text-stone-500">Totale fattura</span><span className="font-mono-num">{formatEUR(payFattura.totale)}</span></div>
            {pagamentiFattura.length > 0 && (
              <div>
                <p className="text-xs font-medium text-stone-500 mb-1">Pagamenti parziali registrati</p>
                {pagamentiFattura.map(p => (
                  <div key={p.id} className={cn('flex items-center justify-between text-xs py-1', p.stornato ? 'line-through text-stone-400' : '')}>
                    <span>{formatDate(p.data)} — {formatEUR(p.importo)}</span>
                    {!p.stornato && <button onClick={() => stornaPagamento(p.id)} className="text-red-600 hover:underline ml-2">Storna</button>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-stone-400">Questo pulsante incassa sempre l'intero residuo. Per un pagamento parziale usa il pulsante "Parziale" nella tabella.</p>"""

apply(old4, new4, "FatturazioneView mostra lista pagamenti con storno")

with open('App.jsx', 'w') as f:
    f.write(content)

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

# ---------- PATCH: CentriCostoView riceve setDb (già lo riceve) e aggiunge stato + funzione registrazione reale ----------
old1 = """function CentriCostoView({ db, setDb }) {
  const cc = useMemo(() => calcolaCentriCosto(db.movimenti), [db.movimenti]);
  const ebitda = useMemo(() => calcolaEBITDA(db), [db.movimenti, db.attrezzature]);
  const ammMese = useMemo(() => ammortamentoMensileTotale(db), [db.attrezzature]);
  const maxImporto = Math.max(1, ...cc.rows.map(r => r.importo));

  return ("""

new1 = """function CentriCostoView({ db, setDb }) {
  const cc = useMemo(() => calcolaCentriCosto(db.movimenti), [db.movimenti]);
  const ebitda = useMemo(() => calcolaEBITDA(db), [db.movimenti, db.attrezzature]);
  const ammMese = useMemo(() => ammortamentoMensileTotale(db), [db.attrezzature]);
  const maxImporto = Math.max(1, ...cc.rows.map(r => r.importo));
  const [registrando, setRegistrando] = useState(false);
  const meseCorrente = todayISO().slice(0, 7);
  const giaRegistrato = (db.ammortamentiMesi || []).includes(meseCorrente);

  async function registraAmmortamento() {
    setRegistrando(true);
    try {
      const res = await api.ammortamenti.registra({ mese: meseCorrente });
      if (res.importo > 0) alert(`Ammortamento registrato: ${formatEUR(res.importo)}`);
      else alert('Nessun ammortamento da registrare (nessuna attrezzatura in comodato).');
      const [movimenti, ammortamentiMesi] = await Promise.all([api.contabilita.movimenti(), api.ammortamenti.list()]);
      setDb(d => ({ ...d, movimenti, ammortamentiMesi: ammortamentiMesi.map(r => r.mese) }));
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setRegistrando(false);
    }
  }

  return ("""

apply(old1, new1, "CentriCostoView stato+funzione ammortamento")

# ---------- PATCH: sostituisci la Card statica con una che ha il pulsante funzionante ----------
old2 = """      <Card>
        <p className="text-sm font-medium text-stone-700">Ammortamento attrezzature in comodato (stima)</p>
        <p className="text-xs text-stone-400 mt-1">Quota mensile stimata: {formatEUR(ammMese)} (durata {DURATA_AMMORTAMENTO_ANNI} anni, quote costanti). Registrazione mensile via contabilità manuale — nessuna route dedicata ancora.</p>
      </Card>"""

new2 = """      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-medium text-stone-700">Ammortamento attrezzature in comodato</p>
            <p className="text-xs text-stone-400 mt-1">Quota mensile stimata: {formatEUR(ammMese)} (durata {DURATA_AMMORTAMENTO_ANNI} anni, quote costanti)</p>
          </div>
          {giaRegistrato
            ? <Badge tone="success">Mese corrente già registrato</Badge>
            : <Button size="sm" onClick={registraAmmortamento} disabled={registrando}>{registrando ? 'Registrazione…' : `Registra ammortamento ${monthLabel(meseCorrente+'-01')}`}</Button>}
        </div>
      </Card>"""

apply(old2, new2, "CentriCostoView Card ammortamento con pulsante")

with open('App.jsx', 'w') as f:
    f.write(content)

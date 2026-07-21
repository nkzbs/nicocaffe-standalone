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

old1 = """function LottiView({ db }) {
  const oggi = todayISO();
  const lotti = [...(db.lotti || [])].sort((a, b) => a.scadenza.localeCompare(b.scadenza));

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-amber-100 px-4 py-2 text-xs text-stone-500">Lettura dal backend reale. La produzione/tostatura non ha ancora una route di scrittura.</div>
      <DataTable"""

new1 = """function LottiView({ db, setDb }) {
  const oggi = todayISO();
  const [showProd, setShowProd] = useState(false);
  const [saving, setSaving] = useState(false);
  const lotti = [...(db.lotti || [])].sort((a, b) => a.scadenza.localeCompare(b.scadenza));

  const prodFields = [
    { name: 'data', label: 'Data tostatura', type: 'date' },
    { name: 'prodottoId', label: 'Prodotto da produrre', type: 'select', options: db.prodotti.filter(p => p.unita === 'kg').map(p => ({ value: p.id, label: p.nome })) },
    { name: 'kgVerde', label: 'Kg caffè verde impiegati', type: 'number' },
  ];

  async function avviaProduzione(values) {
    setSaving(true);
    try {
      const res = await api.lotti.create(values);
      const [lotti2, prodotti, magazzinoVerde] = await Promise.all([api.lotti.list(), api.prodotti.list(), api.magazzinoVerde.get()]);
      setDb(d => ({ ...d, lotti: lotti2, prodotti, magazzinoVerde }));
      alert(`Tostatura registrata: ${res.kgOttenuti} kg ottenuti.`);
      setShowProd(false);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button onClick={() => setShowProd(true)}><Plus size={15} /> Nuova tostatura</Button></div>
      {showProd && <FormModal title="Avvia tostatura" fields={prodFields} initial={{ data: todayISO() }} onClose={() => setShowProd(false)} onSave={avviaProduzione} saving={saving} />}
      <DataTable"""

apply(old1, new1, "LottiView nuova tostatura")

old2 = """      {active === 'lotti'          && <LottiView db={db} />}"""
new2 = """      {active === 'lotti'          && <LottiView db={db} setDb={setDb} />}"""
apply(old2, new2, "AdminApp passa setDb a LottiView")

with open('App.jsx', 'w') as f:
    f.write(content)

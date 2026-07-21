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

# ---------- PATCH: aggiungi stato e campi per nuovo giro in FlottaView ----------
old1 = """function FlottaView({ db, setDb }) {
  const [subTab, setSubTab] = useState('furgoni');
  const [newFurgone, setNewFurgone] = useState(null);
  const [newCosto, setNewCosto] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);"""

new1 = """function FlottaView({ db, setDb }) {
  const [subTab, setSubTab] = useState('furgoni');
  const [newFurgone, setNewFurgone] = useState(null);
  const [newCosto, setNewCosto] = useState(null);
  const [newGiro, setNewGiro] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const giroFields = [
    { name: 'data', label: 'Data giro', type: 'date' },
    { name: 'furgoneId', label: 'Furgone', type: 'select', options: (db.furgoni||[]).map(f => ({ value: f.id, label: `${f.targa} — ${f.modello}` })) },
    { name: 'zona', label: 'Zona' },
    { name: 'note', label: 'Note', full: true },
  ];

  async function salvaGiro(values) {
    setSaving(true);
    try {
      await api.giriConsegna.create(values);
      const giriConsegna = await api.giriConsegna.list();
      setDb(d => ({ ...d, giriConsegna }));
      setNewGiro(null);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }"""

apply(old1, new1, "FlottaView stato+fields+funzione giro")

# ---------- PATCH: aggiungi 'giri' al tab switcher ----------
old2 = """          {[{ id: 'furgoni', label: 'Furgoni' }, { id: 'costi', label: 'Costi mezzo' }].map(t => ("""

new2 = """          {[{ id: 'furgoni', label: 'Furgoni' }, { id: 'costi', label: 'Costi mezzo' }, { id: 'giri', label: 'Giri di consegna' }].map(t => ("""

apply(old2, new2, "FlottaView tab switcher con giri")

# ---------- PATCH: aggiungi pulsante "Nuovo giro" ----------
old3 = """        {subTab === 'costi' && <Button size="sm" onClick={() => setNewCosto({})}><Plus size={14} /> Nuovo costo</Button>}
      </div>"""

new3 = """        {subTab === 'costi' && <Button size="sm" onClick={() => setNewCosto({})}><Plus size={14} /> Nuovo costo</Button>}
        {subTab === 'giri' && <Button size="sm" onClick={() => setNewGiro({})}><Plus size={14} /> Nuovo giro</Button>}
      </div>"""

apply(old3, new3, "FlottaView pulsante nuovo giro")

# ---------- PATCH: aggiungi la tabella dei giri, subito prima del blocco {newFurgone && ... ----------
old4 = """      {newFurgone && <FormModal title={newFurgone.id ? 'Modifica furgone' : 'Nuovo furgone'} fields={furgoneFields} initial={newFurgone.id ? newFurgone : {}} onClose={() => setNewFurgone(null)} onSave={salvaFurgone} saving={saving} />}"""

new4 = """      {subTab === 'giri' && (
        <DataTable
          columns={[
            { key: 'data', label: 'Data', render: r => formatDate(r.data) },
            { key: 'furgone', label: 'Furgone', render: r => { const f = (db.furgoni||[]).find(x=>x.id===r.furgoneId); return f ? f.targa : '—'; }},
            { key: 'zona', label: 'Zona' },
            { key: 'note', label: 'Note', render: r => <span className="text-xs text-stone-500">{r.note}</span> },
          ]}
          rows={[...(db.giriConsegna||[])].sort((a,b)=>b.data.localeCompare(a.data))}
          empty="Nessun giro di consegna registrato."
        />
      )}

      {newFurgone && <FormModal title={newFurgone.id ? 'Modifica furgone' : 'Nuovo furgone'} fields={furgoneFields} initial={newFurgone.id ? newFurgone : {}} onClose={() => setNewFurgone(null)} onSave={salvaFurgone} saving={saving} />}"""

apply(old4, new4, "FlottaView tabella giri")

# ---------- PATCH: aggiungi il FormModal del nuovo giro, subito dopo quello dei costi ----------
old5 = """      {newCosto && <FormModal title="Nuovo costo mezzo" fields={costoFields} initial={{ data: todayISO(), tipo: 'carburante' }} onClose={() => setNewCosto(null)} onSave={salvaCosto} saving={saving} />}"""

new5 = """      {newCosto && <FormModal title="Nuovo costo mezzo" fields={costoFields} initial={{ data: todayISO(), tipo: 'carburante' }} onClose={() => setNewCosto(null)} onSave={salvaCosto} saving={saving} />}
      {newGiro && <FormModal title="Nuovo giro di consegna" fields={giroFields} initial={{ data: todayISO() }} onClose={() => setNewGiro(null)} onSave={salvaGiro} saving={saving} />}"""

apply(old5, new5, "FlottaView FormModal nuovo giro")

with open('App.jsx', 'w') as f:
    f.write(content)

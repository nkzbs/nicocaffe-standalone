import sys

with open('App.jsx', 'r') as f:
    content = f.read()

def apply(old, new, label):
    global content
    count = content.count(old)
    if count != 1:
        print(f"ATTENZIONE: '{label}' trovato {count} volte (atteso 1) — patch NON applicata per questo blocco.")
        return
    content = content.replace(old, new, 1)
    print(f"OK: '{label}' applicata.")

# ---------- PATCH 1: InsolutiView salvaSollecito -> chiamata API reale ----------
old1 = """  function salvaSollecito() {
    setDb(d => ({
      ...d,
      insoluti: d.insoluti.map(i => i.id === sollecitoTarget.id
        ? { ...i, solleciti: [...(i.solleciti || []), { id: uid('SOL'), data: oggi, ...sollForm }] }
        : i),
    }));
    setSollecitoTarget(null); setSollForm({ canale: 'telefono', note: '' });
  }"""

new1 = """  async function salvaSollecito() {
    try {
      await api.insoluti.sollecito(sollecitoTarget.id, { data: oggi, ...sollForm });
      alert('Sollecito registrato.');
      setSollecitoTarget(null); setSollForm({ canale: 'telefono', note: '' });
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }"""

apply(old1, new1, "InsolutiView.salvaSollecito")

# ---------- PATCH 2: colonna "Solleciti (locale)" -> testo semplice ----------
old2 = "            { key: 'solleciti', label: 'Solleciti (locale)', align: 'right', render: r => (r.solleciti||[]).length },"
new2 = "            { key: 'solleciti', label: 'Solleciti', align: 'right', render: r => '—' },"
apply(old2, new2, "InsolutiView colonna solleciti")

with open('App.jsx', 'w') as f:
    f.write(content)

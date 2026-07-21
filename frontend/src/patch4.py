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

# ---------- PATCH: bootstrap carica ammortamentiMesi e giriConsegna ----------
old1 = """      api.fornitori.list(), api.listini.list(), api.corrispettivi.list(), api.ordiniAcquisto.list(),
      api.attrezzature.list(), api.interventi.list(), api.furgoni.list(), api.costiMezzo.list(),
      api.visite.list(), api.comunicazioni.list(),
    ]);"""

new1 = """      api.fornitori.list(), api.listini.list(), api.corrispettivi.list(), api.ordiniAcquisto.list(),
      api.attrezzature.list(), api.interventi.list(), api.furgoni.list(), api.costiMezzo.list(),
      api.visite.list(), api.comunicazioni.list(), api.giriConsegna.list(),
    ]);
    const ammortamentiMesiRes = await safeList(() => api.ammortamenti.list());
    const ammortamentiMesi = ammortamentiMesiRes.map(r => r.mese);"""

apply(old1, new1, "bootstrap fetch ammortamenti+giri (destructuring)")

old2 = """      visite, comunicazioni,
    ] = await Promise.all(["""

new2 = """      visite, comunicazioni, giriConsegna,
    ] = await Promise.all(["""

apply(old2, new2, "bootstrap destructuring array giriConsegna")

old3 = """      attrezzature, interventi, furgoni, costiMezzo, visite, comunicazioni,
      insoluti, noteCredito, utenti,
      ammortamentiRegistrati: [],
    });"""

new3 = """      attrezzature, interventi, furgoni, costiMezzo, visite, comunicazioni, giriConsegna,
      insoluti, noteCredito, utenti,
      ammortamentiMesi,
    });"""

apply(old3, new3, "bootstrap setDbRaw include giriConsegna+ammortamentiMesi")

with open('App.jsx', 'w') as f:
    f.write(content)

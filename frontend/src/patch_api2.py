with open('api.js', 'r') as f:
    content = f.read()

old = """  lotti: {
    list: () => request('GET', '/lotti'),
  },"""

new = """  lotti: {
    list: () => request('GET', '/lotti'),
    create: (b) => request('POST', '/lotti', b),
  },"""

count = content.count(old)
if count != 1:
    print(f"ATTENZIONE: trovato {count} volte (atteso 1)")
else:
    content = content.replace(old, new, 1)
    print("OK: lotti.create aggiunto")

with open('api.js', 'w') as f:
    f.write(content)

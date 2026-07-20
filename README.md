# Nico CaffÃ¨ â€” Gestionale standalone

Istanza Docker a sÃ© stante, fuori dal Super Admin di Platform. Riusa i pattern
infrastrutturali di Platform (nginx+Node+supervisord in un container, SQLite
per-tenant, JWT) ma con backend/frontend dedicati (non schema-driven).

## Struttura

```
backend/server.js                 - bootstrap Express, auth, clienti/agenti/prodotti/ordini/contabilitÃ 
backend/routes-fatturazione.js    - fatture, corrispettivi, acquisti/magazzino verde
backend/schema.sql                - schema SQLite completo
backend/seed.js                   - dati di esempio (password hashate con bcrypt)
backend/package.json
frontend/src/api.js               - client fetch verso il backend reale
frontend/INTEGRAZIONE_API.md      - come collegare App.jsx e LoginScreen esistenti
Dockerfile, nginx.conf, supervisord.conf, docker-compose.yml, .env.example, .gitignore
```

## Setup locale

```bash
cp .env.example .env      # imposta JWT_SECRET vero

docker compose build
docker compose up -d
docker compose logs -f

# prima volta: esegui il seed dentro il container
docker compose exec nicocaffe node seed.js

curl http://localhost:4100/api/health
```

Credenziali demo dopo il seed:
- Admin: nico@nicocaffe.it / admin123
- Contabile: elena.forte@nicocaffe.it / contabile123
- Agente: marco.bianchi@nicocaffe.it / bianchi2026

## Stato

Backend: auth, clienti, agenti, prodotti, ordini, fatture, corrispettivi,
contabilitÃ  (partita doppia con controllo dare=avere), acquisti/magazzino
verde/lotti sono collegati a SQLite reale.

Ancora da collegare: flotta, CRM (visite/comunicazioni), provvigioni agenti
(logica presente nel prototipo originale, va portata lato backend).

Frontend: il file nicocaffe-gestionale.jsx.tsx originale va adattato seguendo
frontend/INTEGRAZIONE_API.md â€” bootstrap e login collegati al backend reale,
le singole viste (creazione cliente/ordine/ecc.) vanno agganciate una per una.
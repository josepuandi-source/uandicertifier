# Certify — U&I Global stamp tool

Drag-and-drop PDF / PNG / JPEG files → each comes back with the "certified true copy" stamp and the date filled in.

Each person signs in with their name and a 4-digit PIN, and can only stamp with their own stamp. Documents are stamped in the browser (pdf-lib + canvas) and never uploaded. The only server code is the sign-in and stamp API in `api/` + `server/auth.js`.

## People, stamps and PINs
- The people and where each date goes: `src/certifiers.js`.
- Stamp images: `stamps/<id>.png`. This folder is private; `/api/stamp` only returns the signed-in person's own stamp.
- PINs are stored as hashes in Vercel environment variables `PIN_JOSE`, `PIN_GASELLE`, `PIN_SUZZY`, `PIN_LILLIAN`, plus `SESSION_SECRET` for sign-in cookies.
- Change a PIN: `npm run pin -- <id> <new pin>` → paste the printed value into that person's `PIN_<ID>` variable in Vercel → redeploy. Their old sessions stop working.
- Add a person: add them to `src/certifiers.js`, add `stamps/<id>.png`, set `PIN_<ID>` in Vercel, redeploy.
- After 5 wrong PINs, that name is locked for 15 minutes from that address. The lock lives in server memory, so it resets if Vercel restarts the server; every wrong PIN also has a short delay.
- For local testing, put the same variables in `.env.local`.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
- **Option A:** push this folder to a GitHub repo → vercel.com → Add New Project → import the repo → Deploy (auto-detects Vite).
- **Option B:** `npm i -g vercel` → `vercel` in this folder → `vercel --prod`.

The site is marked `noindex`. Stamps are only served after sign-in, so Deployment Protection is not needed (and would block other staff).


## Options
- Date (defaults to today, printed DD/MM/YYYY)
- Position: corners, bottom centre, centre
- Size: 15–60% of page width
- PDFs: every page or first page only (rotated pages handled)
- Images: output as PDF or in their original format

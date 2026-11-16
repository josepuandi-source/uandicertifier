# Certify — U&I Global stamp tool

Drag-and-drop PDF / PNG / JPEG files → each comes back with the "certified true copy" stamp and the date filled in.

Everything runs in the browser (pdf-lib + canvas). No server, no uploads, no storage.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
- **Option A:** push this folder to a GitHub repo → vercel.com → Add New Project → import the repo → Deploy (auto-detects Vite).
- **Option B:** `npm i -g vercel` → `vercel` in this folder → `vercel --prod`.

The site is marked `noindex`. Recommend turning on **Vercel Deployment Protection** (Project → Settings → Deployment Protection) so only you can open it — the stamp image includes your signature.

## Changing the stamp
Stamps live in `public/stamps/<id>.png` (black ink, transparent background), one per certifier. The list of certifiers and where each one's date goes (`x`, `baseline`, `maxW`, `font`, `angle`) is the `CERTIFIERS` array at the top of `src/stamp.js`. To add someone: drop in their PNG and add an entry.

## Options
- Certified by: currently Jose only. Gaselle and Suzzy are set up but hidden; set `enabled: true` on them in `src/stamp.js` to bring the selector back.
- Date (defaults to today, printed DD/MM/YYYY)
- Position: corners, bottom centre, centre
- Size: 15–60% of page width
- PDFs: every page or first page only (rotated pages handled)
- Images: output as PDF or in their original format

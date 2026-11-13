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
Replace `public/stamp.png` (transparent background PNG). If the layout changes, adjust the `DATE_X`, `DATE_BASELINE`, `DATE_MAX_W` constants at the top of `src/stamp.js` (fractions of the stamp image's width/height).

## Options
- Date (defaults to today, printed DD/MM/YYYY)
- Position: corners, bottom centre, centre
- Size: 15–60% of page width
- PDFs: every page or first page only (rotated pages handled)
- Images: output as PDF or in their original format

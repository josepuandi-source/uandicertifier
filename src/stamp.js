import { PDFDocument, degrees } from 'pdf-lib';

import { certifierById } from './certifiers.js';

// Stamps narrower than this are upscaled before the date is drawn, so the
// date text stays crisp on low-resolution scans.
const MIN_RENDER_W = 1200;

export const ACCEPTED = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
};

export function detectType(file) {
  if (ACCEPTED[file.type]) return ACCEPTED[file.type];
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  return null;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// The signed-in person's stamp, fetched from the API (only their own is served).
let stampImgPromise = null;
export const forgetStamp = () => { stampImgPromise = null; };

function loadStampImage() {
  if (!stampImgPromise) {
    stampImgPromise = (async () => {
      const res = await fetch('/api/stamp', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error;
        throw new Error(msg || 'Could not load your stamp');
      }
      const url = URL.createObjectURL(await res.blob());
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    })().catch((err) => { stampImgPromise = null; throw err; });
  }
  return stampImgPromise;
}

/** Certifier's stamp with the date written in. Returns { canvas, pngBytes, aspect }. */
export async function buildStamp(certifierId, dateText) {
  const certifier = certifierById(certifierId);
  if (!certifier) throw new Error('Unknown certifier');
  const img = await loadStampImage();
  const scale = Math.max(1, MIN_RENDER_W / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);

  if (dateText) {
    const d = certifier.date;
    let size = Math.round(c.width * d.font);
    const maxW = c.width * d.maxW;
    const font = (s) => `bold ${s}px "Times New Roman", Times, Georgia, serif`;
    ctx.font = font(size);
    while (ctx.measureText(dateText).width > maxW && size > 8) {
      size -= 1;
      ctx.font = font(size);
    }
    ctx.save();
    ctx.translate(c.width * d.x, c.height * d.baseline);
    ctx.rotate((d.angle * Math.PI) / 180);
    ctx.fillStyle = 'rgba(20,20,20,0.95)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateText, 0, 0);
    ctx.restore();
  }

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  return { canvas: c, pngBytes, aspect: c.height / c.width };
}

/** Bottom-left corner of the stamp in visual (upright) page coordinates, y up. */
function placeVisual(pageW, pageH, stampW, stampH, position) {
  const m = Math.min(pageW, pageH) * 0.03;
  const left = m;
  const right = pageW - stampW - m;
  const center = (pageW - stampW) / 2;
  const bottom = m;
  const top = pageH - stampH - m;
  switch (position) {
    case 'bottom-left': return { x: left, y: bottom };
    case 'bottom-center': return { x: center, y: bottom };
    case 'top-right': return { x: right, y: top };
    case 'top-left': return { x: left, y: top };
    case 'center': return { x: center, y: (pageH - stampH) / 2 };
    case 'bottom-right':
    default: return { x: right, y: bottom };
  }
}

async function stampPdf(bytes, stamp, opts) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const png = await doc.embedPng(stamp.pngBytes);
  const pages = doc.getPages();
  const targets = opts.pages === 'first' ? pages.slice(0, 1) : pages;

  for (const page of targets) {
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const W = box.width;
    const H = box.height;
    const visW = rot === 90 || rot === 270 ? H : W;
    const visH = rot === 90 || rot === 270 ? W : H;

    const sw = visW * (opts.sizePct / 100);
    const sh = sw * stamp.aspect;
    const { x: vx, y: vy } = placeVisual(visW, visH, sw, sh, opts.position);

    // Map the visual anchor back into the page's unrotated coordinate space.
    let x, y;
    if (rot === 90) { x = W - vy; y = vx; }
    else if (rot === 180) { x = W - vx; y = H - vy; }
    else if (rot === 270) { x = vy; y = H - vx; }
    else { x = vx; y = vy; }

    page.drawImage(png, {
      x: x + box.x,
      y: y + box.y,
      width: sw,
      height: sh,
      rotate: degrees(rot),
    });
  }
  return doc.save();
}

async function stampRaster(file, stamp, opts) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height); // flatten transparent PNGs
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();

  const sw = c.width * (opts.sizePct / 100);
  const sh = sw * stamp.aspect;
  const { x, y } = placeVisual(c.width, c.height, sw, sh, opts.position);
  // canvas y runs downward
  ctx.drawImage(stamp.canvas, x, c.height - y - sh, sw, sh);
  return c;
}

const baseName = (n) => n.replace(/\.[^.]+$/, '');

/** Returns { blob, name } for one input file. */
export async function certifyFile(file, stamp, opts) {
  const type = detectType(file);
  const base = baseName(file.name);

  if (type === 'pdf') {
    const out = await stampPdf(await file.arrayBuffer(), stamp, opts);
    return { blob: new Blob([out], { type: 'application/pdf' }), name: `${base}_certified.pdf` };
  }

  const canvas = await stampRaster(file, stamp, opts);
  const mime = type === 'png' ? 'image/png' : 'image/jpeg';

  if (opts.imageOutput === 'original') {
    const blob = await new Promise((r) => canvas.toBlob(r, mime, 0.92));
    return { blob, name: `${base}_certified.${type === 'png' ? 'png' : 'jpg'}` };
  }

  // Image -> single-page PDF, page sized to A4 width (595pt) at the image's aspect.
  const jpgBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(new Uint8Array(await jpgBlob.arrayBuffer()));
  const pw = 595.28;
  const ph = pw * (canvas.height / canvas.width);
  doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  const out = await doc.save();
  return { blob: new Blob([out], { type: 'application/pdf' }), name: `${base}_certified.pdf` };
}

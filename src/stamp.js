import { PDFDocument, degrees } from 'pdf-lib';

// One entry per person who can certify. Artwork lives in public/stamps/<id>.png
// (black ink on a transparent background).
// date.x / date.baseline / date.maxW: where the date goes, as fractions of the
// image width/height — just right of the "Date:" label, inside the box border.
// date.font: font size as a fraction of image width (shrinks to fit maxW).
// date.angle: degrees, negative = text rises to the right (for tilted scans).
const CLASSIC_DATE = { x: 0.676, baseline: 0.846, maxW: 0.18, font: 0.05, angle: 0 };

// enabled: false hides a certifier from the app. With only one enabled, the
// "Certified by" selector is hidden entirely.
const ALL_CERTIFIERS = [
  { id: 'jose', label: 'Jose', name: 'Jose Mari Palileo', date: CLASSIC_DATE, enabled: true },
  { id: 'gaselle', label: 'Gaselle', name: 'Gaselle Grace Luna', enabled: false,
    date: { x: 0.686, baseline: 0.313, maxW: 0.17, font: 0.045, angle: -4.7 } },
  { id: 'suzzy', label: 'Suzzy', name: 'Suzzy Angeli Dadole', date: CLASSIC_DATE, enabled: false },
];

export const CERTIFIERS = ALL_CERTIFIERS.filter((c) => c.enabled);

export const certifierById = (id) => CERTIFIERS.find((c) => c.id === id) || CERTIFIERS[0];

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

const stampImgs = new Map();
function loadStampImage(id) {
  if (!stampImgs.has(id)) {
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        stampImgs.delete(id);
        reject(new Error(`Could not load the stamp for ${certifierById(id).label}`));
      };
      img.src = `/stamps/${id}.png`;
    });
    stampImgs.set(id, p);
  }
  return stampImgs.get(id);
}

/** Certifier's stamp with the date written in. Returns { canvas, pngBytes, aspect }. */
export async function buildStamp(certifierId, dateText) {
  const certifier = certifierById(certifierId);
  const img = await loadStampImage(certifier.id);
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

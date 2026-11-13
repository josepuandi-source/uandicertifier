import { PDFDocument, degrees } from 'pdf-lib';

// Where the "Date:" value sits on public/stamp.png, as fractions of the stamp image.
// Measured from the source artwork: text starts just right of the "Date:" label
// and must stay inside the inner box border.
const DATE_X = 0.676;
const DATE_BASELINE = 0.846;
const DATE_MAX_W = 0.18;
const DATE_FONT = 0.05; // font size as a fraction of stamp width (shrinks to fit)

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

let stampImgPromise;
function loadStampImage() {
  if (!stampImgPromise) {
    stampImgPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load stamp.png'));
      img.src = '/stamp.png';
    });
  }
  return stampImgPromise;
}

/** Stamp artwork with the date written in. Returns { canvas, pngBytes, aspect }. */
export async function buildStamp(dateText) {
  const img = await loadStampImage();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (dateText) {
    let size = Math.round(c.width * DATE_FONT);
    const maxW = c.width * DATE_MAX_W;
    const font = (s) => `bold ${s}px "Times New Roman", Times, Georgia, serif`;
    ctx.font = font(size);
    while (ctx.measureText(dateText).width > maxW && size > 8) {
      size -= 1;
      ctx.font = font(size);
    }
    ctx.fillStyle = 'rgba(20,20,20,0.95)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateText, c.width * DATE_X, c.height * DATE_BASELINE);
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

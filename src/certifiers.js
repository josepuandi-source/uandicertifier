// Everyone who can sign in and certify. Shared by the app and the API.
//
// Stamp artwork: stamps/<id>.png (black ink, transparent background). That
// folder is NOT public — the API only hands a stamp to its signed-in owner.
// PIN: env var PIN_<ID> (e.g. PIN_JOSE), made with `npm run pin -- <id> <pin>`.
//
// date.x / date.baseline / date.maxW: where the date goes, as fractions of the
// image width/height — just right of the "Date:" label, inside the box border.
// date.font: font size as a fraction of image width (shrinks to fit maxW).
// date.angle: degrees, negative = text rises to the right (for tilted scans).
const CLASSIC_DATE = { x: 0.676, baseline: 0.846, maxW: 0.18, font: 0.05, angle: 0 };

export const CERTIFIERS = [
  { id: 'jose', label: 'Jose', name: 'Jose Mari Palileo', date: CLASSIC_DATE },
  { id: 'gaselle', label: 'Gaselle', name: 'Gaselle Grace Luna',
    date: { x: 0.686, baseline: 0.313, maxW: 0.17, font: 0.045, angle: -4.7 } },
  { id: 'suzzy', label: 'Suzzy', name: 'Suzzy Angeli Dadole', date: CLASSIC_DATE },
  { id: 'lillian', label: 'Lillian', name: 'Lillian Llamas-Juario',
    date: { x: 0.668, baseline: 0.842, maxW: 0.187, font: 0.05, angle: 0 } },
];

export const certifierById = (id) => CERTIFIERS.find((c) => c.id === id) || null;

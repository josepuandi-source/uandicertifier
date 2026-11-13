import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { buildStamp, certifyFile, detectType, formatDate } from './stamp.js';

const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const POSITIONS = [
  ['bottom-right', 'Bottom right'],
  ['bottom-left', 'Bottom left'],
  ['bottom-center', 'Bottom centre'],
  ['top-right', 'Top right'],
  ['top-left', 'Top left'],
  ['center', 'Centre'],
];

let nextId = 1;

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Pills({ value, onChange, options, label }) {
  return (
    <div className="tabs" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          className="tab"
          role="radio"
          aria-checked={value === v}
          aria-selected={value === v}
          onClick={() => onChange(v)}
        >{l}</button>
      ))}
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [position, setPosition] = useState('bottom-right');
  const [sizePct, setSizePct] = useState(32);
  const [pages, setPages] = useState('all');
  const [imageOutput, setImageOutput] = useState('pdf');
  const [busy, setBusy] = useState(false);
  const [stampUrl, setStampUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);
  const dragDepth = useRef(0);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(flash.t);
    flash.t = setTimeout(() => setToast(null), 2200);
  };

  // Stamp with the chosen date, shown when no output is selected.
  useEffect(() => {
    let alive = true;
    buildStamp(date ? formatDate(date) : '').then((s) => {
      if (alive) setStampUrl(s.canvas.toDataURL('image/png'));
    });
    return () => { alive = false; };
  }, [date]);

  // Settings changed -> earlier outputs are stale.
  useEffect(() => {
    setItems((list) => list.map((it) => (it.status === 'done' ? { ...it, status: 'queued', result: null } : it)));
  }, [date, position, sizePct, pages, imageOutput]);

  const selected = items.find((i) => i.id === selectedId && i.status === 'done') || null;

  useEffect(() => {
    if (!selected) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(selected.result.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected?.result]);

  const addFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList).map((file) => {
      const type = detectType(file);
      return {
        id: nextId++,
        file,
        type,
        status: type ? 'queued' : 'error',
        error: type ? null : 'Not a PDF, PNG or JPEG',
        result: null,
      };
    });
    setItems((list) => [...list, ...incoming]);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const certifyAll = async () => {
    setBusy(true);
    let ok = 0;
    let firstDone = null;
    try {
      const stamp = await buildStamp(formatDate(date));
      const opts = { position, sizePct, pages, imageOutput };
      for (const it of items) {
        if (it.status !== 'queued') continue;
        setItems((l) => l.map((x) => (x.id === it.id ? { ...x, status: 'working' } : x)));
        try {
          const result = await certifyFile(it.file, stamp, opts);
          setItems((l) => l.map((x) => (x.id === it.id ? { ...x, status: 'done', result } : x)));
          ok++;
          firstDone ??= it.id;
        } catch (err) {
          console.error(err);
          setItems((l) => l.map((x) => (x.id === it.id
            ? { ...x, status: 'error', error: err.message || 'Could not process this file' } : x)));
        }
      }
    } finally {
      setBusy(false);
    }
    if (firstDone && !items.some((i) => i.id === selectedId && i.status === 'done')) setSelectedId(firstDone);
    if (ok) flash(`${ok} file${ok === 1 ? '' : 's'} certified`);
  };

  const downloadAll = async () => {
    const done = items.filter((i) => i.status === 'done');
    if (done.length === 1) return download(done[0].result.blob, done[0].result.name);
    const zip = new JSZip();
    const used = new Set();
    for (const it of done) {
      let name = it.result.name;
      for (let n = 2; used.has(name); n++) name = it.result.name.replace(/(\.[^.]+)$/, ` (${n})$1`);
      used.add(name);
      zip.file(name, it.result.blob);
    }
    download(await zip.generateAsync({ type: 'blob' }), `certified_${date}.zip`);
    flash('Zip downloaded');
  };

  const clearAll = () => { setItems([]); setSelectedId(null); };

  const queued = items.filter((i) => i.status === 'queued').length;
  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="band"><div className="band-in">
        <header className="top">
          <div className="brand">
            <img className="logo" src="/logo.png" width="64" height="64" alt="U&I Global Australia" />
            <div>
              <h1>Certify</h1>
              <p className="sub">Drop documents in. They come back stamped as certified true copies with the date filled in.</p>
            </div>
          </div>
          <div className="actions">
            <button className="primary" type="button" disabled={busy || queued === 0 || !date} onClick={certifyAll}>
              {busy ? 'Stamping…' : queued ? `Certify ${queued} file${queued === 1 ? '' : 's'}` : 'Certify'}
            </button>
            <button type="button" disabled={busy || doneCount === 0} onClick={downloadAll}>
              {doneCount > 1 ? `Download all (${doneCount})` : 'Download'}
            </button>
            <button type="button" disabled={busy || items.length === 0} onClick={clearAll}>Clear</button>
          </div>
        </header>
      </div></div>

      <div className="wrap">
        <div className="grid">
          <div className="stack">
            <section className="panel stack" aria-label="Documents">
              <div
                className={`drop ${dragging ? 'over' : ''}`}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                  hidden
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                />
                <div className="drop-icon" aria-hidden="true">↓</div>
                <strong>Drop documents here</strong>
                <span>or click to browse · PDF, PNG, JPEG</span>
              </div>

              {items.length > 0 && (
                <>
                  <div className="filebar">
                    <p className="label">Documents · {items.length}</p>
                  </div>
                  <ul className="files">
                    {items.map((it) => (
                      <li
                        key={it.id}
                        className={`file ${it.status} ${selected?.id === it.id ? 'sel' : ''}`}
                        onClick={() => it.status === 'done' && setSelectedId(it.id)}
                      >
                        <span className="type">{it.type ? it.type.toUpperCase() : '—'}</span>
                        <span className="name" title={it.file.name}>{it.file.name}</span>
                        <span className="state">
                          {it.status === 'queued' && 'Ready'}
                          {it.status === 'working' && 'Stamping…'}
                          {it.status === 'error' && it.error}
                          {it.status === 'done' && (
                            <button
                              type="button"
                              className="small"
                              onClick={(e) => { e.stopPropagation(); download(it.result.blob, it.result.name); }}
                            >Download</button>
                          )}
                        </span>
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`Remove ${it.file.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setItems((l) => l.filter((x) => x.id !== it.id));
                            if (selectedId === it.id) setSelectedId(null);
                          }}
                        >✕</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="panel stack" aria-label="Stamp settings">
              <p className="label">Stamp settings</p>
              <div className="fields">
                <label className="f">Certification date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="f">Position
                  <select value={position} onChange={(e) => setPosition(e.target.value)}>
                    {POSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="f full">Stamp size (% of page width)
                  <span className="range">
                    <input type="range" min="15" max="60" value={sizePct} onChange={(e) => setSizePct(+e.target.value)} />
                    <output>{sizePct}%</output>
                  </span>
                </label>
                <div className="f">PDF pages
                  <Pills label="PDF pages" value={pages} onChange={setPages}
                    options={[['all', 'Every page'], ['first', 'First page']]} />
                </div>
                <div className="f">Images save as
                  <Pills label="Image output" value={imageOutput} onChange={setImageOutput}
                    options={[['pdf', 'PDF'], ['original', 'PNG / JPEG']]} />
                </div>
              </div>
              <p className="hint">Files are stamped in your browser and never uploaded anywhere.</p>
            </section>
          </div>

          <div className="preview-col">
            <section className="panel" aria-label="Preview">
              <div className="paperbar">
                <span className="title">{selected ? selected.result.name : 'Stamp preview'}</span>
                {selected && (
                  <button type="button" className="small primary"
                    onClick={() => download(selected.result.blob, selected.result.name)}>Download</button>
                )}
              </div>
              {selected && previewUrl ? (
                <div className="paper viewer">
                  {selected.result.blob.type === 'application/pdf'
                    ? <iframe src={previewUrl} title="Certified document preview" />
                    : <img src={previewUrl} alt="Certified document preview" />}
                </div>
              ) : (
                <div className="paper stamp">
                  {stampUrl && <img src={stampUrl} alt="Stamp with date" />}
                  <p>{doneCount ? 'Select a certified file on the left to preview it.' : 'Certified files will preview here.'}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {dragging && <div className="drag-veil">Drop to add</div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

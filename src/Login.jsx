import { useEffect, useRef, useState } from 'react';
import { CERTIFIERS } from './certifiers.js';

const LAST_USER_KEY = 'certify.lastUser';
const lastUser = () => {
  try { return localStorage.getItem(LAST_USER_KEY) || ''; } catch { return ''; }
};

export default function Login({ onSignedIn }) {
  const [user, setUser] = useState(() => (CERTIFIERS.some((c) => c.id === lastUser()) ? lastUser() : ''));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pinRef = useRef(null);

  useEffect(() => { if (user) pinRef.current?.focus(); }, [user]);

  const submit = async (code = pin) => {
    if (!user || code.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pin: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not sign in');
      try { localStorage.setItem(LAST_USER_KEY, user); } catch { /* storage unavailable */ }
      onSignedIn(data.user);
    } catch (err) {
      setError(err.message);
      setPin('');
      setBusy(false);
      setTimeout(() => pinRef.current?.focus(), 0);
    }
  };

  const onPin = (e) => {
    const code = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(code);
    setError(null);
    if (code.length === 4) submit(code);
  };

  return (
    <div className="login-page">
      <form className="login panel stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="brand">
          <img className="logo" src="/logo.png" width="56" height="56" alt="U&I Global Australia" />
          <div>
            <h1>Certify</h1>
            <p className="sub">Sign in to stamp documents with your certification.</p>
          </div>
        </div>

        <div className="f">Who's certifying?
          <div className="tabs who-pick" role="radiogroup" aria-label="Who's certifying">
            {CERTIFIERS.map((c) => (
              <button key={c.id} type="button" className="tab" role="radio"
                aria-checked={user === c.id} aria-selected={user === c.id}
                onClick={() => { setUser(c.id); setPin(''); setError(null); }}>{c.label}</button>
            ))}
          </div>
        </div>

        <label className="f">4-digit PIN
          <input
            ref={pinRef}
            className="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            autoComplete="off"
            placeholder="••••"
            value={pin}
            onChange={onPin}
            disabled={!user || busy}
            aria-invalid={!!error}
          />
        </label>

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="primary" type="submit" disabled={!user || pin.length !== 4 || busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="hint">Your stamp is only available to you after you sign in.</p>
      </form>
    </div>
  );
}

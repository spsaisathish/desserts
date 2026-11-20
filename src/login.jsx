import React, { useEffect, useState } from 'react';
import './login.css';

function LoginPage({ api, onSuccess }) {
  const [role, setRole] = useState('cashier');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event) {
    event.preventDefault();
    const { username, password } = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const session = await api('/api/session', { username, password, role });
      onSuccess(session.role);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-hero">
        <img className="login-logo" src="/logo.webp" alt="Dessert · Simply Sweet" />
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <span className="login-label">Point of sale</span>
          <h1 id="login-title">{role === 'owner' ? 'Owner sign-in' : 'Cashier sign-in'}</h1>
          <div className="methods" role="group" aria-label="Account type">
            {['cashier', 'owner'].map((account) => (
              <button
                className="method"
                type="button"
                key={account}
                disabled={busy}
                aria-pressed={role === account}
                onClick={() => {
                  setRole(account);
                  setError('');
                  setPasswordVisible(false);
                }}
              >
                {account === 'owner' ? 'Owner' : 'Cashier'}
              </button>
            ))}
          </div>
          <form key={role} onSubmit={signIn}>
            <label className="login-field" htmlFor="cashier-username">
              Username
            </label>
            <input
              id="cashier-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={busy}
            />
            <label className="login-field" htmlFor="cashier-password">
              Password
            </label>
            <div className="login-password">
              <input
                id="cashier-password"
                name="password"
                type={passwordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setPasswordVisible(!passwordVisible)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              >
                {passwordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            {error && (
              <p className="warning" role="alert">
                {error}
              </p>
            )}
            <button className="login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export function SessionGate({ api, children }) {
  const [role, setRole] = useState(undefined);

  useEffect(() => {
    let active = true;
    api('/api/session').then(
      (session) => {
        if (active) setRole(session.role);
      },
      () => {
        if (active) setRole(null);
      },
    );
    const expire = () => setRole(null);
    window.addEventListener('cashier-session-expired', expire);
    return () => {
      active = false;
      window.removeEventListener('cashier-session-expired', expire);
    };
  }, [api]);

  useEffect(() => {
    if (role === undefined) return;
    const path = role ? '/' : '/login';
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
  }, [role]);

  if (role === undefined)
    return (
      <p className="initial" role="status">
        Opening register…
      </p>
    );
  if (!role) return <LoginPage api={api} onSuccess={setRole} />;
  return children(role, async () => {
    await api('/api/session/logout', {});
    setRole(null);
  });
}

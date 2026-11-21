import { Notice } from './notice.jsx';
import React, { useEffect, useState } from 'react';
import './login.css';

function LoginPage({ api, onSuccess }) {
  const [role, setRole] = useState('cashier');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});

  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const { username, password } = Object.fromEntries(new FormData(form));
    setError('');
    const missing = {
      username: !username.trim() ? 'Enter your username.' : '',
      password: !password ? 'Enter your password.' : '',
    };
    setFields(missing);
    if (missing.username || missing.password) {
      form.elements.namedItem(missing.username ? 'username' : 'password').focus();
      return;
    }
    setBusy(true);
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
        <div className="login-brand">
          <img className="login-logo" src="/logo.webp" alt="Dessert · Simply Sweet" />
        </div>
        <div className="login-photo" aria-hidden="true" />
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <span className="login-label">Point of sale</span>
          <h1 id="login-title">{role === 'owner' ? 'Owner sign-in' : 'Cashier sign-in'}</h1>
          <div className="login-roles" role="group" aria-label="Account type">
            {['cashier', 'owner'].map((account) => (
              <button
                type="button"
                key={account}
                disabled={busy}
                aria-pressed={role === account}
                onClick={() => {
                  setRole(account);
                  setError('');
                  setFields({});
                  setPasswordVisible(false);
                }}
              >
                {account === 'owner' ? 'Owner' : 'Cashier'}
              </button>
            ))}
          </div>
          <form key={role} onSubmit={signIn} noValidate>
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
              aria-invalid={Boolean(fields.username)}
              aria-describedby={fields.username ? 'login-username-error' : undefined}
              onChange={() => {
                if (fields.username) setFields({ ...fields, username: '' });
              }}
            />
            {fields.username && (
              <p id="login-username-error" className="field-error" role="alert">
                {fields.username}
              </p>
            )}
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
                aria-invalid={Boolean(fields.password)}
                aria-describedby={fields.password ? 'login-password-error' : undefined}
                onChange={() => {
                  if (fields.password) setFields({ ...fields, password: '' });
                }}
              />
              <button
                type="button"
                onClick={() => setPasswordVisible(!passwordVisible)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              >
                {passwordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            {fields.password && (
              <p id="login-password-error" className="field-error" role="alert">
                {fields.password}
              </p>
            )}
            {error && <Notice>{error}</Notice>}
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

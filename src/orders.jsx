import { Notice } from './notice.jsx';
import React, { useEffect, useState } from 'react';

const billStatuses = {
  Cancelled: { label: 'Cancelled', style: 'cancelled' },
  'Partially cancelled': { label: 'Modified', style: 'modified' },
  Billed: { label: 'Paid', style: 'paid' },
};

export function OrderList({ api, money, openReceipt, busy }) {
  const [result, setResult] = useState(null);
  const [before, setBefore] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(cursor = '') {
    setLoading(true);
    setError('');
    try {
      setResult(
        await api(cursor ? `/api/sales?before=${encodeURIComponent(cursor)}` : '/api/sales'),
      );
      setBefore(cursor);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <form
        className="scan-form"
        onSubmit={(event) => {
          event.preventDefault();
          openReceipt(new FormData(event.currentTarget).get('bill'));
        }}
      >
        <input
          name="bill"
          aria-label="Bill number"
          placeholder="Find by bill number"
          inputMode="numeric"
          required
          pattern="[1-9][0-9]{0,19}"
        />
        <button className="scan" disabled={busy}>
          Find bill
        </button>
      </form>
      {loading && <p role="status">Loading orders…</p>}
      {error && <Notice>{error}</Notice>}
      {result?.orders.length === 0 && <p>No billed orders yet.</p>}
      <ul className="product-list">
        {result?.orders.map((order) => {
          const status = billStatuses[order.status];
          return (
            <li className="order-row" key={order.id}>
              <div>
                <strong>
                  Bill #{order.id} · {money(order.remainingTotal)}
                </strong>
                <br />
                <small>
                  {new Date(order.createdAt).toLocaleString('en-IN')} · {order.orderType} ·{' '}
                  {order.payment}
                </small>
              </div>
              <span className={`bill-status ${status.style}`}>{status.label}</span>
              <button
                className="method"
                disabled={busy}
                aria-label={`View bill ${order.id}`}
                onClick={() => openReceipt(order.id)}
              >
                View
              </button>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button className="method" disabled={loading} onClick={() => load()}>
          {before ? 'Latest orders' : 'Refresh'}
        </button>
        {result?.hasMore && (
          <button
            className="method"
            disabled={loading}
            onClick={() => load(result.orders.at(-1).id)}
          >
            Older orders
          </button>
        )}
      </div>
    </>
  );
}

import React, { useEffect, useState } from 'react';

export function FeedbackInbox({ api }) {
  const [inbox, setInbox] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function simulateReply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    setError('');
    try {
      await api('/api/feedback/demo', { message: new FormData(form).get('reply') });
      form.reset();
      await load(1);
    } catch (failure) {
      setError(failure.message);
      setLoading(false);
    }
  }

  async function load(nextPage) {
    setLoading(true);
    setError('');
    try {
      setInbox(await api(`/api/feedback?page=${nextPage}`));
      setPage(nextPage);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(1);
  }, []);

  return (
    <>
      <button className="scan" disabled={loading} onClick={() => load(1)}>
        Refresh inbox
      </button>
      {loading && <p role="status">Loading feedback…</p>}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {inbox && !inbox.enabled && !inbox.demo && <p>WhatsApp reply setup is pending.</p>}
      {inbox?.demo && (
        <form onSubmit={simulateReply}>
          <p>
            <strong>WhatsApp demo</strong> · No real messages are sent.
          </p>
          <p>
            Thanks for visiting Dessert · Simply Sweet. How was your order? Reply here with your
            feedback.
          </p>
          <label className="field">
            Customer reply
            <input name="reply" required maxLength={4096} disabled={loading} />
          </label>
          <button className="scan" disabled={loading}>
            Simulate reply
          </button>
        </form>
      )}
      {inbox?.messages.length === 0 && <p>No WhatsApp feedback yet.</p>}
      <ul className="product-list">
        {inbox?.messages.map((item) => (
          <li key={item.id}>
            <strong>+{item.sender}</strong>
            <p className="feedback-message">{item.message}</p>
            <small>
              {new Date(item.receivedAt).toLocaleString('en-IN')}
              {item.receiptId && ` · Receipt #${item.receiptId}`}
            </small>
          </li>
        ))}
      </ul>
      {(page > 1 || inbox?.hasMore) && (
        <div className="actions">
          <button
            className="method"
            disabled={loading || page === 1}
            onClick={() => load(page - 1)}
          >
            Previous
          </button>
          <button
            className="method"
            disabled={loading || !inbox?.hasMore}
            onClick={() => load(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

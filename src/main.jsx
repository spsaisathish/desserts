import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Scanner } from './scanner.jsx';
import { ProductManager, stockLabel } from './products.jsx';
import { FeedbackInbox } from './feedback.jsx';
import { OrderList } from './orders.jsx';
import { PaymentQr, paymentQr, Ticket } from './receipt.jsx';
import { SessionGate } from './login.jsx';
import { animateCartAdd, animateCartRemove, reduceMotion } from './cart-motion.js';
import './app.css';

const cash = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const money = (paise) => cash.format(paise / 100);
const pendingKey = 'desserts-pos-pending-sale';
const paymentMethods = ['Cash', 'UPI'];
const cancellationReasons = ['Order By Mistake', 'Miscommunication', 'Due to Delay'];
const reviewLabels = {
  off: 'No WhatsApp review requested',
  queued: 'WhatsApp review request queued',
  sending: 'Sending WhatsApp review request',
  accepted: 'WhatsApp accepted the review request',
  failed: 'WhatsApp rejected the review request',
  unknown: 'WhatsApp acceptance could not be confirmed',
};

async function api(path, payload) {
  const response = await fetch(path, {
    ...(payload
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/session')) {
    window.dispatchEvent(new Event('cashier-session-expired'));
  }
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'The register request failed.'), {
      status: response.status,
    });
  return data;
}

function readPending() {
  try {
    return JSON.parse(sessionStorage.getItem(pendingKey));
  } catch {
    return null;
  }
}
function savePending(payload) {
  if (payload) sessionStorage.setItem(pendingKey, JSON.stringify(payload));
  else sessionStorage.removeItem(pendingKey);
}

function Modal({ title, close, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="split">
        <h2 id="modal-title">{title}</h2>
        <button className="close" aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

function App({ role, onSignOut }) {
  const cartShortcut = useRef(null);
  const cartHeading = useRef(null);
  const [register, setRegister] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState({});
  const [type, setType] = useState('Dine-in');
  const [category, setCategory] = useState('All items');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(readPending);
  const [modal, setModal] = useState(() => (readPending() ? 'payment' : null));
  const [payment, setPayment] = useState('Cash');
  const [paymentDraft, setPaymentDraft] = useState(null);
  const [review, setReview] = useState(false);
  const [phone, setPhone] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [autoPrint, setAutoPrint] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const [saleError, setSaleError] = useState('');
  const [cancelReason, setCancelReason] = useState(null);
  const [cancelItem, setCancelItem] = useState(null);
  const [cancelQty, setCancelQty] = useState(1);
  const products = register?.products ?? [];
  const items = products
    .filter((product) => cart[product.id])
    .map((product) => ({ ...product, qty: cart[product.id] }));
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const cartQuantity = items.reduce((sum, item) => sum + item.qty, 0);
  const upiMerchant = register?.upiMerchant;
  const paymentReference =
    modal === 'payment' && payment === 'UPI' && !pending ? paymentDraft?.id : null;
  const qr = useMemo(
    () => paymentQr(upiMerchant, total, paymentReference),
    [upiMerchant, total, paymentReference],
  );
  const categories = ['All items', ...new Set(products.map((product) => product.category))];

  function loadRegister() {
    setLoadError('');
    return api('/api/register')
      .then(setRegister)
      .catch((error) => setLoadError(error.message));
  }
  useEffect(() => {
    loadRegister();
  }, []);
  useEffect(() => {
    if (!autoPrint || autoPrint !== receipt?.id) return;
    const frame = requestAnimationFrame(() => {
      setAutoPrint(null);
      window.print();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoPrint, receipt?.id]);
  const receiptId = receipt?.id;
  const reviewStatus = receipt?.review;
  useEffect(() => {
    if (!receiptId || !['queued', 'sending'].includes(reviewStatus)) return;
    let active = true;
    const timer = setInterval(() => {
      api(`/api/sales/${receiptId}`)
        .then((next) => {
          if (active)
            setReceipt((previous) =>
              previous?.id === next.id &&
              (previous.cancellations?.length ?? 0) <= (next.cancellations?.length ?? 0)
                ? next
                : previous,
            );
        })
        .catch(() => {});
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [receiptId, reviewStatus]);

  function change(id, delta) {
    const limit = Math.min(99, products.find((product) => product.id === id)?.stock ?? 99);
    setCart((previous) => {
      const next = { ...previous };
      const current = next[id] || 0;
      const qty = delta > 0 ? Math.max(current, Math.min(limit, current + delta)) : current + delta;
      if (qty > 0) next[id] = qty;
      else delete next[id];
      return next;
    });
  }
  function atLimit(item) {
    return (cart[item.id] ?? 0) >= Math.min(99, item.stock ?? 99);
  }
  function addFromCard(item, photo) {
    if (pending || atLimit(item)) return;
    change(item.id, 1);
    setMessage(`${item.name} added`);
    const shortcut = cartShortcut.current;
    animateCartAdd(photo, shortcut?.offsetWidth ? shortcut : cartHeading.current);
  }

  function viewCart() {
    cartHeading.current?.focus({ preventScroll: true });
    cartHeading.current?.scrollIntoView({
      behavior: reduceMotion() ? 'instant' : 'smooth',
      block: 'start',
    });
  }
  function scan(value) {
    const code = value.trim().toUpperCase();
    const item =
      products.find((product) => product.id === register.barcodes?.[code]) ??
      products.find((product) => product.code.toUpperCase() === code);
    if (!item || atLimit(item)) return null;
    change(item.id, 1);
    setMessage(`${item.name} added`);
    return item;
  }
  async function linkBarcode(barcode, productId) {
    const linked = await api('/api/product-barcodes', { barcode, productId });
    setRegister((previous) => ({
      ...previous,
      barcodes: { ...previous.barcodes, [linked.barcode]: linked.productId },
    }));
  }
  function close() {
    if (!busy && !(pending && modal === 'payment')) setModal(null);
  }
  async function complete(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setSaleError('');
    try {
      const payload = pending || {
        requestId: paymentDraft?.id ?? crypto.randomUUID(),
        items: items.map(({ id, qty, price }) => ({ id, qty, price })),
        orderType: type,
        payment,
        review,
        phone: review ? phone : '',
      };
      savePending(payload);
      setPending(payload);
      const result = await api('/api/sales', payload);
      savePending(null);
      setPending(null);
      setCart({});
      void loadRegister();
      setReview(false);
      setPhone('');
      setReceipt(result);
      setCancelReason(null);
      setModal('receipt');
      if (!result.fullyCanceled) setAutoPrint(result.id);
    } catch (error) {
      if ([400, 422].includes(error.status)) {
        savePending(null);
        setPending(null);
        void loadRegister();
        if (!items.length) setModal(null);
      }
      setSaleError(error.message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function findReceipt(id) {
    setSaleError('');
    if (!/^[1-9]\d{0,19}$/.test(id)) {
      setSaleError('Enter a valid bill number.');
      return;
    }
    setBusy(true);
    try {
      setReceipt(await api(`/api/sales/${id}`));
      setCancelReason(null);
      setModal('receipt');
    } catch (error) {
      setSaleError(error.message);
    } finally {
      setBusy(false);
    }
  }
  function chooseCancellation(item) {
    setSaleError('');
    setCancelItem({ ...item, requestId: crypto.randomUUID() });
    setCancelQty(1);
    setCancelReason('');
  }
  async function cancelSelectedItem(event) {
    event.preventDefault();
    setBusy(true);
    setSaleError('');
    try {
      setReceipt(
        await api(`/api/sales/${receipt.id}/items/${cancelItem.id}/cancel`, {
          requestId: cancelItem.requestId,
          qty: cancelQty,
          reason: cancelReason,
        }),
      );
      setCancelReason(null);
      void loadRegister();
    } catch (error) {
      setSaleError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await onSignOut();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <div className="header-group">
          <img className="brand" src="/logo.webp" alt="Dessert · Simply Sweet" />
          <span className="header-label">{role === 'owner' ? 'Owner' : 'Point of sale'}</span>
        </div>
        <div className="header-right">
          <button
            className="history"
            disabled={Boolean(pending)}
            onClick={() => setModal('products')}
          >
            Products
          </button>
          <button
            className="history"
            disabled={Boolean(pending)}
            onClick={() => setModal('feedback')}
          >
            Feedback
          </button>
          <button
            className="history"
            disabled={Boolean(pending)}
            onClick={() => {
              setSaleError('');
              setModal('orders');
            }}
          >
            Orders
          </button>
          <button className="history" disabled={busy || Boolean(pending)} onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {!register ? (
        <section className="initial">
          <h2>Register</h2>
          <p role="status">{loadError || 'Loading menu…'}</p>
          {loadError && (
            <button className="scan" onClick={loadRegister}>
              Retry
            </button>
          )}
        </section>
      ) : (
        <main className="layout">
          <section aria-labelledby="menu-title">
            <div className="hero">
              <div>
                <div className="eyebrow">◆ &nbsp; Simply Sweet</div>
                <h1>Dessert Counter</h1>
                <p>Kunafa, pistachio sweets &amp; more</p>
              </div>
            </div>
            <div className="toolbar">
              <h2 id="menu-title">Menu</h2>
              <div className="tools">
                <label className="search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    aria-label="Search menu"
                    placeholder="Search menu"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button
                  className="scan"
                  disabled={Boolean(pending)}
                  onClick={() => setModal('scanner')}
                >
                  Scan QR / barcode
                </button>
              </div>
            </div>
            <div className="filters">
              {categories.map((label) => (
                <button
                  key={label}
                  aria-pressed={category === label}
                  onClick={() => setCategory(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid">
              {products
                .filter(
                  (item) =>
                    (category === 'All items' || category === item.category) &&
                    `${item.name} ${item.code}`.toLowerCase().includes(query.trim().toLowerCase()),
                )
                .map((item) => (
                  <button
                    type="button"
                    className="item"
                    key={item.id}
                    disabled={Boolean(pending) || atLimit(item)}
                    aria-label={`Add ${item.name}, ${money(item.price)}, ${stockLabel(item.stock)}`}
                    onClick={(event) => addFromCard(item, event.currentTarget.querySelector('img'))}
                  >
                    <img src={item.image} alt="" />
                    <span className="item-body">
                      <span className="item-name">{item.name}</span>
                      <span className="item-description">{item.description}</span>
                      <small className="stock-label">{stockLabel(item.stock)}</small>
                      <span className="price">{money(item.price)}</span>
                    </span>
                  </button>
                ))}
            </div>
          </section>
          <aside className="order" aria-labelledby="order-title">
            <div className="order-top">
              <h2 id="order-title" ref={cartHeading} tabIndex={-1}>
                Current order
              </h2>
              <div className="modes">
                {['Dine-in', 'Takeaway'].map((label) => (
                  <button
                    key={label}
                    aria-pressed={type === label}
                    disabled={Boolean(pending)}
                    onClick={() => setType(label)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lines">
              {items.length ? (
                items.map((item) => (
                  <div className="line" key={item.id}>
                    <img src={item.image} alt="" />
                    <div>
                      <strong>{item.name}</strong>
                      <small>{money(item.price * item.qty)}</small>
                    </div>
                    <div className="qty">
                      <button
                        disabled={Boolean(pending)}
                        aria-label={`Remove one ${item.name}`}
                        onClick={(event) => {
                          animateCartRemove(event.currentTarget.closest('.line'), item.qty === 1);
                          change(item.id, -1);
                          setMessage(`Removed one ${item.name}`);
                        }}
                      >
                        −
                      </button>
                      <span>{item.qty}</span>
                      <button
                        disabled={Boolean(pending) || atLimit(item)}
                        aria-label={`Add one ${item.name}`}
                        onClick={() => change(item.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty">Tap a product or scan its code to start.</p>
              )}
            </div>
            <div className="order-bottom">
              <div className="split total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>
              <button
                className="checkout"
                disabled={!items.length && !pending}
                onClick={() => {
                  setSaleError('');
                  setPaymentDraft({ id: crypto.randomUUID(), createdAt: new Date() });
                  setModal('payment');
                }}
              >
                {pending ? 'Resume billing' : 'Review payment →'}
              </button>
              {saleError && !modal && (
                <p className="warning" role="alert">
                  {saleError}
                </p>
              )}
              {items.length > 0 && !pending && (
                <button className="text-button" onClick={() => setModal('clear')}>
                  Clear order
                </button>
              )}
            </div>
          </aside>
        </main>
      )}
      {modal === 'products' && (
        <Modal title="Products" close={close}>
          <ProductManager api={api} refreshRegister={loadRegister} money={money} />
        </Modal>
      )}
      {modal === 'feedback' && (
        <Modal title="WhatsApp feedback" close={close}>
          <FeedbackInbox api={api} />
        </Modal>
      )}
      {modal === 'scanner' && (
        <Modal title="Scan product" close={close}>
          <Scanner scan={scan} products={products} linkBarcode={linkBarcode} />
        </Modal>
      )}
      {modal === 'clear' && (
        <Modal title="Clear order?" close={close}>
          <p>Remove all items from this order.</p>
          <button
            className="checkout"
            onClick={() => {
              setCart({});
              close();
            }}
          >
            Clear order
          </button>
        </Modal>
      )}
      {modal === 'payment' && (
        <Modal title={pending ? 'Resume billing' : 'Review payment'} close={close}>
          <form onSubmit={complete}>
            {pending ? (
              <p>
                The last billing request is pending. Retrying uses the same reference so the sale is
                recorded only once.
              </p>
            ) : (
              <>
                <p className="split">
                  <span>{type}</span>
                  <strong>{money(total)}</strong>
                </p>
                <div className="methods" aria-label="Payment method">
                  {paymentMethods.map((method) => (
                    <button
                      type="button"
                      className="method"
                      key={method}
                      aria-pressed={payment === method}
                      onClick={() => setPayment(method)}
                    >
                      {method}
                    </button>
                  ))}
                </div>
                {payment === 'UPI' && !upiMerchant && (
                  <p className="help">Set up a merchant UPI ID to show a payment QR.</p>
                )}
                {qr && (
                  <>
                    <PaymentQr qr={qr} />
                    <button type="button" className="method" onClick={() => window.print()}>
                      Print payment bill
                    </button>
                  </>
                )}
                <p className="help">Confirm payment at the counter before recording the sale.</p>
                {register?.whatsappEnabled ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={review}
                      onChange={(event) => setReview(event.target.checked)}
                    />{' '}
                    Customer agreed to a WhatsApp review request
                  </label>
                ) : (
                  <p className="help">WhatsApp sender setup is pending.</p>
                )}
                {review && (
                  <label className="field">
                    Customer WhatsApp number
                    <input
                      type="tel"
                      autoComplete="off"
                      placeholder="+91 …"
                      required
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={narrow}
                    onChange={(event) => setNarrow(event.target.checked)}
                  />{' '}
                  Use 58 mm receipt layout
                </label>
              </>
            )}
            {saleError && (
              <p className="warning" role="alert">
                {saleError}
              </p>
            )}
            <button className="checkout" disabled={busy}>
              {busy ? 'Recording sale…' : pending ? 'Retry billing' : 'Record payment & print'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'orders' && (
        <Modal title="Orders" close={close}>
          {saleError && (
            <p className="warning" role="alert">
              {saleError}
            </p>
          )}
          <OrderList api={api} money={money} openReceipt={findReceipt} busy={busy} />
        </Modal>
      )}
      {modal === 'receipt' && receipt && (
        <Modal title={`Receipt #${receipt.id}`} close={close}>
          <p className="receipt-summary">
            {receipt.orderType} · {receipt.payment} ·{' '}
            {new Date(receipt.createdAt).toLocaleString('en-IN')}
          </p>
          <ul className="product-list">
            {receipt.items.map((item) => (
              <li key={item.id}>
                <div className="split">
                  <strong>
                    {item.qty} × {item.name}
                  </strong>
                  <span>{money(item.qty * item.price)}</span>
                </div>
                {item.canceledQty > 0 && (
                  <p>
                    {item.canceledQty} cancelled · {item.qty - item.canceledQty} remaining
                  </p>
                )}
                {role === 'owner' && cancelReason === null && item.canceledQty < item.qty && (
                  <button
                    className="method"
                    aria-label={`Cancel item ${item.name}`}
                    onClick={() => chooseCancellation(item)}
                  >
                    Cancel item
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="split total">
            <span>Original total</span>
            <strong>{money(receipt.total)}</strong>
          </p>
          {(receipt.fullyCanceled || receipt.cancellations.length > 0) && (
            <p className="split total">
              <span>Remaining total</span>
              <strong>{money(receipt.remainingTotal)}</strong>
            </p>
          )}
          {receipt.fullyCanceled && (
            <p className="warning" role="status">
              <strong>Cancelled</strong>
              {receipt.cancelReason && ` · ${receipt.cancelReason}`}
            </p>
          )}
          {!receipt.fullyCanceled && receipt.cancellations.length > 0 && (
            <p className="warning" role="status">
              Partially cancelled
            </p>
          )}
          {receipt.cancellations.length > 0 && (
            <ul className="product-list" aria-label="Item cancellations">
              {receipt.cancellations.map((entry) => (
                <li key={entry.id}>
                  {entry.qty} × {receipt.items.find((item) => item.id === entry.productId)?.name}{' '}
                  cancelled · {entry.reason}
                </li>
              ))}
            </ul>
          )}
          {!receipt.fullyCanceled && <p role="status">{reviewLabels[receipt.review]}</p>}
          {saleError && (
            <p className="warning" role="alert">
              {saleError}
            </p>
          )}
          {cancelReason !== null && (
            <form onSubmit={cancelSelectedItem}>
              <p>
                <strong>Cancel {cancelItem.name}</strong>. Handle any customer refund separately.
              </p>
              <label className="field">
                Quantity to cancel
                <select
                  value={cancelQty}
                  disabled={busy}
                  onChange={(event) => setCancelQty(Number(event.target.value))}
                >
                  {Array.from({ length: cancelItem.qty - cancelItem.canceledQty }, (_, index) => (
                    <option key={index + 1}>{index + 1}</option>
                  ))}
                </select>
              </label>
              <fieldset className="cancel-reasons" disabled={busy}>
                <legend>Cancellation reason</legend>
                {cancellationReasons.map((reason) => (
                  <label className="cancel-reason" key={reason}>
                    <input
                      type="radio"
                      name="cancellation-reason"
                      value={reason}
                      required
                      checked={cancelReason === reason}
                      onChange={() => setCancelReason(reason)}
                    />
                    {reason}
                  </label>
                ))}
              </fieldset>
              <div className="actions">
                <button
                  type="button"
                  className="method"
                  disabled={busy}
                  onClick={() => {
                    setSaleError('');
                    setCancelReason(null);
                  }}
                >
                  Keep item
                </button>
                <button className="checkout" disabled={busy || !cancelReason.trim()}>
                  {busy ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
              </div>
            </form>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={narrow}
              onChange={(event) => setNarrow(event.target.checked)}
            />{' '}
            Use 58 mm receipt layout
          </label>
          {cancelReason === null && (
            <div className="actions">
              <button className="method" onClick={() => window.print()}>
                Print again
              </button>
              <button className="checkout" onClick={close}>
                Done
              </button>
            </div>
          )}
        </Modal>
      )}
      {register && (
        <button
          type="button"
          className="mobile-cart"
          ref={cartShortcut}
          onClick={viewCart}
          aria-label={`View cart, ${cartQuantity} ${cartQuantity === 1 ? 'item' : 'items'}`}
          aria-controls="order-title"
        >
          View cart <span aria-hidden="true">{cartQuantity}</span>
        </button>
      )}
      <div className="status" role="status" onAnimationEnd={() => setMessage('')} key={message}>
        {message}
      </div>
      {qr ? (
        <Ticket
          receipt={{ items, total, orderType: type, payment, createdAt: paymentDraft.createdAt }}
          narrow={narrow}
          qr={qr}
          cashier={register?.cashier}
        />
      ) : (
        receipt &&
        modal === 'receipt' && (
          <Ticket receipt={receipt} narrow={narrow} cashier={register?.cashier ?? 'Cashier'} />
        )
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <SessionGate api={api}>{(role, signOut) => <App role={role} onSignOut={signOut} />}</SessionGate>,
);

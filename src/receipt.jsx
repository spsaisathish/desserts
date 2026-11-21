import React, { useLayoutEffect, useRef } from 'react';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat.js';
import EncodeHintType from '@zxing/library/esm/core/EncodeHintType.js';
import QRCodeWriter from '@zxing/library/esm/core/qrcode/QRCodeWriter.js';

const rupees = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const amount = (paise) => rupees.format(paise / 100);
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export function paymentQr(merchant, total, reference) {
  if (!merchant || total <= 0 || !reference) return null;
  const fields = {
    pa: merchant.id,
    pn: merchant.name,
    tr: reference.replaceAll('-', ''),
    tn: 'Dessert Simply Sweet order',
    am: (total / 100).toFixed(2),
    cu: 'INR',
  };
  const query = Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const matrix = new QRCodeWriter().encode(
    `upi://pay?${query}`,
    BarcodeFormat.QR_CODE,
    0,
    0,
    new Map([[EncodeHintType.MARGIN, 4]]),
  );
  const size = matrix.getWidth();
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

export function PaymentQr({ qr }) {
  if (!qr) return null;
  return (
    <div className="payment-qr">
      <svg
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        role="img"
        aria-label="Scan with Google Pay or another UPI app"
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="white" />
        <path d={qr.path} fill="black" />
      </svg>
      <p>Scan with Google Pay or any UPI app</p>
    </div>
  );
}

export function Ticket({ receipt, narrow, qr, cashier }) {
  const ticket = useRef(null);
  const pageStyle = useRef(null);
  useLayoutEffect(() => {
    const paperWidth = narrow ? 58 : 80;
    const heightMm = ticket.current.getBoundingClientRect().height * (25.4 / 96);
    // Allow room for the page margins and let longer bills paginate.
    const paperHeight = Math.min(300, Math.max(55, Math.ceil(heightMm + 8)));
    pageStyle.current.textContent = `@page { size: ${paperWidth}mm ${paperHeight}mm; margin: 3mm; }`;
  }, [receipt, narrow, qr, cashier]);

  const unpaid = Boolean(qr);
  const quantity = receipt.items.reduce((sum, item) => sum + item.qty, 0);
  return (
    <>
      <article ref={ticket} className={narrow ? 'ticket ticket-narrow' : 'ticket'}>
        <div className="ticket-heading">
          <h1>Dessert · Simply Sweet</h1>
          <div>Alagappa University College Road,</div>
          <div>Karaikudi</div>
          <div>GST : 02882838383</div>
        </div>
        <hr />
        <div className="split">
          <span>{dateTime.format(new Date(receipt.createdAt))}</span>
          <strong>{receipt.orderType}</strong>
        </div>
        <div className="split">
          <span>Cashier: {cashier}</span>
          <strong>{unpaid ? 'Payment bill' : `Bill No. ${receipt.id}`}</strong>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty.</th>
              <th>Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.name}
                  {item.canceledQty > 0 && (
                    <>
                      <br />
                      {item.canceledQty} cancelled
                    </>
                  )}
                </td>
                <td>{item.qty}</td>
                <td>{amount(item.price)}</td>
                <td>{amount(item.qty * item.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="split">
          <span>Total Qty: {quantity}</span>
          <span>Subtotal {amount(receipt.total)}</span>
        </p>
        <hr />
        <p className="split ticket-total">
          <strong>{unpaid ? 'Amount Due' : 'Grand Total'}</strong>
          <strong>₹{amount(receipt.total)}</strong>
        </p>
        {(receipt.fullyCanceled || receipt.cancellations?.length > 0) && (
          <p className="split ticket-total">
            <strong>Remaining Total</strong>
            <strong>₹{amount(receipt.remainingTotal)}</strong>
          </p>
        )}
        <p className="split">
          <strong>
            {receipt.fullyCanceled
              ? 'CANCELLED'
              : receipt.cancellations?.length > 0
                ? 'PARTIALLY CANCELLED'
                : unpaid
                  ? 'Awaiting payment'
                  : 'Payment recorded'}
          </strong>
          <span>{receipt.payment}</span>
        </p>
        {receipt.canceledAt && <p>Reason: {receipt.cancelReason}</p>}
        <hr />
        <PaymentQr qr={qr} />
        <p className="thanks">Thank you! Visit again.</p>
      </article>
      <style ref={pageStyle} media="print" />
    </>
  );
}

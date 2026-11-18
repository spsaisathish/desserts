import { createHash } from 'node:crypto';

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseSale(body, whatsappEnabled) {
  const { requestId, items, orderType, payment, review, phone } = body ?? {};
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    throw new InputError('Invalid checkout reference.');
  }
  if (!['Dine-in', 'Takeaway'].includes(orderType) || !['Cash', 'Card', 'UPI'].includes(payment)) {
    throw new InputError('Choose an order type and payment method.');
  }
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new InputError('Add between 1 and 100 different products.');
  }
  const lines = items
    .map((item) => {
      const { id, qty, price } = item ?? {};
      if (
        !Number.isInteger(id) ||
        id < 1 ||
        id > 4294967295 ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 99 ||
        !Number.isInteger(price) ||
        price < 0 ||
        price > 4294967295
      ) {
        throw new InputError('Invalid product, quantity or price.');
      }
      return { id, qty, price };
    })
    .sort((a, b) => a.id - b.id);
  if (new Set(lines.map((line) => line.id)).size !== lines.length) {
    throw new InputError('Combine duplicate products into one line.');
  }
  const recipient =
    review === true && typeof phone === 'string' ? phone.trim().replace(/[ ()-]/g, '') : '';
  if (review === true && (!whatsappEnabled || !/^\+[1-9][0-9]{7,14}$/.test(recipient))) {
    throw new InputError('WhatsApp requires an enabled sender and a number with its country code.');
  }
  const details = { lines, orderType, payment, recipient };
  const hash = createHash('sha256').update(JSON.stringify(details)).digest('hex');
  return { requestId: requestId.toLowerCase(), hash, ...details };
}

export async function getReceipt(db, id) {
  const [[sale]] = await db.query(
    `SELECT s.id,s.order_type AS orderType,s.payment,s.total_paise AS total,s.created_at AS createdAt,
      s.canceled_at AS canceledAt,s.cancel_reason AS cancelReason,
      COALESCE(j.status,'off') AS review FROM sales s LEFT JOIN review_jobs j ON s.id=j.sale_id WHERE s.id=?`,
    [id],
  );
  if (!sale) return null;
  const [items] = await db.query(
    'SELECT product_id AS id,product_name AS name,quantity AS qty,price_paise AS price FROM sale_items WHERE sale_id=? ORDER BY product_id',
    [id],
  );
  const [cancellations] = await db.query(
    `SELECT request_id AS id,product_id AS productId,quantity AS qty,reason,created_at AS createdAt
      FROM sale_item_cancellations WHERE sale_id=? ORDER BY created_at,request_id`,
    [id],
  );
  const canceledQuantities = new Map();
  for (const { productId, qty } of cancellations) {
    canceledQuantities.set(productId, (canceledQuantities.get(productId) || 0) + qty);
  }
  const lines = items.map((item) => ({
    ...item,
    canceledQty: sale.canceledAt ? item.qty : (canceledQuantities.get(item.id) ?? 0),
  }));
  const remainingTotal = lines.reduce(
    (total, item) => total + (item.qty - item.canceledQty) * item.price,
    0,
  );
  const fullyCanceled =
    Boolean(sale.canceledAt) || lines.every((item) => item.canceledQty === item.qty);
  return { ...sale, items: lines, cancellations, remainingTotal, fullyCanceled };
}

export async function cancelSaleItem(pool, id, productId, { requestId, qty, reason }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sale]] = await connection.execute(
      'SELECT canceled_at FROM sales WHERE id=? FOR UPDATE',
      [id],
    );
    if (!sale) throw new InputError('Order not found.', 404);
    const [[previous]] = await connection.execute(
      'SELECT product_id,quantity,reason FROM sale_item_cancellations WHERE sale_id=? AND request_id=?',
      [id, requestId],
    );
    if (previous) {
      if (
        previous.product_id !== productId ||
        previous.quantity !== qty ||
        previous.reason !== reason
      ) {
        throw new InputError(
          'This cancellation was already recorded with different details. Reopen the bill to check it.',
          409,
        );
      }
    } else {
      if (sale.canceled_at) throw new InputError('This bill was already cancelled.', 409);
      const [[item]] = await connection.execute(
        `SELECT i.quantity,i.stock_deducted,
          (SELECT COALESCE(SUM(c.quantity),0) FROM sale_item_cancellations c
           WHERE c.sale_id=i.sale_id AND c.product_id=i.product_id) AS canceled
          FROM sale_items i WHERE i.sale_id=? AND i.product_id=?`,
        [id, productId],
      );
      if (!item) throw new InputError('Item not found on this bill.', 404);
      if (qty > item.quantity - Number(item.canceled)) {
        throw new InputError(
          'This item has fewer units left to cancel. Reopen the bill to see the updated quantity.',
          409,
        );
      }
      await connection.execute(
        'INSERT INTO sale_item_cancellations (sale_id,product_id,request_id,quantity,reason) VALUES (?,?,?,?,?)',
        [id, productId, requestId, qty, reason],
      );
      if (item.stock_deducted) {
        await connection.execute(
          'UPDATE products SET stock=stock+? WHERE id=? AND stock IS NOT NULL',
          [qty, productId],
        );
      }
      await connection.execute(
        `DELETE FROM review_jobs WHERE sale_id=? AND status='queued'
          AND (SELECT SUM(quantity) FROM sale_items WHERE sale_id=?) =
              (SELECT SUM(quantity) FROM sale_item_cancellations WHERE sale_id=?)`,
        [id, id, id],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getReceipt(pool, id);
}

export async function recordSale(pool, sale) {
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    const [inserted] = await connection.query(
      'INSERT INTO sales (request_id,request_hash,order_type,payment,total_paise) VALUES (?,?,?,?,0)',
      [sale.requestId, sale.hash, sale.orderType, sale.payment],
    );
    id = inserted.insertId;
    const [products] = await connection.query(
      'SELECT id,name,price_paise,stock FROM products WHERE active=TRUE AND id IN (?) ORDER BY id FOR UPDATE',
      [sale.lines.map((line) => line.id)],
    );
    const catalog = new Map(products.map((product) => [product.id, product]));
    let total = 0;
    const items = sale.lines.map((line) => {
      const product = catalog.get(line.id);
      if (!product || product.price_paise !== line.price) {
        throw new InputError('The menu changed. Refresh prices and review the order again.');
      }
      if (product.stock !== null && product.stock < line.qty) {
        throw new InputError(
          `Only ${product.stock} available for ${product.name}. Update the order and try again.`,
          422,
        );
      }
      total += product.price_paise * line.qty;
      return [
        id,
        product.id,
        product.name,
        line.qty,
        product.price_paise,
        Number(product.stock !== null),
      ];
    });
    if (total > 4294967295) throw new InputError('Order total is too large.');
    for (const { id: productId, qty } of sale.lines) {
      if (catalog.get(productId).stock !== null) {
        await connection.query('UPDATE products SET stock=stock-? WHERE id=?', [qty, productId]);
      }
    }
    await connection.query(
      'INSERT INTO sale_items (sale_id,product_id,product_name,quantity,price_paise,stock_deducted) VALUES ?',
      [items],
    );
    await connection.query('UPDATE sales SET total_paise=? WHERE id=?', [total, id]);
    if (sale.recipient) {
      await connection.query('INSERT INTO review_jobs (sale_id,phone) VALUES (?,?)', [
        id,
        sale.recipient,
      ]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [[existing]] = await connection.query(
      'SELECT id,request_hash AS hash FROM sales WHERE request_id=?',
      [sale.requestId],
    );
    if (!existing || existing.hash !== sale.hash)
      throw new InputError('Checkout reference already used for a different order.', 409);
    id = existing.id;
  } finally {
    connection.release();
  }
  return getReceipt(pool, id);
}

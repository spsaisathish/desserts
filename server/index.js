import express from 'express';
import mysql from 'mysql2/promise';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cancelSaleItem, getReceipt, InputError, parseSale, recordSale } from './sales.js';
import { runReviewWorker, whatsappConfig } from './reviews.js';
import { productColumns, saveProduct } from './products.js';
import { imageDirectory, storeProductImage } from './product-images.js';
import {
  feedbackConfig,
  feedbackMessages,
  installFeedbackWebhook,
  storeFeedback,
} from './feedback.js';

const env = process.env;
if (
  !env.POS_USER ||
  !env.POS_PASSWORD ||
  env.POS_PASSWORD.length < 12 ||
  env.POS_PASSWORD.startsWith('replace-')
) {
  throw new Error('Set POS_USER and a unique POS_PASSWORD of at least 12 characters in .env.');
}
if (!env.DB_PASSWORD || env.DB_PASSWORD.startsWith('replace-'))
  throw new Error('Set DB_PASSWORD in .env.');
const feedbackDemo = env.WA_FEEDBACK_DEMO === 'true';
const whatsapp = feedbackDemo ? null : whatsappConfig(env);
const feedback = feedbackDemo ? null : feedbackConfig(env);
const upiId = env.UPI_MERCHANT_ID?.trim();
const upiMerchant =
  /^[a-z0-9._+-]+@[a-z0-9.-]+$/i.test(upiId ?? '') && upiId.length <= 254
    ? { id: upiId, name: env.UPI_MERCHANT_NAME?.trim().slice(0, 100) || 'Dessert Simply Sweet' }
    : null;
const pool = mysql.createPool({
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  database: env.DB_NAME || 'desserts_pos',
  user: env.DB_USER || 'desserts',
  password: env.DB_PASSWORD,
  connectionLimit: 10,
  supportBigNumbers: true,
  timezone: 'Z',
});

const app = express();
app.disable('x-powered-by');
installFeedbackWebhook(app, pool, feedback);
const digest = (value) => createHash('sha256').update(value).digest();
const credentials = digest(Buffer.from(`${env.POS_USER}:${env.POS_PASSWORD}`).toString('base64'));
app.use((req, res, next) => {
  const [scheme, value] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !value || !timingSafeEqual(digest(value), credentials)) {
    res
      .set('WWW-Authenticate', 'Basic realm="desserts_pos"')
      .status(401)
      .send('Cashier sign-in required.');
    return;
  }
  next();
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // Basic credentials may be attached automatically by the browser. Accept only same-origin writes.
  if (
    req.method === 'POST' &&
    (req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json'))
  ) {
    res.status(415).json({ error: 'Use a same-origin JSON request.' });
    return;
  }
  next();
});
app.use('/api/products', express.json({ limit: '7mb' }));
app.use(express.json({ limit: '32kb' }));
app.get('/api/register', async (_req, res) => {
  const [products] = await pool.query(
    `SELECT ${productColumns} FROM products WHERE active=TRUE ORDER BY id`,
  );
  const [barcodes] = await pool.query(
    'SELECT barcode,product_id FROM product_barcodes JOIN products ON products.id=product_id WHERE active=TRUE',
  );
  res.json({
    products,
    barcodes: Object.fromEntries(barcodes.map((row) => [row.barcode, row.product_id])),
    whatsappEnabled: Boolean(whatsapp),
    upiMerchant,
    cashier: env.POS_USER,
  });
});
app.get('/api/products', async (_req, res) => {
  const [products] = await pool.query(`SELECT ${productColumns} FROM products ORDER BY id`);
  const [categories] = await pool.query('SELECT name FROM product_categories ORDER BY name');
  res.json({ products, categories: categories.map((category) => category.name) });
});
app.post('/api/categories', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 40)
    throw new InputError('Enter a category name of up to 40 characters.');
  try {
    await pool.execute('INSERT INTO product_categories (name) VALUES (?)', [name]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new InputError('That category already exists.', 409);
    throw error;
  }
  res.status(201).json({ name });
});
app.get('/api/feedback', async (req, res) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
    throw new InputError('Invalid inbox page.');
  const [messages] = await pool.query(
    `SELECT f.message_id AS id,f.sender,f.message,f.received_at AS receivedAt,
      (SELECT j.sale_id FROM review_jobs j WHERE BINARY j.provider_id=BINARY f.reply_to LIMIT 1) AS receiptId
      FROM whatsapp_feedback f WHERE (f.message_id LIKE 'demo-%') = ?
      ORDER BY f.received_at DESC,f.message_id DESC LIMIT 51 OFFSET ?`,
    [feedbackDemo, (page - 1) * 50],
  );
  res.json({
    enabled: Boolean(feedback),
    demo: feedbackDemo,
    messages: messages.slice(0, 50),
    hasMore: messages.length > 50,
  });
});
if (feedbackDemo) {
  app.post('/api/feedback/demo', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 4096)
      throw new InputError('Enter a reply of up to 4096 characters.');
    const phoneNumberId = '100000000000001';
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [
                  {
                    id: `demo-${randomUUID()}`,
                    from: '15550101000',
                    type: 'text',
                    text: { body: message },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    await storeFeedback(pool, feedbackMessages(payload, phoneNumberId));
    res.sendStatus(201);
  });
}
app.post('/api/products', async (req, res) => {
  const upload =
    req.body?.imageData === undefined ? null : await storeProductImage(req.body.imageData);
  let id;
  try {
    id = await saveProduct(pool, upload ? { ...req.body, image: upload.path } : req.body);
  } catch (error) {
    if (upload && error instanceof InputError) {
      await upload
        .discard()
        .catch((cleanupError) => console.error('Image cleanup:', cleanupError.code));
    }
    throw error;
  }
  res.status(req.body?.id === undefined ? 201 : 200).json({ id });
});
app.post('/api/product-barcodes', async (req, res) => {
  const { barcode, productId } = req.body ?? {};
  const value = typeof barcode === 'string' ? barcode.trim().toUpperCase() : '';
  if (!/^[ -~]{1,64}$/.test(value) || !Number.isInteger(productId) || productId < 1) {
    throw new InputError('Select a product and enter a valid barcode of up to 64 characters.');
  }
  const [products] = await pool.execute(
    'SELECT id,code,active FROM products WHERE id=? OR UPPER(code)=?',
    [productId, value],
  );
  if (!products.some((product) => product.id === productId && product.active)) {
    throw new InputError('Select an active product.');
  }
  if (products.some((product) => product.id !== productId)) {
    throw new InputError('This barcode matches another product’s code.', 409);
  }
  try {
    await pool.execute('INSERT INTO product_barcodes (barcode,product_id) VALUES (?,?)', [
      value,
      productId,
    ]);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [[existing]] = await pool.execute(
      'SELECT product_id FROM product_barcodes WHERE barcode=?',
      [value],
    );
    if (existing?.product_id !== productId)
      throw new InputError('This barcode is already linked to another product.', 409);
  }
  res.json({ barcode: value, productId });
});
app.post('/api/sales', async (req, res) => {
  const receipt = await recordSale(pool, parseSale(req.body, Boolean(whatsapp)));
  res.status(201).json(receipt);
});
app.get('/api/sales', async (req, res) => {
  const before = req.query.before;
  if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,19}$/.test(before))) {
    throw new InputError('Invalid order cursor.');
  }
  const [orders] = await pool.query(
    `SELECT s.id,s.order_type AS orderType,s.payment,s.total_paise AS total,s.created_at AS createdAt,s.canceled_at AS canceledAt,
      (SELECT SUM(quantity) FROM sale_items WHERE sale_id=s.id) AS billedQty,
      (SELECT SUM(c.quantity) FROM sale_item_cancellations c WHERE c.sale_id=s.id) AS canceledQty,
      (SELECT SUM(c.quantity * i.price_paise) FROM sale_item_cancellations c
        JOIN sale_items i ON i.sale_id=c.sale_id AND i.product_id=c.product_id WHERE c.sale_id=s.id) AS canceledTotal
      FROM sales s ${before ? 'WHERE s.id < CAST(? AS UNSIGNED)' : ''} ORDER BY s.id DESC LIMIT 26`,
    before ? [before] : [],
  );
  res.json({
    orders: orders.slice(0, 25).map(({ billedQty, canceledQty, canceledTotal, ...order }) => ({
      ...order,
      remainingTotal: order.canceledAt ? 0 : order.total - Number(canceledTotal),
      status:
        order.canceledAt || (canceledQty && Number(canceledQty) === Number(billedQty))
          ? 'Cancelled'
          : canceledQty
            ? 'Partially cancelled'
            : 'Billed',
    })),
    hasMore: orders.length > 25,
  });
});
app.post('/api/sales/:id/items/:productId/cancel', async (req, res) => {
  if (!/^[1-9]\d{0,19}$/.test(req.params.id)) throw new InputError('Invalid bill number.');
  const productId = Number(req.params.productId);
  const { requestId, qty, reason } = req.body ?? {};
  if (
    !/^[1-9]\d{0,9}$/.test(req.params.productId) ||
    productId > 4294967295 ||
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > 99 ||
    !['Order By Mistake', 'Miscommunication', 'Due to Delay'].includes(reason)
  ) {
    throw new InputError('Choose an item, a valid quantity and a cancellation reason.');
  }
  res.json(
    await cancelSaleItem(pool, req.params.id, productId, {
      requestId: requestId.toLowerCase(),
      qty,
      reason,
    }),
  );
});
app.get('/api/sales/:id', async (req, res) => {
  if (!/^[1-9]\d{0,19}$/.test(req.params.id)) throw new InputError('Invalid receipt number.');
  const receipt = await getReceipt(pool, req.params.id);
  if (!receipt) throw new InputError('Receipt not found.', 404);
  res.json(receipt);
});
app.use(
  '/product-images',
  express.static(imageDirectory, {
    immutable: true,
    maxAge: '1y',
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  }),
);
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: 'The upload is too large. Product images can be up to 5 MB.' });
  }
  if (error instanceof InputError || error.type === 'entity.parse.failed') {
    res
      .status(error.status || 400)
      .json({ error: error instanceof InputError ? error.message : 'Invalid request body.' });
    return;
  }
  console.error('Register request error:', error.code || error.name);
  res
    .status(503)
    .json({ error: 'The register service is unavailable. Retry the same billing request.' });
});

const stopWorker = whatsapp ? runReviewWorker(pool, whatsapp) : () => {};
const host = env.HOST || '127.0.0.1';
const port = Number(env.PORT || 4173);
const server = app.listen(port, host, () =>
  console.info(`desserts_pos listening on ${host}:${port}`),
);
function stop() {
  stopWorker();
  server.close(async () => {
    await pool.end();
  });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

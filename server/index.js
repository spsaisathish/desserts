import express from 'express';
import mysql from 'mysql2/promise';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getReceipt, InputError, parseSale, recordSale } from './sales.js';
import { runReviewWorker, whatsappConfig } from './reviews.js';

const env = process.env;
if (!env.POS_USER || !env.POS_PASSWORD || env.POS_PASSWORD.length < 12 || env.POS_PASSWORD.startsWith('replace-')) {
  throw new Error('Set POS_USER and a unique POS_PASSWORD of at least 12 characters in .env.');
}
if (!env.DB_PASSWORD || env.DB_PASSWORD.startsWith('replace-')) throw new Error('Set DB_PASSWORD in .env.');
const whatsapp = whatsappConfig(env);
const pool = mysql.createPool({
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  database: env.DB_NAME || 'desserts_pos',
  user: env.DB_USER || 'desserts',
  password: env.DB_PASSWORD,
  connectionLimit: 10,
  supportBigNumbers: true,
  timezone: 'Z'
});

const app = express();
app.disable('x-powered-by');
const digest = value => createHash('sha256').update(value).digest();
const credentials = digest(Buffer.from(`${env.POS_USER}:${env.POS_PASSWORD}`).toString('base64'));
app.use((req, res, next) => {
  const [scheme, value] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !value || !timingSafeEqual(digest(value), credentials)) {
    res.set('WWW-Authenticate', 'Basic realm="desserts_pos"').status(401).send('Cashier sign-in required.');
    return;
  }
  next();
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // Basic credentials may be attached automatically by the browser. Accept only same-origin writes.
  if (req.method === 'POST' && (req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json'))) {
    res.status(415).json({ error: 'Use a same-origin JSON request.' });
    return;
  }
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/register', async (_req, res) => {
  const [products] = await pool.query(
    'SELECT id,code,name,category,description,price_paise AS price,image FROM products WHERE active=TRUE ORDER BY id');
  res.json({ products, whatsappEnabled: Boolean(whatsapp) });
});
app.post('/api/sales', async (req, res) => {
  const receipt = await recordSale(pool, parseSale(req.body, Boolean(whatsapp)));
  res.status(201).json(receipt);
});
app.get('/api/sales/:id', async (req, res) => {
  if (!/^[1-9]\d{0,15}$/.test(req.params.id)) throw new InputError('Invalid receipt number.');
  const receipt = await getReceipt(pool, req.params.id);
  if (!receipt) throw new InputError('Receipt not found.', 404);
  res.json(receipt);
});
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
app.use((error, _req, res, _next) => {
  if (error instanceof InputError || error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.status || 400).json({ error: error instanceof InputError ? error.message : 'Invalid request body.' });
    return;
  }
  console.error('Register request error:', error.code || error.name);
  res.status(503).json({ error: 'The register service is unavailable. Retry the same billing request.' });
});

const stopWorker = whatsapp ? runReviewWorker(pool, whatsapp) : () => {};
const host = env.HOST || '127.0.0.1';
const port = Number(env.PORT || 4173);
const server = app.listen(port, host, () => console.info(`desserts_pos listening on ${host}:${port}`));
function stop() {
  stopWorker();
  server.close(async () => { await pool.end(); });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

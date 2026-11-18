import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSale, recordSale } from '../server/sales.js';
import { processReview, whatsappConfig } from '../server/reviews.js';

const request = {
  requestId: 'a12b3c4d-12ab-4def-8abc-123456789abc',
  items: [{ id: 1, qty: 2, price: 24900 }],
  orderType: 'Dine-in',
  payment: 'Cash',
};
const number = '+91 90000 12345';

test('customer number is queued only when consent is recorded', () => {
  assert.equal(parseSale({ ...request, phone: number }, true).recipient, '');
  assert.equal(
    parseSale({ ...request, review: true, phone: number }, true).recipient,
    '+919000012345',
  );
  assert.throws(
    () => parseSale({ ...request, review: true, phone: number }, false),
    /WhatsApp requires/,
  );
});

function saleDatabase({ duplicate, hash, price = 24900, stock = 3 } = {}) {
  const calls = [];
  const pool = {
    getConnection: async () => ({
      beginTransaction: async () => calls.push('begin'),
      commit: async () => calls.push('commit'),
      rollback: async () => calls.push('rollback'),
      release: () => calls.push('release'),
      async query(sql, params) {
        if (sql.startsWith('INSERT INTO sales')) {
          calls.push('insert');
          if (duplicate) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
          return [{ insertId: 17 }];
        }
        if (sql.startsWith('SELECT id,request_hash')) return [[{ id: 17, hash }]];
        if (sql.startsWith('SELECT id,name'))
          return [[{ id: 1, name: 'Classic Kunafa', price_paise: price, stock }]];
        if (sql.startsWith('UPDATE products')) calls.push(['stock', params]);
        if (sql.startsWith('INSERT INTO sale_items')) calls.push(['items', params[0]]);
        if (sql.startsWith('UPDATE sales')) calls.push(['total', params[0]]);
        if (sql.startsWith('INSERT INTO review_jobs')) calls.push(['review', params[1]]);
      },
    }),
    async query(sql) {
      if (sql.includes('FROM sales s')) return [[{ id: 17, total: 49800 }]];
      if (sql.includes('FROM sale_item_cancellations')) return [[]];
      return [[{ id: 1, name: 'Classic Kunafa', qty: 2, price: 24900 }]];
    },
  };
  return { calls, pool };
}

test('server prices and opted-in review commit together', async () => {
  const { calls, pool } = saleDatabase();
  const receipt = await recordSale(
    pool,
    parseSale({ ...request, review: true, phone: number }, true),
  );
  assert.equal(receipt.total, 49800);
  assert.deepEqual(calls, [
    'begin',
    'insert',
    ['stock', [2, 1]],
    ['items', [[17, 1, 'Classic Kunafa', 2, 24900, 1]]],
    ['total', 49800],
    ['review', '+919000012345'],
    'commit',
    'release',
  ]);
});

test('insufficient stock rolls back before saving items or deducting stock', async () => {
  const { calls, pool } = saleDatabase({ stock: 1 });
  await assert.rejects(recordSale(pool, parseSale(request, false)), { status: 422 });
  assert.deepEqual(calls, ['begin', 'insert', 'rollback', 'release']);
});

test('untracked products sell without deducting stock', async () => {
  const { calls, pool } = saleDatabase({ stock: null });
  await recordSale(pool, parseSale(request, false));
  assert.equal(
    calls.some((call) => call[0] === 'stock'),
    false,
  );
});

test('a changed price rolls back instead of committing the sale or review', async () => {
  const { calls, pool } = saleDatabase({ price: 26900 });
  await assert.rejects(recordSale(pool, parseSale(request, true)), /menu changed/);
  assert.deepEqual(calls, ['begin', 'insert', 'rollback', 'release']);
});

test('retry returns the first receipt without inserting another review job', async () => {
  const sale = parseSale(request, true);
  const { calls, pool } = saleDatabase({ duplicate: true, hash: sale.hash });
  assert.equal((await recordSale(pool, sale)).id, 17);
  assert.deepEqual(calls, ['begin', 'insert', 'rollback', 'release']);
  const conflict = saleDatabase({ duplicate: true, hash: 'different' });
  await assert.rejects(recordSale(conflict.pool, sale), { status: 409 });
});

const config = whatsappConfig({
  WA_GRAPH_VERSION: 'v99.0',
  WA_PHONE_NUMBER_ID: '111',
  WA_ACCESS_TOKEN: 'test-token',
  WA_TEMPLATE_NAME: 'review_request',
});

for (const outcome of ['accepted', 'unknown']) {
  test(`WhatsApp worker records ${outcome} with a mocked provider`, async () => {
    let result;
    const pool = {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        release() {},
        query: async (sql) =>
          sql.startsWith('SELECT') ? [[{ sale_id: 17, phone: '+919000012345' }]] : [],
      }),
      query: async (_sql, params) => {
        result = params;
      },
    };
    await processReview(pool, config, async (url, options) => {
      assert.match(url, /111\/messages$/);
      const body = JSON.parse(options.body);
      assert.equal(body.to, '919000012345');
      assert.equal(body.template.components[0].parameters[0].text, '17');
      if (outcome === 'unknown') throw new Error('connection lost');
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.test' }] }) };
    });
    assert.equal(result[0], outcome);
    assert.equal(result[1], outcome === 'accepted' ? 'wamid.test' : null);
  });
}

export function whatsappConfig(env) {
  const config = {
    version: env.WA_GRAPH_VERSION,
    sender: env.WA_PHONE_NUMBER_ID,
    token: env.WA_ACCESS_TOKEN,
    template: env.WA_TEMPLATE_NAME,
    language: env.WA_TEMPLATE_LANGUAGE || 'en_US',
  };
  if (![config.version, config.token, config.template].some(Boolean)) return null;
  if (
    !/^v[0-9]+\.[0-9]+$/.test(config.version ?? '') ||
    !/^\d+$/.test(config.sender ?? '') ||
    !config.token ||
    !/^[a-z0-9_]+$/.test(config.template ?? '')
  ) {
    throw new Error(
      'Configure WA_GRAPH_VERSION, WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN and WA_TEMPLATE_NAME together.',
    );
  }
  return config;
}

export function templateMessage(config, job) {
  return {
    messaging_product: 'whatsapp',
    to: job.phone.slice(1),
    type: 'template',
    template: {
      name: config.template,
      language: { code: config.language },
      components: [{ type: 'body', parameters: [{ type: 'text', text: String(job.sale_id) }] }],
    },
  };
}

async function claimReview(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[job]] = await connection.query(
      "SELECT sale_id,phone FROM review_jobs WHERE status='queued' ORDER BY sale_id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (job)
      await connection.query("UPDATE review_jobs SET status='sending' WHERE sale_id=?", [
        job.sale_id,
      ]);
    await connection.commit();
    return job;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function processReview(pool, config, send = fetch) {
  const job = await claimReview(pool);
  if (!job) return false;
  let status = 'unknown';
  let providerId = null;
  let failure = 'Provider acceptance could not be confirmed';
  try {
    const response = await send(
      `https://graph.facebook.com/${config.version}/${config.sender}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(templateMessage(config, job)),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.messages?.[0]?.id) {
      status = 'accepted';
      providerId = data.messages[0].id;
      failure = null;
    } else if (response.status >= 400 && response.status < 500) {
      status = 'failed';
      failure = `Meta rejected the request (HTTP ${response.status})`;
    }
  } catch {
    // A timeout can occur after the provider accepts a message. Avoid duplicate sends.
  }
  await pool.query(
    "UPDATE review_jobs SET status=?,provider_id=?,failure=?,phone=NULL WHERE sale_id=? AND status='sending'",
    [status, providerId, failure, job.sale_id],
  );
  return true;
}

export function runReviewWorker(pool, config) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await pool.query(
        "UPDATE review_jobs SET status='unknown',phone=NULL,failure='Worker stopped before recording acceptance' WHERE status='sending' AND updated_at < CURRENT_TIMESTAMP - INTERVAL 2 MINUTE",
      );
      await processReview(pool, config);
    } catch (error) {
      console.error('WhatsApp queue error:', error.code || error.name);
    } finally {
      running = false;
    }
  }, 2000);
  return () => clearInterval(timer);
}

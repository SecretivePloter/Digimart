import { createServer } from 'node:http';
import { adminHttp } from './admin-http.js';
import { database } from './services.js';
import { listCatalog, productDetail } from './catalog.js';
import { calculateQuote, feePolicyFromEnv } from './quote.js';
import { handlePaymentNotice, midtransFromEnv } from './orders.js';
import type { MidtransNotification } from './midtrans.js';

const pool = database();
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  try { if (await adminHttp(pool,request,response,url.pathname)) return; }
  catch { response.writeHead(503).end('Admin service unavailable'); return; }
  if (request.method === 'POST' && url.pathname === '/webhooks/midtrans') {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 65536) {
          response.writeHead(413).end('Payload too large');
          return;
        }
      }
      const notice = JSON.parse(body) as MidtransNotification;
      const midtrans = midtransFromEnv();
      await handlePaymentNotice(pool, notice, process.env.MIDTRANS_SERVER_KEY!,
        orderId => midtrans.getStatus(orderId));
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    } catch (error) {
      const invalid = error instanceof SyntaxError ||
        (error instanceof Error && /Invalid Midtrans signature|Payment details mismatch|Unknown order|Unknown transaction/.test(error.message));
      response.writeHead(invalid ? 400 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: false }));
    }
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    let body: unknown;
    if (url.pathname === '/health') {
      const result = await pool.query('SELECT 1 AS connected');
      body = { ok: result.rows[0]?.connected === 1 };
    } else if (url.pathname === '/catalog') {
      body = await listCatalog(pool);
    } else if (/^\/catalog\/[^/]+\/quote$/.test(url.pathname)) {
      const selector = decodeURIComponent(url.pathname.slice('/catalog/'.length, -'/quote'.length));
      const product = await productDetail(pool, selector);
      if (!product) {
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Product not found' }));
        return;
      }
      const variant = product.variants.find(v => v.name.toLowerCase() === url.searchParams.get('variant')?.toLowerCase());
      if (!variant) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Select a valid variant' }));
        return;
      }
      if (variant.stock_status === 'out') {
        response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Stock requires admin confirmation' }));
        return;
      }
      body = {
        product: product.name, variant: variant.name, warranty: variant.warranty_label,
        ...calculateQuote(Number(variant.base_price_idr), feePolicyFromEnv()),
      };
    } else if (/^\/catalog\/[^/]+$/.test(url.pathname)) {
      const selector = decodeURIComponent(url.pathname.slice('/catalog/'.length));
      body = await productDetail(pool, selector);
      if (!body) {
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Product not found' }));
        return;
      }
    } else {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  } catch {
    response.writeHead(503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: false }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log('Digimart health server listening');
});

process.on('SIGTERM', () => server.close(() => void pool.end()));

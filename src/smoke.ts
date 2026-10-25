import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ASSETS_BUCKET, database, storage } from './services.js';

const pool = database();
const s3 = storage();
const key = `smoke/${randomUUID()}.txt`;
const payload = `digimart-${randomUUID()}`;
try {
  const result = await pool.query('SELECT current_database() AS database, 1 AS connected');
  if (result.rows[0]?.connected !== 1) throw new Error('Postgres query failed');
  console.log(`Postgres: SELECT 1 passed (${result.rows[0].database})`);
  await s3.send(new PutObjectCommand({ Bucket: ASSETS_BUCKET, Key: key, Body: payload, ContentType: 'text/plain' }));
  const read = await s3.send(new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }));
  if (await read.Body?.transformToString() !== payload) throw new Error('Object storage round trip mismatch');
  console.log('Object storage: upload and download round trip passed');
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: ASSETS_BUCKET, Key: key })).catch(() => {});
  s3.destroy();
  await pool.end();
}

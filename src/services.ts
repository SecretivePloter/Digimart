import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';

export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
    connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000,
    statement_timeout: 30000, idle_in_transaction_session_timeout: 30000,
    keepAlive: true });
  // Idle sockets can fail during a database restart without an active query.
  pool.on('error', () => console.error('Database idle connection lost; pool will reconnect.'));
  return pool;
}

export function storage() {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_REGION ||
      !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('Neon object storage environment variables are required');
  }
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export const ASSETS_BUCKET = 'assets';

import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';

export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
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

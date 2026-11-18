import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError } from './sales.js';

export const imageDirectory = fileURLToPath(new URL('../uploads/product-images/', import.meta.url));
const maxBytes = 5 * 1024 * 1024;

export async function storeProductImage(data) {
  if (typeof data !== 'string' || data.length > Math.ceil(maxBytes / 3) * 4) {
    throw new InputError('Choose an image no larger than 5 MB.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes) throw new InputError('Choose an image no larger than 5 MB.');
  let extension;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) extension = 'png';
  else if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) extension = 'jpg';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
  if (!extension) throw new InputError('Choose a JPEG, PNG, or WebP image.');

  await mkdir(imageDirectory, { recursive: true });
  const name = `${randomUUID()}.${extension}`;
  const file = join(imageDirectory, name);
  await writeFile(file, bytes, { flag: 'wx' });
  return { path: `/product-images/${name}`, discard: () => unlink(file) };
}

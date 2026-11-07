import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { strToU8, zipSync } from 'fflate';
import { docxText } from './ai-media.js';

test('extracts readable Word text without retaining document markup', () => {
  const file = zipSync({ 'word/document.xml': strToU8(
    '<w:document><w:body><w:p><w:r><w:t>Halo &amp; selamat</w:t></w:r></w:p><w:p><w:r><w:t>dunia</w:t></w:r></w:p></w:body></w:document>') });
  assert.equal(docxText(Buffer.from(file)), 'Halo & selamat\ndunia');
});

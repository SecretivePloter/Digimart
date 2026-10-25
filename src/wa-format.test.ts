import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatCatalog, formatProduct } from './wa-format.js';

test('catalog and variant messages show prices and stock without internal warranty duration', () => {
  const list = formatCatalog([{ catalog_number: 1, name: 'YOUTUBE', stock_status: 'ready' }]);
  assert.match(list, /01\. YOUTUBE 🟢/);
  const detail = formatProduct({
    name: 'YOUTUBE', description: 'FAMILY PLAN', terms: 'Garansi 1 bulan',
    variants: [{ name: 'Invite 1 Bulan', base_price_idr: '12000', stock_status: 'limited', warranty_label: '1 bulan' }],
  });
  assert.match(detail, /Rp12\.000 🟡/);
  assert.match(detail, /Garansi 1 bulan/);
});

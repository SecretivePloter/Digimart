import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { CatalogProduct } from './catalog-manage.js';

// Only public product fields are extracted. Supplier links, costs and margins
// are deliberately never returned, stored in the app, or printed.
export function productsFromWorkbook(data: Uint8Array): CatalogProduct[] {
  if (data.length > 5_000_000) throw new Error('File maksimal 5 MB.');
  const files = unzipSync(data, { filter: file =>
    ['xl/sharedStrings.xml','xl/worksheets/sheet1.xml'].includes(file.name) && file.originalSize < 10_000_000 });
  const parser = new XMLParser({ ignoreAttributes:false, parseTagValue:false, processEntities:false });
  const arr = (x: any): any[] => x === undefined ? [] : Array.isArray(x) ? x : [x];
  const text = (x: any): string => typeof x === 'string' ? x : x?.['#text'] ??
    (x?.t !== undefined ? text(x.t) : arr(x?.r).map(r=>text(r.t)).join(''));
  const strings = files['xl/sharedStrings.xml']
    ? arr(parser.parse(strFromU8(files['xl/sharedStrings.xml'])).sst.si).map(text) : [];
  if (!files['xl/worksheets/sheet1.xml']) throw new Error('Sheet pertama tidak ditemukan.');
  const rows = arr(parser.parse(strFromU8(files['xl/worksheets/sheet1.xml'])).worksheet.sheetData.row);
  const products = new Map<string,CatalogProduct>(); let current: CatalogProduct | undefined;
  let headersFound = false;
  for (const row of rows) {
    const cells: Record<string,string> = {};
    for (const cell of arr(row.c)) {
      const col = String(cell['@_r']).replace(/\d/g,'');
      if (!['C','D','F'].includes(col)) continue;
      cells[col] = (cell['@_t']==='s' ? strings[Number(cell.v)] : cell.is ? text(cell.is) : text(cell.v)).trim();
    }
    if (cells.C==='Nama Item' && cells.D==='Varian' && cells.F==='Harga') { headersFound=true; continue; }
    if (!headersFound || !cells.D) continue; // Excludes trailing notes, not products.
    if (cells.C) {
      const slug=cells.C.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      current=products.get(slug);
      if (!current) { current={slug,name:cells.C,description:'',terms:'',active:false,variants:[]}; products.set(slug,current); }
    }
    if (!current) throw new Error('Varian tanpa nama produk.');
    const price=Number(cells.F);
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error('Harga jual kosong atau tidak valid pada baris '+row['@_r']);
    if (current.variants.some(v=>v.name.toLowerCase()===cells.D.toLowerCase())) throw new Error('Nama varian duplikat.');
    current.variants.push({name:cells.D,base_price_idr:price,stock_status:'out',warranty_days:0,
      warranty_label:'',requires_email:false,active:false});
  }
  if (!headersFound || !products.size) throw new Error('Header Nama Item, Varian, Harga pada kolom C, D, F diperlukan.');
  return [...products.values()];
}

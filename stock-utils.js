/* stock-utils.js
   -------------------------------------------------------------
   Shared logic for index.html (counters) and admin.html (admin).
   Keeping the formulas, spreadsheet parsing and report building in
   ONE file means both pages always calculate exactly the same way.
   Nothing in here talks to Firebase or touches the page.
   ------------------------------------------------------------- */

/* ---------- Names, ids, numbers ---------- */
export function cleanName(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
export function normName(s){ return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase(); }
export function normKey(k){ return String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]/g, ''); }
export const round = n => Math.round(n * 1e6) / 1e6;   // removes floating-point noise (0.1+0.2)

/* Stable product id derived from the product name (53-bit hash, cyrb53).
   Same name => same id, so a user's saved counts stay attached to the
   right product even when the admin re-uploads the master list. */
function cyrb53(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++){
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function productId(name){ return 'p' + cyrb53(normName(name)).toString(36); }

/* ---------- The core stock-take formulas ----------
   Variance        = Physical Count - Expected Stock   (+ over, - short)
   Remaining Stock = Expected Stock - Physical Count
   counted === null / undefined  =>  NOT COUNTED (never treated as zero) */
export const STATUS_LABEL = { correct: 'Correct', over: 'Overcount', under: 'Undercount', uncounted: 'Not counted', counted: 'Counted' };
/* expected === null means "no system quantity loaded yet" (product list only): there is nothing to
   compare against, so a counted product is simply "Counted" with no variance. */
export function compare(expected, counted){
  if (counted === null || counted === undefined || Number.isNaN(counted)){
    return { status: 'uncounted', variance: null, remaining: null };
  }
  if (expected === null || expected === undefined) return { status: 'counted', variance: null, remaining: null };
  const variance = round(counted - expected);
  const remaining = round(expected - counted);
  return { status: variance === 0 ? 'correct' : (variance > 0 ? 'over' : 'under'), variance, remaining };
}
/* Physical count of one entry = Items x Cartons + Pieces (the app's existing entry method) */
export function physicalTotal(e){
  return round((Number(e.numItems) || 0) * (Number(e.cartons) || 0) + (Number(e.pieces) || 0));
}
export function entryCount(e){ return (typeof e.total === 'number' && isFinite(e.total)) ? e.total : physicalTotal(e); }

/* Parse something a user typed into a quantity box. Accepts "12", "2.5" or a
   sum like "50+6+8". Rejects letters, negatives, and absurdly large values.
   An empty box is ok:true / empty:true (meaning "nothing typed"). */
export function parseQtyInput(str){
  let s = String(str == null ? '' : str).trim().replace(/[+\s]+$/, '');   // forgive a trailing "+"
  if (s === '') return { ok: true, empty: true, value: 0 };
  if (s.includes('-')) return { ok: false, error: 'Negative numbers are not allowed' };
  if (!/^(\d+\.?\d*|\.\d+)(\s*\+\s*(\d+\.?\d*|\.\d+))*$/.test(s)) return { ok: false, error: 'Numbers only, e.g. 12 or 50+6+8' };
  const value = round(s.split('+').reduce((a, t) => a + parseFloat(t), 0));
  if (!isFinite(value) || value > 1e9) return { ok: false, error: 'That number is too large' };
  return { ok: true, value };
}

/* ---------- Master stock spreadsheet / CSV parsing ----------
   The admin's sheet has report titles and blank rows above the real header,
   so we look for the row that contains BOTH an item-name column and a SYSTEM
   column. Only those two columns are used: TOTAL and DIFF in the file are
   deliberately ignored (users must enter fresh counts). */
const NAME_SYN = ['itemdetails', 'itemdetail', 'itemname', 'productname', 'product', 'description', 'item', 'details'];
const isQtyHeader = k => k === 'system' || k === 'systemqty' || k === 'systemquantity' || k === 'systemstock'
  || k === 'expected' || k === 'expectedqty' || k === 'expectedquantity' || k === 'expectedstock';

export function colLetter(i){ let s = ''; i++; while (i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

const lenientName = k => k.includes('itemdetail') || k.includes('itemname') || k.includes('productname') || k.includes('productdetail') || k.includes('description') || /^(items?|name)$/.test(k);
const lenientQty = k => !k.includes('total') && !k.includes('diff') && (k.includes('system') || k.includes('expected') || /^(qty|quantity|stock|stockqty|balance|onhand|qtyonhand)$/.test(k));
export function findMasterHeader(aoa, scan = 100){
  const limit = Math.min(aoa.length, scan);
  for (const lenient of [false, true]){            // exact names first, then looser matching
    for (let r = 0; r < limit; r++){
      const keys = (aoa[r] || []).map(normKey);
      let nameCol = -1;
      for (const syn of NAME_SYN){ const i = keys.indexOf(syn); if (i !== -1){ nameCol = i; break; } }
      if (nameCol === -1 && lenient) nameCol = keys.findIndex(lenientName);
      let qtyCol = keys.findIndex(isQtyHeader);
      if (qtyCol === -1 && lenient) qtyCol = keys.findIndex(lenientQty);
      if (nameCol !== -1 && qtyCol !== -1 && nameCol !== qtyCol) return { row: r, nameCol, qtyCol, lenient };
    }
  }
  return null;
}
const isBlank = v => v === null || v === undefined || String(v).trim() === '';
function toNumber(v){
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}
export const MAX_MASTER_BYTES = 900000;   // Firestore documents are limited to 1 MiB

/* Validate one sheet's rows. Never throws; returns every problem found so the
   admin can fix the file in one go. Nothing is written anywhere here. */
export function validateMaster(aoa, hdr){
  const errors = [], warnings = [], items = [];
  const seen = new Map(), ids = new Map();
  let skippedBlank = 0, totalExpected = 0;
  for (let r = hdr.row + 1; r < aoa.length; r++){
    const row = aoa[r] || [];
    const xl = r + 1;                                   // spreadsheet row number
    const name = cleanName(row[hdr.nameCol]);
    const rawQty = row[hdr.qtyCol];
    if (row.every(isBlank)){ skippedBlank++; continue; }
    if (!name){
      const q = isBlank(rawQty) ? 0 : toNumber(rawQty);
      if (isBlank(rawQty) || q === 0){ skippedBlank++; continue; }       // empty filler row (e.g. leftover formulas)
      errors.push(`Row ${xl}: missing product name (SYSTEM = ${String(rawQty).trim()})`);
      continue;
    }
    if (name.length > 300){ errors.push(`Row ${xl}: product name is longer than 300 characters`); continue; }
    if (isBlank(rawQty)){ errors.push(`Row ${xl}: "${name}" has no SYSTEM quantity`); continue; }
    const qty = toNumber(rawQty);
    if (!isFinite(qty)){ errors.push(`Row ${xl}: "${name}" has an invalid SYSTEM quantity "${String(rawQty).trim()}"`); continue; }
    if (!Number.isInteger(qty)){ errors.push(`Row ${xl}: "${name}" has a non-whole SYSTEM quantity (${qty})`); continue; }
    if (Math.abs(qty) > 1e9){ errors.push(`Row ${xl}: "${name}" has an unrealistic SYSTEM quantity (${qty})`); continue; }
    const key = normName(name);
    if (seen.has(key)){ errors.push(`Row ${xl}: duplicate product "${name}" (first seen on row ${seen.get(key)})`); continue; }
    seen.set(key, xl);
    const id = productId(name);
    if (ids.has(id)){ errors.push(`Row ${xl}: "${name}" clashes with "${ids.get(id)}" — please rename one`); continue; }
    ids.set(id, name);
    if (qty < 0) warnings.push(`Row ${xl}: "${name}" has a NEGATIVE system quantity (${qty}) — imported as-is`);
    totalExpected += qty;
    items.push({ id, name, expected: qty, row: xl });
  }
  if (!items.length && !errors.length) errors.push('No product rows were found below the header row.');
  if (items.length && JSON.stringify(items.map(i => ({ id: i.id, name: i.name, expected: i.expected }))).length > MAX_MASTER_BYTES){
    errors.push('This list is too large to store as one master document (about 1 MiB limit). Split it or contact the developer.');
  }
  return { ok: errors.length === 0 && items.length > 0, items, errors, warnings, skippedBlank, totalExpected };
}
/* ---- Names-only lists (e.g. a Tally "list of stock items" export with no quantity column) ----
   Used ONLY when no SYSTEM/expected column exists anywhere. Every product gets expected = 0 and the
   master is flagged namesOnly, so the app counts products without showing meaningless variances. */
const FOOTER_RE = /\b\d+\s+stock\s+(group|item)\(?s?\)?/i;
export function findNameOnlyHeader(aoa, scan = 100){
  const limit = Math.min(aoa.length, scan);
  for (const lenient of [false, true]){
    for (let r = 0; r < limit; r++){
      const keys = (aoa[r] || []).map(normKey);
      let nameCol = -1;
      for (const syn of NAME_SYN){ const i = keys.indexOf(syn); if (i !== -1){ nameCol = i; break; } }
      if (nameCol === -1 && lenient) nameCol = keys.findIndex(lenientName);
      if (nameCol === -1){ const j = keys.indexOf('itemsdetails'); if (j !== -1) nameCol = j; }
      if (nameCol !== -1) return { row: r, nameCol, lenient };
    }
  }
  return null;
}
export function validateNamesOnly(aoa, hdr){
  const errors = [], warnings = [], items = [];
  const seen = new Map(), ids = new Map();
  let skippedBlank = 0, skippedFooter = 0, dupes = 0;
  for (let r = hdr.row + 1; r < aoa.length; r++){
    const row = aoa[r] || [];
    const name = cleanName(row[hdr.nameCol]);
    if (!name){ skippedBlank++; continue; }
    if (FOOTER_RE.test(name)){ skippedFooter++; continue; }
    if (name.length > 300){ errors.push(`Row ${r + 1}: product name is longer than 300 characters`); continue; }
    const key = normName(name), id = productId(name);
    if (seen.has(key) || ids.has(id)){ dupes++; if (dupes <= 20) warnings.push(`Row ${r + 1}: duplicate name "${name}" (first seen on row ${seen.get(key) || '?'}) — skipped`); continue; }
    seen.set(key, r + 1); ids.set(id, name);
    items.push({ id, name, expected: 0, row: r + 1 });
  }
  if (dupes > 20) warnings.push(`…and ${dupes - 20} more duplicate names skipped`);
  if (!items.length && !errors.length) errors.push('No product rows were found below the header row.');
  if (items.length && JSON.stringify(items.map(i => ({ id: i.id, name: i.name, expected: 0 }))).length > MAX_MASTER_BYTES){
    errors.push('This list is too large to store as one master document (about 1 MiB limit). Split it or contact the developer.');
  }
  return { ok: errors.length === 0 && items.length > 0, items, errors, warnings, skippedBlank, skippedFooter, totalExpected: 0, namesOnly: true };
}
/* ---- Two-file workflow ----
   1) PRODUCT LIST (masterStock/current): the items users count. Names only is fine.
   2) SYSTEM QUANTITIES (masterStock/system): ITEM DETAILS + SYSTEM, matched to the list by product name.
   Expected stock for a product = its SYSTEM quantity (0 if the system file does not list it), or null
   (= not compared) while no system file has been uploaded. */
export function applySystem(items, listIsNamesOnly, sysMap){
  const hasSys = !!sysMap;
  return items.map(i => ({ id: i.id, name: i.name,
    expected: hasSys ? (Object.prototype.hasOwnProperty.call(sysMap, i.id) ? sysMap[i.id] : 0) : (listIsNamesOnly ? null : i.expected) }));
}
/* Parse a SYSTEM-quantities file: must have a real SYSTEM column. */
export function parseSystemSheets(sheets){
  const res = parseMasterSheets(sheets);
  if (res.namesOnly) return { ...res, ok: false, errors: ['This file has no SYSTEM (expected quantity) column, so it cannot be used as the system quantities. It needs an ITEM DETAILS column and a SYSTEM column.'] };
  return res;
}
/* sheets: [{name, aoa}] — the first sheet that has a recognisable header is used */
export function parseMasterSheets(sheets){
  for (const sh of sheets){
    const hdr = findMasterHeader(sh.aoa || []);
    if (!hdr) continue;
    const res = validateMaster(sh.aoa, hdr);
    return { ...res, sheetName: sh.name, headerRow: hdr.row + 1, lenient: !!hdr.lenient, nameCol: colLetter(hdr.nameCol), qtyCol: colLetter(hdr.qtyCol),
      nameHeader: cleanName(sh.aoa[hdr.row][hdr.nameCol]), qtyHeader: cleanName(sh.aoa[hdr.row][hdr.qtyCol]) };
  }
  for (const sh of sheets){                      // no SYSTEM column anywhere: fall back to a names-only list
    const hdr = findNameOnlyHeader(sh.aoa || []);
    if (!hdr) continue;
    const res = validateNamesOnly(sh.aoa, hdr);
    return { ...res, sheetName: sh.name, headerRow: hdr.row + 1, nameCol: colLetter(hdr.nameCol), qtyCol: '', nameHeader: cleanName(sh.aoa[hdr.row][hdr.nameCol]), qtyHeader: '' };
  }
  const sh = sheets.find(x => (x.aoa || []).some(r => (r || []).some(c => !isBlank(c)))) || sheets[0];
  const seen = [];
  for (const row of (sh && sh.aoa) || []){ const cells = (row || []).filter(c => !isBlank(c)).map(c => cleanName(c).slice(0, 25)); if (cells.length) seen.push(cells.slice(0, 8).join(' | ')); if (seen.length >= 6) break; }
  const sheetList = sheets.map(x => `"${x.name}"`).join(', ');
  return { ok: false, items: [], warnings: [], skippedBlank: 0, totalExpected: 0,
    errors: ['Could not find a header row that contains both an "ITEM DETAILS" column and a "SYSTEM" column.',
      `Sheets in the file: ${sheetList || '(none)'}.`,
      seen.length ? `The first rows I could read (sheet "${sh.name}") were:` : 'I could not read any text from the file (is it empty, password-protected or a different format?).',
      ...seen.map((t, i) => `  row ${i + 1}: ${t}`),
      'Rename your two column headers to ITEM DETAILS and SYSTEM and try again.'] };
}

/* Minimal CSV reader (used only when the Excel library has not loaded). Handles quotes and quoted line breaks. */
export function csvToAoa(text){
  const rows = []; let row = [], cur = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"' && text[i + 1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

/* Find the columns in a counter's own exported/edited file (used by "Import my counts") */
export function locateCountColumns(aoa, scan = 60){
  const limit = Math.min(aoa.length, scan);
  for (let r = 0; r < limit; r++){
    const keys = (aoa[r] || []).map(normKey);
    let nameCol = -1;
    for (const syn of NAME_SYN){ const i = keys.indexOf(syn); if (i !== -1){ nameCol = i; break; } }
    if (nameCol === -1) continue;
    const find = list => { for (const s of list){ const i = keys.indexOf(s); if (i !== -1) return i; } return -1; };
    const out = {
      row: r, nameCol,
      numItems: find(['numberofitems', 'numitems', 'itemspercarton', 'noofitems']),
      cartons: find(['cartons', 'carton', 'ctns', 'ctn']),
      pieces: find(['pieces', 'piece', 'pcs', 'pc']),
      total: find(['physicalcount', 'counted', 'count', 'total', 'totalcounted'])
    };
    if (out.cartons !== -1 || out.pieces !== -1 || out.total !== -1) return out;
  }
  return null;
}

/* ---------- Admin: reconcile several users' counts WITHOUT double counting ----------
   usersMap: { uid: Map(productId -> {count, updatedAt, numItems, cartons, pieces}) }
   Each user's variance is always computed on their own count. For the overall
   figures ONE count is chosen per product (never summed):
     basis 'latest'  -> the most recently saved count
     basis 'highest' -> the highest count     basis 'lowest' -> the lowest count
   opts.uid restricts everything to a single user's entries. */
export function buildReport(masterItems, usersMap, opts = {}){
  const basis = opts.basis || 'latest', only = opts.uid || null;
  const uids = only ? [only] : Object.keys(usersMap);
  const T = { products: masterItems.length, counted: 0, uncounted: 0, expectedAll: 0, expectedCounted: 0, physical: 0,
    over: 0, short: 0, net: 0, correct: 0, overCount: 0, underCount: 0, conflicts: 0 };
  const rows = [];
  for (const p of masterItems){
    T.expectedAll += p.expected || 0;
    const counts = [];
    for (const uid of uids){
      const e = usersMap[uid] && usersMap[uid].get(p.id);
      if (e) counts.push({ uid, count: e.count, updatedAt: e.updatedAt || 0, numItems: e.numItems, cartons: e.cartons, pieces: e.pieces });
    }
    let chosen = null;
    if (counts.length){
      chosen = counts[0];
      for (const c of counts){
        if (basis === 'highest' ? c.count > chosen.count
          : basis === 'lowest' ? c.count < chosen.count
          : c.updatedAt > chosen.updatedAt) chosen = c;
      }
    }
    const conflict = new Set(counts.map(c => c.count)).size > 1;
    const cmp = compare(p.expected, chosen ? chosen.count : null);
    rows.push({ id: p.id, name: p.name, expected: p.expected, counts, count: chosen ? chosen.count : null,
      chosenUid: chosen ? chosen.uid : null, conflict, ...cmp });
    if (chosen){
      T.counted++; T.expectedCounted += p.expected || 0; T.physical += chosen.count;
      if (cmp.variance > 0) T.over += cmp.variance; else if (cmp.variance < 0) T.short += cmp.variance;
      if (cmp.status === 'correct') T.correct++; else if (cmp.status === 'over') T.overCount++; else if (cmp.status === 'under') T.underCount++;
      if (conflict) T.conflicts++;
    } else T.uncounted++;
  }
  for (const k of ['expectedAll', 'expectedCounted', 'physical', 'over', 'short']) T[k] = round(T[k]);
  T.net = round(T.over + T.short);
  return { rows, totals: T };
}

/* ---------- Export helpers ---------- */
export function toCsv(header, rows){
  const esc = v => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^([=+@\t\r]|-(?![\d.]))/.test(s)) s = "'" + s;   // stop Excel treating text as a formula
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}
export async function download(filename, content, mime){
  try{
    const cd = window.claude ? await window.claude.use('downloads') : null;
    if (cd){ await cd.save({ filename, data: (content instanceof Blob) ? content : new Blob([content], { type: mime }) }); return true; }
  }catch(err){
    if (err && err.code === 'declined') return false;
  }
  const blob = (content instanceof Blob) ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('en-US');
export const fmtVar = v => v == null ? '—' : (v > 0 ? '+' : '') + fmt(v);

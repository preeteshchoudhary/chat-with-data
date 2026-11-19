import {pdfReportLines} from './financial-reports.mjs';
import {transactionAnswer} from './transactions.mjs';
import {isNoticeDuration, noticeAnswer, rankEvidence} from './evidence.mjs';
import {hasPeriod, requestedPeriod, scopeTable} from './periods.mjs';

export const extensions = 'pdf docx xlsx pptx csv tsv json txt md html htm log'.split(' ');
export const fileLimit = 20 * 1024 * 1024;
const maxRows = 100_001;
const maxCells = 1_500_000;
const maxExtract = 20_000_000;
const money = (n) => new Intl.NumberFormat('en', {maximumFractionDigits: 2}).format(n);

export function parseDelimited(text, separator = ',') {
  const rows = [];
  let row = [], value = '', quoted = false, closed = false, cells = 0;
  const finishCell = () => {
    if (++cells > maxCells || row.length >= 512) throw Error('Table exceeds the cell limit.');
    row.push(value.trim());
    value = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some(Boolean)) rows.push(row);
    if (rows.length > maxRows) throw Error('Table exceeds 100,000 data rows.');
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[index + 1] === '"') { value += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === separator) finishCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRow();
    } else if (closed && char !== ' ' && char !== '\t') throw Error('Invalid characters after a quoted field.');
    else if (char === '"' && !value.trim() && !closed) { value = ''; quoted = true; }
    else if (!closed) value += char;
  }
  if (quoted) throw Error('Unclosed quoted field.');
  if (value || row.length || closed) finishRow();
  return rows;
}

function chunks(text, location) {
  const result = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + 880, clean.length);
    if (end < clean.length) end = Math.max(start + 600, clean.lastIndexOf(' ', end));
    result.push({location, text: clean.slice(start, end)});
    if (end === clean.length) break;
    start = end - 65;
  }
  return result;
}

const xml = (str) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(str)) throw Error('Unsupported XML declaration.');
  const dom = new DOMParser().parseFromString(str, 'application/xml');
  if (dom.querySelector('parsererror')) throw Error('Damaged Office XML.');
  return dom;
};
const tags = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const joinText = (root) => tags(root, 't').map(node => node.textContent).join('');

async function office(file, type) {
  const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > 2500 || entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? Infinity), 0) > 48 * 1024 * 1024) throw Error('Office archive exceeds the extraction limit.');
  const read = async (path) => {
    const entry = zip.file(path);
    if (!entry) throw Error('Missing Office document component.');
    const content = await entry.async('string');
    if (content.length > 8_000_000) throw Error('Office component exceeds the text limit.');
    return xml(content);
  };
  if (type === 'docx') {
    const dom = await read('word/document.xml');
    return {blocks: tags(dom, 'p').flatMap((p, i) => chunks(joinText(p), 'Paragraph ' + (i + 1)))};
  }
  if (type === 'pptx') {
    const slides = entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).sort((a,b) => a.name.localeCompare(b.name, 'en', {numeric:true}));
    if (slides.length > 300) throw Error('Presentation exceeds 300 slides.');
    const blocks = [];
    for (const entry of slides) {
      const doc = await read(entry.name);
      blocks.push(...chunks(tags(doc, 'p').map(joinText).join(' '), 'Slide ' + entry.name.match(/(\d+)\.xml$/)[1]));
    }
    return {blocks};
  }
  const workbook = await read('xl/workbook.xml');
  const rel = await read('xl/_rels/workbook.xml.rels');
  const targets = new Map(tags(rel, 'Relationship').map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  const strings = zip.file('xl/sharedStrings.xml') ? tags(await read('xl/sharedStrings.xml'), 'si').map(joinText) : [];
  const tables = [];
  let uncalculated = 0, cells = 0, hasFormulas = false;
  const sheets = tags(workbook, 'sheet');
  if (sheets.length > 60) throw Error('Workbook exceeds 60 sheets.');
  for (const sheet of sheets) {
    const name = sheet.getAttribute('name');
    const id = sheet.getAttribute('r:id') || [...sheet.attributes].find(attribute => attribute.localName === 'id')?.value;
    const target = targets.get(id) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) continue;
    const dom = await read(path);
    const rows = [], rowNumbers = [];
    for (const node of tags(dom, 'row')) {
      const row = [];
      for (const cell of tags(node, 'c')) {
        const letters = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0];
        const index = letters ? [...letters].reduce((n,c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : row.length;
        if (index >= 512 || (cells += Math.max(1, index - row.length + 1)) > maxCells) throw Error('Workbook exceeds the cell limit.');
        const kind = cell.getAttribute('t');
        const value = tags(cell, 'v')[0]?.textContent;
        if (tags(cell, 'f').length) {
          hasFormulas = true;
          if (value == null || value === '') uncalculated++;
        }
        row[index] = kind === 's' ? (strings[Number(value)] ?? '') : kind === 'inlineStr' ? joinText(cell) : (value ?? '');
      }
      if (row.some(Boolean)) {
        rows.push(Array.from(row, value => value ?? ''));
        rowNumbers.push(node.getAttribute('r') || String(rowNumbers.length + 1));
        if (rows.length > maxRows) throw Error('Sheet exceeds 100,000 data rows.');
      }
    }
    if (rows.length) tables.push({name, rows, rowNumbers});
  }
  return {tables, warnings: uncalculated ? ['Some formulas have no cached values. Recalculate and save the workbook before analysis.'] : hasFormulas ? ['Formulas use the values saved in the workbook.'] : []};
}

async function pdf(file) {
  const lib = await import('./vendor/pdf.min.mjs');
  const base = new URL('./vendor/', import.meta.url).href;
  lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  const task = lib.getDocument({data:new Uint8Array(await file.arrayBuffer()), cMapUrl:base+'cmaps/', cMapPacked:true, standardFontDataUrl:base+'standard_fonts/', wasmUrl:base+'wasm/', iccUrl:base+'iccs/', isEvalSupported:false, enableXfa:false});
  const blocks = [], empty = [], reportPages = [];
  let length = 0;
  try {
    const doc = await task.promise;
    if (doc.numPages > 400) throw Error('PDF exceeds 400 pages.');
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str ?? '').join(' ');
      if ((length += text.length) > maxExtract) throw Error('PDF exceeds the extracted text limit.');
      if (!text.trim()) empty.push(n);
      const location = 'Page ' + n;
      blocks.push(...chunks(text, location));
      reportPages.push({location, rows:pdfReportLines(content.items)});
      page.cleanup();
    }
  } finally { await task.destroy(); }
  if (!blocks.length) throw Error('No selectable PDF text found. Run OCR and upload a searchable PDF.');
  return {blocks, reportPages, warnings:empty.length ? [empty.length + ' page(s) contained no selectable text.'] : []};
}

export async function readFile(file) {
  const name = file.webkitRelativePath || file.name;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!extensions.includes(extension)) throw Error('Unsupported format.');
  if (file.size > fileLimit) throw Error('File exceeds 20 MB.');
  let parsed;
  if (['docx','xlsx','pptx'].includes(extension)) parsed = await office(file, extension);
  else if (extension === 'pdf') parsed = await pdf(file);
  else {
    const raw = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    if (raw.length > maxExtract) throw Error('File exceeds the extracted text limit.');
    if (['csv','tsv'].includes(extension)) parsed = {tables:[{name:'Data', rows:parseDelimited(raw, extension === 'tsv' ? '\t' : ',')}]};
    else if (extension === 'json') {
      const data = JSON.parse(raw);
      const records = Array.isArray(data) ? data : Object.values(data ?? {}).find(value => Array.isArray(value) && value.length && value.every(plainRecord));
      if (records?.length && records.every(plainRecord)) {
        const keys = [...new Set(records.flatMap(Object.keys))];
        if (keys.length > 512 || records.length > maxRows || records.length * keys.length > maxCells) throw Error('JSON table exceeds the row or cell limit.');
        parsed = {tables:[{name:'JSON records',rows:[keys,...records.map(record => keys.map(key => Object.hasOwn(record,key) && record[key] != null ? String(record[key]) : ''))]}]};
      } else parsed = {blocks:chunks(raw,'JSON document')};
    } else {
      let content = raw;
      if (extension.startsWith('htm')) {
        const inert = document.createElement('template');
        inert.innerHTML = raw;
        inert.content.querySelectorAll('script, style, template, noscript').forEach(node => node.remove());
        content = inert.content.textContent;
      }
      parsed = {blocks:content.split(/\r?\n/).reduce((result,line,index) => {
        result.push(...chunks(line,'Line ' + (index + 1)));
        return result;
      },[])};
    }
  }
  const tables = (parsed.tables ?? []).filter(table => table.rows.length && table.rows[0].some(Boolean));
  const blocks = parsed.blocks ?? [];
  if (blocks.reduce((sum, block) => sum + block.text.length, 0) + tables.reduce((sum, table) => sum + table.rows.flat().reduce((total, cell) => total + cell.length, 0), 0) > maxExtract) throw Error('File exceeds the extracted text limit.');
  if (!tables.length && !blocks.length) throw Error('No readable text or data found.');
  return {id:crypto.randomUUID(),name,extension,tables,blocks,reportPages:parsed.reportPages,warnings:parsed.warnings ?? [],size:file.size};
}

function plainRecord(item) {
  return item && typeof item === 'object' && !Array.isArray(item) && Object.values(item).every(value => value === null || ['string','number','boolean'].includes(typeof value));
}
export function sourcesFor(doc) {
  const blocks = doc.blocks.map(block => ({...block,name:doc.name}));
  for (const table of doc.tables) {
    const headers = table.rows[0];
    blocks.push({name:doc.name,location:table.name + ' · columns',text:headers.filter(Boolean).join(' · ')});
    for (let i = 1; i < table.rows.length; i++) {
      const text = table.rows[i].map((value,index) => value === '' ? '' : (headers[index] || 'Column ' + (index + 1)) + ': ' + value).filter(Boolean).join(' · ');
      if (text) blocks.push({name:doc.name,location:table.name+' · '+(doc.extension === 'json' ? 'record '+i : table.rowNumbers ? 'row '+table.rowNumbers[i] : 'data row '+i),text});
    }
  }
  return blocks;
}

export function retrieve(question, documents) {
  return rankEvidence(question, documents.flatMap(sourcesFor)).slice(0,8).map(item => item.ref);
}

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const hints = {
  product:['product','productname','item','itemname','sku','service','category'],
  revenue:['revenue','sales','salesamount','totalrevenue','netrevenue','netsales','grosssales','turnover'],
  cost:['cost','totalcost','costofgoodssold','cogs','totalexpense','totalexpenses'],
  units:['units','unitssold','quantity','qty','volume'],
  price:['price','unitprice','sellingprice','priceperunit'],
  unitCost:['unitcost','costperunit','variablecostperunit']
};
export function numeric(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const text = value.trim().replace(/^\((.*)\)$/,'-$1').replace(/^[₹$€£]\s*|^(-)[₹$€£]\s*/g,'$1');
  if (!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text.replace(/,/g,''));
}
const currencySymbols = {'₹':['INR'],'€':['EUR'],'£':['GBP'],'$':['USD','CAD','AUD','NZD','SGD','HKD','MXN','ARS','CLP','COP','TWD','UYU','BMD','BBD','BSD','FJD','GYD','JMD','KYD','LRD','NAD','SBD','SRD','TTD','XCD','ZWL']};
const totals = /^(grand\s*total|sub\s*total|totals?|कुल)$/i;

export function analyzeTable(document, table) {
  const headers = table.rows[0].map(normalize);
  const columns = Object.fromEntries(Object.entries(hints).map(([key, options]) => [key,headers.findIndex(header => options.includes(header))]));
  if ((columns.revenue < 0 && (columns.units < 0 || columns.price < 0)) || (columns.cost < 0 && (columns.units < 0 || columns.unitCost < 0))) return null;
  const used = [columns.revenue >= 0 ? columns.revenue : columns.price, columns.cost >= 0 ? columns.cost : columns.unitCost];
  const rows = table.rows.slice(1).filter(row => !totals.test(row[columns.product]?.trim() ?? '') && !totals.test(row.find(value=>value?.trim())?.trim() ?? ''));
  const currencies = new Set(rows.flatMap(row => used.map(index => row[index]?.match(/[₹$€£]/)?.[0] ?? '').filter(Boolean)));
  if (currencies.size > 1) return {error:'This table contains multiple currency symbols. Convert values to one currency first.'};
  const currencyColumn = headers.findIndex(header => ['currency','currencycode','ccy'].includes(header));
  const codes = new Set(rows.map(row => row[currencyColumn]?.trim().toUpperCase()).filter(Boolean));
  if (codes.size > 1) return {error:'This table contains multiple currency codes. Convert values to one currency first.'};
  const [symbol] = currencies;
  const [code] = codes;
  if (code && !/^[A-Z]{3}$/.test(code)) return {error:'Use a three-letter currency code to identify monetary values.'};
  if (symbol && code && !currencySymbols[symbol].includes(code)) return {error:'The currency code '+code+' conflicts with the symbol '+symbol+'. Correct the source before calculating.'};
  const groups = new Map();
  let revenue = 0, cost = 0, skipped = 0, count = 0;
  for (const row of rows) {
    const label = row[columns.product]?.trim() || 'Unspecified product';
    const units = numeric(row[columns.units]);
    const sale = columns.revenue >= 0 ? numeric(row[columns.revenue]) : units * numeric(row[columns.price]);
    const spend = columns.cost >= 0 ? numeric(row[columns.cost]) : units * numeric(row[columns.unitCost]);
    if (!Number.isFinite(sale) || !Number.isFinite(spend) || !Number.isFinite(revenue + sale) || !Number.isFinite(cost + spend)) { skipped++; continue; }
    const group = groups.get(label) ?? {label,revenue:0,cost:0};
    group.revenue += sale;
    group.cost += spend;
    groups.set(label,group);
    revenue += sale;
    cost += spend;
    count++;
  }
  if (!count) return {error:'No rows contain usable revenue and cost values.'};
  return {name:document.name, location:table.name, currency: code ?? (currencySymbols[symbol]?.length===1 ? currencySymbols[symbol][0] : symbol),revenue,cost,count,skipped,profit:revenue-cost,margin:revenue>0 ? (revenue-cost)/revenue*100 : null,
    products:[...groups.values()].map(group => ({...group, profit:group.revenue-group.cost})).sort((a,b) => b.profit-a.profit)};
}

export function pricing(unitCost, fixed, volume, margin) {
  if (![unitCost,fixed,volume,margin].every(Number.isFinite) || unitCost < 0 || fixed < 0 || !Number.isInteger(volume) || volume <= 0 || margin < 0 || margin >= 100) return null;
  const breakEven = unitCost + fixed / volume;
  const target = breakEven / (1 - margin / 100);
  return Number.isFinite(target) ? {breakEven,target} : null;
}

export function answer(question, documents) {
  const hi = /[\u0900-\u097f]/.test(question);
  const packet = (text,refs = [],mode = 'Source search') => ({text,refs,mode});
  if (!documents.length) return packet(hi ? 'पहले फ़ाइलें जोड़ें या नमूना डेटा खोलें।' : 'Add files or try the sample data to ask a source-backed question.');
  if (/breakeven|break.even|target pric|pricing|price.*set|प्राइस|कीमत/.test(question.toLowerCase()) && !/compare|तुलना/.test(question.toLowerCase())) {
    return packet(hi ? 'Business insights में प्रति यूनिट लागत, कुल स्थिर लागत, अनुमानित बिक्री और लक्ष्य मार्जिन डालें। ऐप उन इनपुट से ब्रेक-ईवन और लक्ष्य मूल्य निकालेगा।' : 'Open Business insights to model a price using variable cost per unit, total fixed costs for the period, expected volume and target margin. The price depends on those assumptions.', [], 'Pricing model');
  }
  const broadProfit = /\b(?:profit(?:s|able|ability)?|losing money|margin|loss(?:es)?)\b|लाभ|फायदे|नुकसान|प्रॉफिट|मार्जिन/i.test(question);
  if (broadProfit && documents.some(doc=>doc.tables.length)) {
    if (/region|channel|status|exclud|includ|weighted|rank|top\s+|overall|where|except|greater than|less than|at least|above|below/i.test(question) || (documents.some(doc=>doc.tables.some(table=>table.rows[0].some(header=>/^transaction[ _-]?id$/i.test(header)))) && !/[\u0900-\u097f]/.test(question))) return transactionAnswer(question,documents,analyzeTable);
    const period = requestedPeriod(question);
    const scoped = hasPeriod(period);
    const results = documents.flatMap(doc => doc.tables.flatMap(table => {
      const matching = scopeTable(doc,table,period);
      const result = matching && analyzeTable(doc,matching);
      return result ? [{doc,table,result}] : [];
    }));
    const data = results.filter(item=>!item.result.error).map(item=>item.result);
    if (results.length && !data.length) {
      const refs = results.slice(0,8).map(({doc,table,result})=>({name:doc.name,location:table.name,text:result.error,aggregate:true}));
      return packet(hi ? 'चुनी गई टेबल में गणना के लिए डेटा की समस्या है। स्रोत में कारण देखें।' : 'The matching tables could not be calculated. Check the cited source issues.\n'+[...new Set(refs.map(ref=>ref.text))].join('\n'),refs,'Data issue');
    }
    if (data.length) {
      const refs = data.slice(0,8).map(d => ({name:d.name,location:d.location,aggregate:true,text:d.count+' rows used'+(scoped?' for the requested period':'')+'. Revenue: '+money(d.revenue)+' · Cost: '+money(d.cost)+' · Profit: '+money(d.profit)+(d.currency?' '+d.currency:'')}));
      const lines = data.slice(0,8).map(d => {
        const top = d.products.find(product => product.profit > 0);
        const bottom = d.products.at(-1);
        const notes = [top && ((hi ? 'सबसे अधिक लाभ ' : 'Highest profit ') + top.label + ' (' + money(top.profit) + ')'), bottom.profit < 0 && ((hi ? 'सबसे अधिक नुकसान ' : 'Largest loss ') + bottom.label + ' (' + money(bottom.profit) + ')'),d.skipped && (d.skipped+(hi?' अधूरी पंक्तियाँ छोड़ी गईं':' incomplete rows skipped'))].filter(Boolean);
        return d.name+' / '+d.location+' · '+(hi?'लाभ ':'Profit ')+money(d.profit)+(d.currency?' '+d.currency:'')+(notes.length?'\n'+notes.join(' · '):'');
      });
      if (results.length > data.length) lines.push(hi ? 'कुछ टेबल में समस्याएँ हैं। Business insights में देखें।' : 'Some matching tables could not be calculated. Open Business insights to review them.');
      if (data.length > 8) lines.push(hi ? 'सभी टेबल के लिए Business insights खोलें।' : 'Open Business insights to view every table.');
      return packet(lines.join('\n\n'),refs,'Calculated from tables');
    }
    if (scoped) return packet(hi ? 'पूछी गई अवधि वाली कोई गणना योग्य टेबल नहीं मिली।' : 'No calculable table matches the requested period. Check the period labels in the source names, sheet names or rows.',[],'Insufficient evidence');
  }
  const compare = /compare (?:the )?(?:uploaded|files|documents|sources)|फाइल.*तुलना/i.test(question);
  if (compare && documents.length < 2) return packet(hi ? 'तुलना के लिए कम से कम दो फ़ाइलें जोड़ें।' : 'Add at least two sources to compare them.');
  if (compare || /summari[sz]e|summary|सारांश/i.test(question)) {
    const refs = documents.flatMap(doc => {
      const sources = sourcesFor(doc);
      if (!doc.tables.length) return sources.slice(0,2);
      return sources.filter(source => source.location.endsWith(' · columns')).slice(0,2);
    }).slice(0,24);
    const lines = documents.map(doc => doc.name+' · '+(doc.tables.length ? doc.tables.map(table => table.name + ' (' + (table.rows.length - 1) + (hi ? ' डेटा पंक्तियाँ)' : ' data rows)')).join(', ') : doc.blocks[0]?.text.slice(0,260)));
    if (compare) {
      const schemas = documents.map(doc => new Set(doc.tables.flatMap(table => table.rows[0].map(header => header.trim().toLowerCase()).filter(Boolean))));
      const shared = [...schemas[0]].filter(header => schemas.every(schema => schema.has(header)));
      if (shared.length) lines.push((hi ? 'साझा कॉलम ' : 'Shared columns: ') + shared.join(', '));
      if (schemas.every(schema => schema.size)) {
        schemas.forEach((schema,index) => {
          const unique = [...schema].filter(header => schemas.every((other,i) => i === index || !other.has(header)));
          if (unique.length) lines.push(documents[index].name + (hi ? ' में अलग कॉलम ' : ' only: ') + unique.join(', '));
        });
      }
    }
    return packet(lines.join('\n\n'),refs,compare ? 'Source comparison' : 'Source overview');
  }
  const candidates = rankEvidence(question,documents.flatMap(sourcesFor));
  if (isNoticeDuration(question) && candidates.length) return noticeAnswer(candidates,hi);
  const refs = candidates.slice(0,8).map(candidate=>candidate.ref);
  if (!refs.length) return packet(hi ? 'अपलोड की गई फ़ाइलों में इस सवाल के लिए पर्याप्त प्रमाण नहीं मिला। फ़ाइल में इस्तेमाल किया गया शब्द, उत्पाद या तारीख देकर दोबारा पूछें।' : 'I did not find enough matching evidence in the uploaded files. Try a term, product name, or date used in the source.',[],'Insufficient evidence');
  return packet(hi ? 'इन स्रोतों में सवाल से जुड़े अंश मिले। मूल अंश देखने के लिए स्रोत खोलें।' : 'These passages match your question. Open a citation to inspect the source location.',refs,'Evidence excerpts');
}

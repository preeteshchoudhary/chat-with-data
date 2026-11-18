const quarterWords = {first:1,second:2,third:3,fourth:4,'पहली':1,'दूसरी':2,'तीसरी':3,'चौथी':4};
const months = 'january february march april may june july august september october november december'.split(' ');
const monthPattern = new RegExp('\\b('+months.join('|')+'|'+months.map(month=>month.slice(0,3)).join('|')+'|sept)\\b','gi');

function fields(text, includeMonth = false) {
  const label = text.replace(/_/g,' ').normalize('NFKC');
  const quarter = new Set([...label.matchAll(/(?:\bq(?:uarter)?[-\s]*([1-4])\b|\b([1-4])q\b|\b(first|second|third|fourth)\s+quarter\b|(पहली|दूसरी|तीसरी|चौथी)\s+तिमाही)/gi)]
    .map(match=>Number(match[1]||match[2]) || quarterWords[(match[3]||match[4]).toLowerCase()]));
  const year = new Set([...label.matchAll(/(?:^|[^\p{L}\p{N}])(?:fy\s*)?((?:19|20)\d{2})(?!\d)/giu)].map(match=>Number(match[1])));
  const month = new Set();
  if (includeMonth) {
    for (const match of label.matchAll(monthPattern)) month.add(months.findIndex(value=>value.startsWith(match[1].slice(0,3).toLowerCase()))+1);
    for (const match of label.matchAll(/\b(?:19|20)\d{2}-(0[1-9]|1[0-2])(?:-\d{2})?\b/g)) month.add(Number(match[1]));
  }
  return {quarter,year,month};
}

export function requestedPeriod(question) {
  return fields(question,true);
}
export const hasPeriod = period => Object.values(period).some(values=>values.size > 0);

function matchesPeriod(actual, request) {
  return Object.keys(request).every(key => !request[key].size || (actual[key].size === 1 && request[key].has([...actual[key]][0])));
}

export function scopeTable(doc, table, request) {
  if (!hasPeriod(request)) return table;
  const source = fields(doc.name+' '+table.name,true);
  const eligible = table.rows[0].map((header,index)=>({header:header.toLowerCase().replace(/[^a-z]/g,''),index}))
    .filter(({header})=>/^(period|reportingperiod|quarter|fiscalquarter|year|fiscalyear|calendaryear|month|date|transactiondate|reportingdate)$/.test(header));
  if (!eligible.length) return matchesPeriod(source,request) ? table : null;
  const rows = [table.rows[0]];
  const rowNumbers = table.rowNumbers ? [table.rowNumbers[0]] : undefined;
  for (let i=1;i<table.rows.length;i++) {
    const row = table.rows[i];
    const actual = {quarter:new Set(),year:new Set(),month:new Set()};
    for (const {header,index} of eligible) {
      const raw = row[index]?.trim() ?? '';
      const spans = fields(raw,true);
      if (header.endsWith('quarter') && /^[1-4]$/.test(raw)) spans.quarter.add(Number(raw));
      if (header === 'month' && /^(?:0?[1-9]|1[0-2])$/.test(raw)) spans.month.add(Number(raw));
      for (const key of Object.keys(actual)) for (const value of spans[key]) actual[key].add(value);
    }
    for (const key of Object.keys(actual)) if (!actual[key].size) actual[key] = source[key];
    if (matchesPeriod(actual,request)) {
      rows.push(row);
      rowNumbers?.push(table.rowNumbers[i]);
    }
  }
  return rows.length > 1 ? {...table,rows,rowNumbers} : null;
}

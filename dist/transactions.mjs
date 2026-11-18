import {requestedPeriod,scopeTable} from './periods.mjs';

const format = value => new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(value);
const words = ['one','two','three','four','five','six','seven','eight','nine','ten'];
const failure = text => ({mode:'Query needs clarification',text,refs:[]});

function parse(question) {
  let text = question.toLowerCase();
  if (/\bby\s+(?:net\s+)?(?:revenue|margin|cost)\b/.test(text.replace(/divided by net revenue/g,''))) return null;
  const filters = [];
  for (const dimension of ['region','channel']) {
    const pattern = new RegExp('(?:\\b(?:in|and|for)\\s+(?:the\\s+)?)?\\b([\\w-]+)\\s+'+dimension+'\\b','g');
    text = text.replace(pattern,(_,value)=>{
      filters.push({dimension,value});
      return ' ';
    });
  }
  text = text.replace(/\b(?:exclude|excluding)\s+([\w-]+)(?:\s+transactions?)?/g,(_,value)=>{
    filters.push({dimension:'status',value,negative:true});
    return ' ';
  });
  text = text.replace(/\b(?:but\s+)?include\s+returns?\s+as\s+signed\s+entries\b/g,' ');
  let limit = 1;
  text = text.replace(/\b(?:which|top|rank the top|rank)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+products?\b/g,(_,number)=>{
    limit=Number(number)||words.indexOf(number)+1;
    return ' ';
  });
  const remainder = text.replace(/\b(?:q[1-4]|(?:19|20)\d{2}|for|in|of|only|the|and|by|lead|profit|net|revenue|weighted|margin|divided|plus|overall|totals?|same|filter|each|report|show|give|what|is|products?|highest|most|profitable|which|with|transactions?)\b/g,' ').replace(/[\s,.?!()]+/g,'').trim();
  if (remainder || limit<1 || limit>100 || new Set(filters.map(f=>f.dimension)).size!==filters.length) return null;
  return {filters,limit,period:requestedPeriod(question)};
}

export function transactionAnswer(question,docs,analyze) {
  const plan=parse(question);
  if (!plan) return failure('I could not apply every condition. Specify a quarter/year, one region, one channel, an excluded status, and a top product count by profit.');
  const groups=new Map(), ids=new Set(), refs=[], currencies=new Set();
  let revenue=0,cost=0,count=0;
  const tables=docs.flatMap(doc=>doc.tables.map(table=>({doc,table})));
  for (const filter of plan.filters.filter(filter=>filter.negative)) {
    const known=tables.some(({table})=>{
      const index=table.rows[0].findIndex(header=>header.trim().toLowerCase()===filter.dimension);
      return index>=0 && table.rows.some(row=>row[index]?.trim().toLowerCase()===filter.value);
    });
    if (!known) return failure('The excluded status does not match a value in the uploaded tables. Check the source spelling.');
  }
  for (const {doc,table} of tables) {
    const scoped=scopeTable(doc,table,plan.period);
    if (!scoped) continue;
    const headers=scoped.rows[0].map(h=>h.trim().toLowerCase());
    const idIndex=headers.findIndex(h=>/^transaction[ _-]?id$/.test(h));
    if (tables.length>1 && idIndex<0) return failure('Combining transaction tables requires a Transaction ID column in each matching table.');
    if (!headers.some(h=>['product','product name','sku','item','service','category'].includes(h))) return failure('Product ranking requires a product column in '+doc.name+'.');
    const filters=plan.filters.map(f=>({...f,index:headers.indexOf(f.dimension)}));
    if (filters.some(f=>f.index<0)) return failure('A requested filter column is missing in '+doc.name+'.');
    const rows=scoped.rows.slice(1).filter(row=>filters.every(f=>{
      const actual=(row[f.index]??'').trim().toLowerCase();
      return actual && (f.negative ? actual!==f.value : actual===f.value);
    }));
    if (!rows.length) continue;
    if (idIndex>=0) for (const row of rows) {
      const id=row[idIndex]?.trim();
      if (!id || ids.has(id)) return failure('A matching transaction ID is missing or repeated. Check for overlapping rows.');
      ids.add(id);
    }
    const result=analyze(doc,{...table,rows:[table.rows[0],...rows]});
    if (!result || result.error || result.skipped) return failure(result?.error || 'Matching rows contain missing or unusable revenue or cost values.');
    currencies.add(result.currency||'');
    if (currencies.size>1 || (refs.length && !result.currency)) return failure('Combining sources requires a consistent identified currency.');
    count+=result.count; revenue+=result.revenue; cost+=result.cost;
    for (const group of result.products) {
      const total=groups.get(group.label)??{label:group.label,revenue:0,cost:0};
      total.revenue+=group.revenue; total.cost+=group.cost;
      groups.set(group.label,total);
    }
    refs.push({name:doc.name,location:table.name,aggregate:true,text:result.count+' matching rows · revenue '+format(result.revenue)+' · cost '+format(result.cost)});
  }
  if (!count) return failure('No transaction rows matched the requested period and filters.');
  const line=(label,r,c)=>label+' · net revenue '+format(r)+' · net profit '+format(r-c)+' · weighted margin '+(r ? format((r-c)/r*100)+'%' : 'undefined');
  const ranked=[...groups.values()].sort((a,b)=>(b.revenue-b.cost)-(a.revenue-a.cost)||a.label.localeCompare(b.label)).slice(0,plan.limit);
  return {mode:'Calculated from tables',refs,text:[count+' matching transactions '+([...currencies][0]||''),line('Overall',revenue,cost),...ranked.map((g,i)=>line((i+1)+'. '+g.label,g.revenue,g.cost))].join('\n')};
}

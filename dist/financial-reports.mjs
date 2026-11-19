const metrics={
  revenue:/^(?:(?:total|net|operating) )?(?:revenue|sales)(?: from operations)?$/i,
  'gross profit':/^gross profit$/i,
  'operating profit':/^operating (?:income|profit|loss)$/i,
  'net income':/^(?:net (?:income|profit|loss)|profit after tax|profit for the year)$/i,
  assets:/^total assets$/i,
  liabilities:/^total liabilities$/i,
  equity:/^total (?:shareholders['’]? |stockholders['’]? )?equity$/i,
  'current assets':/^total current assets$/i,
  'current liabilities':/^total current liabilities$/i,
  'operating cash flow':/^(?:operating cash flow|net cash (?:provided by|from|used in) operating activities)$/i,
  'investing cash flow':/^(?:investing cash flow|net cash (?:provided by|from|used in) investing activities)$/i,
  'financing cash flow':/^(?:financing cash flow|net cash (?:provided by|from|used in) financing activities)$/i
};
const year=/^(?:FY\s*)?((?:19|20)\d{2})$/i;
const normalize=value=>value.trim().replace(/\s+/g,' ');

function amount(value){
  const raw=normalize(value);
  if(!/^\(?[-+]?\d+(?:,\d+)*(?:\.\d+)?\)?$/.test(raw)||raw.startsWith('(')!==raw.endsWith(')')) return null;
  const n=Number(raw.replaceAll(',','').replace('(','-').replace(')',''));
  return Number.isFinite(n)?n:null;
}

export function pdfReportLines(items){
  const lines=[];
  for(const item of items){
    if(!item.str?.trim()||!item.transform) continue;
    const [,,,,x,y]=item.transform;
    let line=lines.find(row=>Math.abs(row.y-y)<2);
    if(!line){line={y,cells:[]};lines.push(line);}
    line.cells.push({x,end:x+item.width,text:item.str.trim()});
  }
  return lines.sort((a,b)=>b.y-a.y).map(({cells})=>{
    const merged=[];
    for(const cell of cells.sort((a,b)=>a.x-b.x)){
      const prior=merged.at(-1);
      if(prior&&cell.x-prior.end<8){prior.text+=' '+cell.text;prior.end=cell.end;}
      else merged.push({...cell});
    }
    return Object.assign(merged.map(cell=>cell.text),{edges:merged.map(cell=>cell.end)});
  });
}

function context(text) {
  const currency=text.match(/\b(?:INR|USD|EUR|GBP|CAD|AUD|JPY)\b/i)?.[0].toUpperCase();
  const unit=text.match(/\b(thousands?|millions?|billions?|lakhs?|crores?)\b/i)?.[0].toLowerCase().replace(/s$/,'');
  return [currency,unit].filter(Boolean).join(' ');
}

function facts(doc){
  const tables=[
    ...doc.tables.map(table=>({rows:table.rows,location:i=>table.name+' · row '+(table.rowNumbers?.[i]??i+1)})),
    ...(doc.reportPages??[]).map(page=>({rows:page.rows,location:()=>page.location}))
  ];
  const result=[];
  for(const table of tables){
    let header, columnEdges, units='';
    for(const [index,row] of table.rows.entries()){
      const label=normalize(row[0]??'');
      const years=row.map(cell=>normalize(cell).match(year)?.[1]??null);
      if(years.slice(1).some(Boolean)&&years.slice(1).every(Boolean)&&new Set(years.slice(1)).size===years.length-1){
        header=years;
        columnEdges=row.edges;
        continue;
      }
      if(row.length===1&&/amounts? in|figures? in|in (?:millions|thousands|crores|lakhs)|^(?:USD|INR|EUR|GBP)\b/i.test(label)) units=context(label);
      const metric=Object.keys(metrics).find(key=>metrics[key].test(label));
      if(!metric||!header||header.length!==row.length) continue;
      if(columnEdges&&row.edges.slice(1).some((edge,i)=>Math.abs(edge-columnEdges[i+1])>22)) continue;
      for(let i=1;i<row.length;i++){
        const value=amount(row[i]);
        if(value!==null) result.push({metric,value,year:header[i],units,name:doc.name,location:table.location(index),text:row.join(' | ')+'\nReporting periods: '+header.slice(1).join(' | ')+(units?'\nUnits: '+units:'')});
      }
    }
  }
  return result;
}

const aliases={
  revenue:/\b(?:revenue|sales)\b/i,'gross profit':/\bgross profit\b/i,'operating profit':/\boperating (?:profit|income)\b/i,
  'net income':/\b(?:net income|net profit|profit after tax)\b/i,assets:/\btotal assets\b/i,liabilities:/\btotal liabilities\b/i,
  equity:/\b(?:total )?equity\b/i,'current assets':/\bcurrent assets\b/i,'current liabilities':/\bcurrent liabilities\b/i,
  'operating cash flow':/\b(?:operating cash flow|cash from operations)\b/i,'investing cash flow':/\binvesting cash flow\b/i,'financing cash flow':/\bfinancing cash flow\b/i
};
const ratios=[
  [/gross(?: profit)? margin/i,'gross profit','revenue','Gross margin',true],
  [/operating(?: profit)? margin/i,'operating profit','revenue','Operating margin',true],
  [/net(?: profit)? margin/i,'net income','revenue','Net margin',true],
  [/current ratio/i,'current assets','current liabilities','Current ratio',false]
];
const fmt=new Intl.NumberFormat('en',{maximumFractionDigits:2});
const missing=text=>({text,refs:[],mode:'Report figures need review'});

export function financialAnswer(question,docs) {
  const ratio=ratios.find(([pattern])=>pattern.test(question));
  const matched=Object.keys(aliases).filter(key=>aliases[key].test(question));
  if(matched.includes('current assets')) matched.splice(matched.indexOf('assets'),Number(matched.includes('assets')));
  if(matched.includes('current liabilities')) matched.splice(matched.indexOf('liabilities'),Number(matched.includes('liabilities')));
  const periods=[...new Set(question.match(/\b(?:19|20)\d{2}\b/g)??[])].sort();
  const growth=/growth|year.over.year|yoy|percentage change|percent change/i.test(question);
  const comparison=growth||/compar|difference|change|increase|decrease|higher|lower/i.test(question);
  if(/\b(?:why|forecast|predict|drivers?|explain|what caused|pages?|quarter|q[1-4]|segment|region|excluding|adjusted|restated)\b/i.test(question)) return null;
  if(!ratio&&(!matched.length||(!periods.length&&!growth))) return null;
  const all=docs.flatMap(facts);
  if(!all.length) return null;
  const keys=ratio?ratio.slice(1,3):matched;
  const years=periods.length?periods:[...new Set(all.filter(row=>keys.includes(row.metric)).map(row=>row.year))].sort().slice(growth?-2:-1);
  if(!years.length||comparison&&years.length!==2||ratio&&comparison) return missing('Specify the reporting year, or give two years for a comparison of reported figures.');
  const refs=[], values=new Map();
  for(const key of keys){
    const series=[];
    for(const yr of years){
      const options=all.filter(row=>row.metric===key&&row.year===yr);
      const unique=new Set(options.map(row=>JSON.stringify([row.value,row.units,row.name])));
      if(unique.size!==1) return missing(unique.size?'More than one figure matches '+key+' for '+yr+'. Select one report or clarify which statement to use.':'I could not match a clearly labeled '+key+' figure for '+yr+'. Upload a report with labeled year columns or ask about the relevant page.');
      const found=options[0];series.push(found);
      if(!refs.some(ref=>ref.name===found.name&&ref.location===found.location&&ref.text===found.text))refs.push(found);
    }
    values.set(key,series);
  }
  const lines=[];
  const compatible=rows=>new Set(rows.map(row=>JSON.stringify([row.name,row.units,row.location.split(' · row ')[0]]))).size===1;
  const cite=row=>'['+(refs.findIndex(ref=>ref.name===row.name&&ref.location===row.location&&ref.text===row.text)+1)+']';
  if(ratio){
    const [ ,numerator,denominator,label,percentage]=ratio;
    years.forEach((yr,i)=>{
      const a=values.get(numerator)[i],b=values.get(denominator)[i];
      if(compatible([a,b])&&b.value>0) lines.push(yr+' '+label+' = '+fmt.format(a.value)+' ÷ '+fmt.format(b.value)+' = '+fmt.format(a.value/b.value*(percentage?100:1))+(percentage?'%':'×')+' '+cite(a)+' '+cite(b));
    });
    if(lines.length!==years.length) return missing('The ratio requires comparable figures and a positive denominator for each year.');
  }else for(const [key,rows] of values){
    lines.push(...rows.map(row=>row.year+' '+key+' · '+fmt.format(row.value)+(row.units?' '+row.units:' in reported units')+' '+cite(row)));
    if(comparison){
      const [a,b]=rows;
      if(!compatible(rows)||growth&&a.value<=0) return missing('The comparison requires figures in the same report and units. Percentage growth also requires a positive starting value.');
      const change=b.value-a.value;
      lines.push(yrLabel(a,b)+' '+key+' change · '+fmt.format(change)+(b.units?' '+b.units:' in reported units')+(growth?' ('+fmt.format(change/a.value*100)+'%)':'')+' '+cite(a)+' '+cite(b));
    }
  }
  return {text:lines.join('\n'),refs,mode:'Financial report calculations'};
}

function yrLabel(a,b){return a.year+' → '+b.year;}

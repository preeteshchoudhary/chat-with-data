const stop = new Set('what which where when why how who is are was were did do does a an the of to for and or in on us all across my me file files documents uploaded tell from explain about show please should will would has have है हैं क्या कौन कितना कितनी कितने में का के की को बताओ बताइए से और पर लिए देनी देना पड़ती पड़ता चाहिए पहले'.split(' '));
const aliases = new Map(Object.entries({
  cancelling:'cancellation', canceling:'cancellation', cancel:'cancellation', cancelled:'cancellation', canceled:'cancellation',
  renews:'renewal', renew:'renewal', earnings:'profit', profitable:'profit', sales:'revenue',
  'विक्रेता':'vendor', 'आपूर्तिकर्ता':'vendor', 'अनुबंध':'contract', 'समझौता':'contract', 'रद्द':'cancellation',
  'रद्दीकरण':'cancellation', 'सूचना':'notice', 'नोटिस':'notice', 'अवधि':'period', 'दिन':'day', 'सप्ताह':'week',
  'राजस्व':'revenue', 'बिक्री':'revenue', 'लागत':'cost', 'लाभ':'profit', 'नुकसान':'loss', 'मार्जिन':'margin'
}));

function keywords(text) {
  const tokens = text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return tokens.filter(word => !stop.has(word) && word.length > 1).map(word => {
    const singular = /^[a-z]{4,}s$/.test(word) && !word.endsWith('ss') ? word.slice(0,-1) : word;
    return aliases.get(word) ?? aliases.get(singular) ?? singular;
  });
}

const documentInstruction = /\b(?:ignore|disregard|override|forget)\b[^.!?]{0,85}\b(?:instructions?|sources?|rules?|system|previous|above|prompt)\b|\b(?:assistant|system)\s*:\s*(?:say|reply|answer|output)\b|\b(?:always|only)\s+(?:say|reply|answer|output)\b/i;
const metricTerms = new Set(['revenue','profit','cost','margin','loss','tax','salary','expense','budget','date','price','rate','bandwidth']);
const supportedUnit = /\b(\d{1,7}(?:\.\d+)?)\s*[- ]?\s*((?:business |working |calendar )?days?|hours?|weeks?|months?|years?)\b/gi;
const qualified = /\b(?:at least|at most|no (?:less|more) than|minimum|maximum|up to|except|unless|subject to|only if|before|after|within)\b/i;
const hasNotice = /\b(?:notice|notification)\b/i;
const noticeQuery = /\b(?:notice|notification)\b|सूचना|नोटिस/i;
const durationQuery = /\b(?:period|duration|how long|how many|days|weeks|months|hours)\b|कितने|कितनी|अवधि/i;

function durations(text) {
  const sentences = text.split(/(?<!\d)[.!?]+\s+|;\s+|\n+/);
  return sentences.flatMap(sentence => hasNotice.test(sentence) && !documentInstruction.test(sentence)
    ? [...sentence.matchAll(supportedUnit)].map(([span,number,unit]) => {
      unit = unit.toLowerCase().replace(/s$/,'').replace(/^working /,'business ').replace(/^calendar /,'');
      const asHours = {hour:1,day:24,week:168}[unit];
      return {key:asHours ? Number(number)*asHours + ' hours' : Number(number)+' '+unit,value:span,qualification:qualified.test(sentence) ? sentence.trim() : ''};
    })
    : []);
}

export const isNoticeDuration = (question) => noticeQuery.test(question) && durationQuery.test(question);

export function rankEvidence(question, records) {
  const terms = [...new Set(keywords(question))];
  if (!terms.length) return [];
  const mandatory = terms.filter(term => metricTerms.has(term));
  const notice = isNoticeDuration(question);
  const intentTerms = terms.filter(term => !notice || !['day','hour','week','month','year','period','duration'].includes(term));
  const required = Math.max(1, Math.ceil(intentTerms.length * .60));
  const candidates = [];
  const frequency = new Map();
  for (const ref of records) {
    if (documentInstruction.test(ref.text)) continue;
    const tokens = new Set(keywords(ref.text));
    const matches = intentTerms.filter(term => tokens.has(term));
    for (const term of matches) frequency.set(term,(frequency.get(term) ?? 0)+1);
    if (matches.length < required || mandatory.some(term => !tokens.has(term))) continue;
    if (notice && ['cancellation','renewal','termination'].some(term=>intentTerms.includes(term) && !tokens.has(term))) continue;
    const claims = notice ? durations(ref.text) : [];
    if (notice && !claims.length) continue;
    candidates.push({ref,matches,claims});
  }
  const weight = term => Math.log1p(records.length / frequency.get(term));
  const ranked = candidates.map(candidate => ({...candidate,score:candidate.matches.reduce((sum,term)=>sum+weight(term),0)}))
    .sort((a,b) => b.score-a.score);
  if (notice) return ranked;
  const seenSources = new Set();
  const seenText = new Set();
  const primary = [], secondary = [];
  for (const item of ranked) {
    const text = item.ref.name + '\n' + item.ref.text.trim().toLowerCase();
    if (seenText.has(text)) continue;
    seenText.add(text);
    if (seenSources.has(item.ref.name)) secondary.push(item);
    else {primary.push(item); seenSources.add(item.ref.name);}
  }
  return primary.concat(secondary).slice(0,8);
}

export function noticeAnswer(records, hindi) {
  const values = new Map();
  for (const record of records) {
    for (const claim of record.claims) {
      const existing = values.get(claim.key) ?? {value:claim.value,refs:[],qualification:''};
      if (claim.qualification) existing.qualification ||= claim.qualification;
      if (existing.refs.length < 3 && !existing.refs.some(ref=>ref.name===record.ref.name && ref.location===record.ref.location)) existing.refs.push(record.ref);
      values.set(claim.key,existing);
    }
  }
  if (!values.size) return null;
  const claims = [...values.values()];
  if (claims.length === 1) {
    const [{value,refs,qualification}] = claims;
    if (qualification) return {text:hindi ? 'नोटिस की अवधि के साथ एक शर्त दी गई है। स्रोत का पूरा वाक्य देखें।' : 'The notice period has a qualification. Review the full clause in the cited source.',refs,mode:'Qualified evidence'};
    return {text:hindi ? 'दस्तावेज़ में नोटिस की अवधि '+value+' दी गई है।' : 'The stated notice period is '+value+'.',refs,mode:'Source-backed answer'};
  }
  const visible = claims.slice(0,8);
  const refs = [...new Set(visible.map(claim=>claim.refs[0]))];
  const options = visible.map(({value,refs:[ref]}) => '• '+value+' ['+(refs.indexOf(ref)+1)+']');
  const explanation = hindi ? 'स्रोतों में अलग-अलग नोटिस अवधियाँ दी गई हैं। लागू दस्तावेज़ की पुष्टि करें।' : 'Conflicting notice periods were found. Confirm which document or clause applies before using a value.';
  if (claims.length > visible.length) options.push(hindi ? 'अतिरिक्त विरोधी मान भी मिले।' : 'Additional conflicting values were found.');
  return {text:[explanation,...options].join('\n'),refs,mode:'Conflicting evidence'};
}

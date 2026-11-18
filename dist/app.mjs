import {readFile, fileLimit, sourcesFor, analyzeTable, pricing, answer} from './engine.mjs';

const byId = (id) => document.getElementById(id);
const icons = () => globalThis.lucide?.createIcons();
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const button = (text, className, action) => {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click',action);
  return node;
};
const icon = (name) => {
  const node = element('i');
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden','true');
  return node;
};
const format = (number) => new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(number);
const state = {docs:[],view:'chat',chats:[[]],current:0,loading:false,offlineModel:null,useModel:true,priceDraft:{},selectedSheet:''};
const dialog = byId('dialog');
const thread = byId('thread');
const question = byId('question');
const files = byId('files');
const folders = byId('folders');
const drop = byId('drop');

function showDialog(title, ...children) {
  byId('dialog-title').textContent = title;
  byId('dialog-body').replaceChildren(...children);
  if (!dialog.open) dialog.showModal();
  icons();
}
byId('close-dialog').onclick = () => dialog.close();

function preview(ref) {
  const doc = ref.aggregate && state.docs.find(item => item.name === ref.name);
  const content = [element('p','quiet',ref.location),element('div','source-content',ref.text)];
  if (doc) content.push(button('Inspect original rows','primary',()=>previewDocument(doc)));
  showDialog(ref.name,...content);
}
function previewDocument(doc) {
  const sections = sourcesFor(doc);
  const nodes = sections.slice(0,150).map(ref => {
    const details = element('details','card');
    details.append(element('summary','',ref.location),element('p','source-content',ref.text));
    return details;
  });
  if (sections.length > 150) nodes.unshift(element('p','quiet','Showing the first 150 sections. Search can match sections throughout the file.'));
  showDialog(doc.name,...doc.warnings.map(warning => element('p','status',warning)),...nodes);
}

function row(doc) {
  const item = element('div','file-row');
  const badge = element('span','file-icon');
  badge.append(icon(doc.tables.length ? 'table-2' : 'file-text'));
  const label = button('', 'file-label', () => previewDocument(doc));
  label.title = doc.name;
  label.append(element('strong','',doc.name), element('small','',doc.extension.toUpperCase()+' · '+(doc.tables.length ? doc.tables.length+' table(s)' : doc.blocks.length+' excerpts')+(doc.warnings.length ? ' · review notes' : '')));
  const remove = button('', 'icon-button', () => {
    state.docs = state.docs.filter(item => item.id !== doc.id);
    resetChats();
    render();
  });
  remove.setAttribute('aria-label','Remove '+doc.name);
  remove.append(icon('x'));
  item.append(badge,label,remove);
  return item;
}

function resetChats() {
  state.chats = [[]];
  state.current = 0;
}

function renderSources() {
  byId('count').textContent = state.docs.length;
  byId('nav-count').textContent = state.docs.length;
  byId('clear').hidden = !state.docs.length;
  byId('drop').disabled = state.loading;
  byId('folder').disabled = state.loading;
  byId('demo').disabled = state.loading;
  const empty = element('div','empty');
  empty.append(icon('files'),element('strong','','No sources yet'),element('span','empty-copy','Add files to start asking questions.'));
  byId('source-list').replaceChildren(...(state.docs.length ? state.docs.map(row) : [empty]));
  const view = byId('sources-view');
  if (state.view === 'sources') {
    view.replaceChildren(element('span','eyebrow','WORKSPACE'),element('h1','','Source library'),element('p','','Inspect extracted pages, paragraphs and spreadsheet rows before using them in an answer.'));
    const controls = element('div','field-grid');
    controls.append(button('Upload files','primary',()=>files.click()),button('Upload a folder','primary',()=>folders.click()));
    const list = element('div','card doc-list');
    list.append(...(state.docs.length ? state.docs.map(row) : [empty.cloneNode(true)]));
    view.append(controls,list);
  }
}
async function upload(batch) {
  if (state.loading || !batch.length) return;
  state.loading = true;
  const status = byId('upload-status');
  status.textContent = 'Reading files on this device…';
  renderSources();
  const errors = [];
  let added = 0;
  try {
    for (const file of batch.slice(0,100)) {
      const name = file.webkitRelativePath || file.name;
      if (state.docs.length >= 30) { errors.push('This workspace holds up to 30 sources.'); break; }
      if (state.docs.some(doc => doc.name === name)) { errors.push(name+' · This name is already in the workspace.'); continue; }
      if (file.size > fileLimit) { errors.push(name+' · File exceeds 20 MB.'); continue; }
      if (state.docs.reduce((size, doc) => size + doc.size, 0) + file.size > 80 * 1024 * 1024) { errors.push(name+' · Workspace exceeds the 80 MB total limit.'); continue; }
      try {
        const doc = await readFile(file);
        const chunks = doc.blocks.length + doc.tables.reduce((sum, table) => sum + table.rows.length, 0);
        if (state.docs.reduce((sum, item) => sum + item.sections, 0) + chunks > 150_010) throw Error('Workspace exceeds 150,010 searchable sections.');
        state.docs.push(Object.assign(doc,{sections:chunks}));
        added++;
        errors.push(...doc.warnings.map(warning => name+' · '+warning));
      } catch (error) { errors.push(name+' · '+(error?.message ?? 'Unable to read the file.')); }
    }
    if (batch.length > 100) errors.push('Only the first 100 files in one selection were inspected.');
  } finally {
    state.loading = false;
    status.textContent = [added ? added+' source'+(added===1?'':'s')+' added.' : '', ...errors].filter(Boolean).join('\n');
    files.value = '';
    folders.value = '';
    render();
  }
}
files.onchange = () => upload([...files.files]);
folders.onchange = () => upload([...folders.files]);
drop.onclick = byId('attach').onclick = () => files.click();
byId('folder').onclick = () => folders.click();
drop.ondragover = event => { event.preventDefault(); drop.classList.add('drag'); };
drop.ondragleave = () => drop.classList.remove('drag');
drop.ondrop = event => { event.preventDefault(); drop.classList.remove('drag'); upload([...event.dataTransfer.files]); };
byId('clear').onclick = () => showDialog('Clear workspace?',element('p','','Remove all active sources and conversations from this tab.'),button('Clear workspace','primary',()=>{
  state.docs = [];
  resetChats();
  byId('upload-status').textContent = '';
  dialog.close();
  render();
}));
byId('demo').onclick = () => upload([
  new File(['Product,Revenue,Total Cost,Units Sold\nStarter Kit,162000,123400,270\nPro Subscription,252000,149800,180\nOn-site Support,92000,110500,46\nAdvisory,120000,74000,24'],'q1-sales.csv'),
  new File(['Product,Revenue,Total Cost,Units Sold\nStarter Kit,186400,130300,283\nPro Subscription,298000,163000,200\nOn-site Support,104000,114700,52\nAdvisory,137500,80200,25'],'q2-sales.csv'),
  new File(['Commercial review · April–June\nThe Q2 sales files record the finance team’s approved revenue and direct delivery costs. For comparisons, amounts are in Indian rupees.\nOn-site Support required extra travel and overtime during both quarters. Review scheduling and travel fees before changing prices.\nThe Pilot Pro plan renews on 31 August. Pricing decisions are owned by the commercial lead, Maya Rao.\nFinancial reporting excludes corporate overhead and tax.'],'business-brief.txt')
]);

function renderThread() {
  const chat = state.chats[state.current];
  byId('welcome').hidden = chat.length > 0;
  const turns = chat.map(turn => {
    const section = element('article','turn');
    const prompt = element('p','user-message',turn.prompt);
    prompt.dir = 'auto';
    prompt.setAttribute('aria-label','Your question');
    const reply = element('div','answer');
    const header = element('div','answer-header');
    const mode = element('span','mode',turn.result?.mode ?? 'Reviewing sources');
    header.append(icon('sparkles'),document.createTextNode(' Answer'),mode);
    const body = element('p','',turn.result?.text ?? 'Looking for evidence…');
    body.dir = 'auto';
    reply.append(header,body);
    if (turn.result?.refs?.length) {
      const showExcerpts = ['Evidence excerpts','Conflicting evidence','Qualified evidence'].includes(turn.result.mode);
      const evidence = element('div',showExcerpts ? 'doc-list' : 'evidence');
      turn.result.refs.forEach((ref,i) => {
        const cite = button('['+(i+1)+'] '+ref.name+' · '+ref.location,'ref',()=>preview(ref));
        if (showExcerpts) {
          const item = element('div','card');
          item.append(element('p','',ref.text),cite);
          evidence.append(item);
        } else evidence.append(cite);
      });
      reply.append(evidence);
    }
    if (turn.result?.mode === 'Pricing model') reply.append(button('Open pricing calculator','primary',()=>switchView('business')));
    section.append(prompt,reply);
    return section;
  });
  thread.replaceChildren(...turns);
  byId('send').disabled = chat.some(turn => !turn.result);
  const entries = state.chats.map((items,index) => ({items,index})).filter(item => item.items.length).slice(-12).reverse();
  byId('history').replaceChildren(...(entries.length ? entries.map(({items,index}) => {
    const entry = button(items[0].prompt,'',() => { state.current=index; switchView('chat'); });
    entry.title = items[0].prompt;
    return entry;
  }) : [element('span','','Questions will appear here')]));
}

function pricingCard() {
  const card = element('section','card');
  card.append(element('h2','','Pricing scenarios'),element('p','','Use costs and expected unit sales from the same period and currency.'));
  const fields = element('div','field-grid');
  const output = element('div','metric-grid');
  output.setAttribute('aria-live','polite');
  const config = [['Variable cost / unit','0','any'],['Total fixed costs','0','any'],['Expected units','1','1'],['Target margin (%)','0','any']];
  const inputs = config.map(([label,min,step],index) => {
    const wrapper=element('label','',label);
    const input=element('input');
    input.type='number'; input.min=min; input.step=step;
    if (index === 3) input.max='99.999999';
    input.value=state.priceDraft[index] ?? '';
    input.addEventListener('input', () => {
      state.priceDraft[index]=input.value;
      refresh();
    });
    wrapper.append(input);
    fields.append(wrapper);
    return input;
  });
  const refresh = () => {
    const values = inputs.map(input => input.valueAsNumber);
    const result = inputs.every(input => input.validity.valid) ? pricing(...values) : null;
    if (!result) {
      output.replaceChildren(element('span','quiet',inputs.every(input => input.value !== '') ? 'Enter nonnegative costs, whole expected units above zero and a margin below 100%.' : 'Enter all four values to see the two prices.'));
      return;
    }
    output.replaceChildren(metric('Break-even / unit',format(result.breakEven)),metric('Target price / unit',format(result.target)));
  };
  refresh();
  card.append(fields,output,element('p','quiet','Break-even = variable cost per unit + fixed costs ÷ expected units. Target price = break-even ÷ (1 − target margin). Prices are scenario estimates, rounded for display.'));
  return card;
}
function metric(label,value,loss=false) {
  const box = element('div','metric');
  box.append(element('small','',label),element('strong',loss?'loss':'',value));
  return box;
}

function business() {
  const container = byId('business-view');
  container.replaceChildren(element('span','eyebrow','WORKSPACE'),element('h1','','Business insights'),element('p','','Review profitability by source and test how costs, volume and margin affect pricing.'));
  const card = element('section','card');
  card.append(element('h2','','Profit and loss'));
  const tables = state.docs.flatMap(doc => doc.tables.map((table,index) => ({doc,table,key:doc.id+'-'+index,result:analyzeTable(doc,table)}))).filter(item => item.result);
  if (!tables.length) card.append(element('p','','Upload a table with Revenue and Total Cost columns, or Units Sold, Unit Price and Unit Cost. Use a Product column to group results.'));
  else {
    const label = element('label','','Source table');
    const select = element('select');
    for (const sheet of tables) {
      const option = element('option','',sheet.doc.name+' / '+sheet.table.name);
      option.value=sheet.key;
      select.append(option);
    }
    if (tables.some(sheet => sheet.key === state.selectedSheet)) select.value=state.selectedSheet;
    select.onchange = () => { state.selectedSheet=select.value; refresh(); };
    label.append(select);
    const results = element('div');
    const refresh = () => {
      const item = tables.find(sheet => sheet.key === select.value);
      const d = item.result;
      results.replaceChildren();
      if (d.error) { results.append(element('p','status',d.error)); return; }
      const metrics = element('div','metric-grid');
      metrics.append(metric('Revenue',format(d.revenue)),metric('Cost',format(d.cost)),metric('Profit / loss',format(d.profit),d.profit<0),metric('Margin',d.margin==null?'—':format(d.margin)+'%',d.margin<0));
      const table = element('table');
      const head = table.createTHead().insertRow();
      for (const name of ['Product','Revenue','Cost','Profit / loss']) {
        const cell = element('th','',name);
        cell.scope='col'; head.append(cell);
      }
      const body = table.createTBody();
      for (const group of d.products.slice(0,250)) {
        const tr=body.insertRow();
        tr.append(element('td','',group.label),element('td','',format(group.revenue)),element('td','',format(group.cost)),element('td',group.profit<0?'loss':'',format(group.profit)));
      }
      const wrap = element('div','table-scroll');
      wrap.append(table);
      results.append(metrics,element('p','quiet',d.count+' rows used'+(d.currency?' · '+d.currency:'')+(d.skipped?' · '+d.skipped+' incomplete rows skipped':'')+' · Profit = revenue − cost. Include all relevant costs and use one currency per table.'),wrap);
      if (d.products.length > 250) results.append(element('p','quiet','Showing the 250 largest results by profit. Totals include all counted rows.'));
      const lowest = d.products.at(-1);
      if (lowest.profit < 0) results.append(element('p','','Review cost drivers, discounts and volume for '+lowest.label+' first. Use the pricing calculator to test changes.'));
      results.append(button('Inspect source','ref',()=>previewDocument(item.doc)));
    };
    refresh();
    card.append(label,results);
  }
  container.append(card,pricingCard());
}

function render() {
  renderSources();
  renderThread();
  if (state.view === 'business') business();
  icons();
}
function switchView(view) {
  state.view = view;
  byId('chat').hidden = byId('composer-wrap').hidden = view !== 'chat';
  byId('sources-view').hidden = view !== 'sources';
  byId('business-view').hidden = view !== 'business';
  for (const item of document.querySelectorAll('.nav')) {
    const active = item.dataset.view === view;
    item.classList.toggle('active',active);
    if (active) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  }
  byId('page-name').textContent = {chat:'Ask AI',sources:'Source library',business:'Business insights'}[view];
  byId('sidebar').classList.remove('open');
  byId('menu').setAttribute('aria-expanded','false');
  render();
  window.scrollTo(0,0);
}
for (const item of document.querySelectorAll('.nav')) item.onclick = () => switchView(item.dataset.view);
byId('new').onclick = () => {
  if (state.chats[state.current].length) {
    state.chats.push([]);
    state.current=state.chats.length-1;
  }
  question.value='';
  switchView('chat');
  question.focus();
};
byId('menu').onclick = () => byId('menu').setAttribute('aria-expanded',String(byId('sidebar').classList.toggle('open')));
document.addEventListener('click',event=>{
  if (byId('sidebar').classList.contains('open') && !event.target.closest('#sidebar,#menu')) {
    byId('sidebar').classList.remove('open');
    byId('menu').setAttribute('aria-expanded','false');
  }
});
byId('privacy').onclick = () => {
  const title = state.offlineModel ? 'Local model and privacy' : 'Files stay in this tab';
  const copy = [element('p','','The workspace holds extracted text and conversations in this tab’s memory. Refresh or close the page to clear them. File content is never sent to the hosted site.')];
  if (state.offlineModel) {
    const label = element('label');
    const check = element('input');
    check.type='checkbox'; check.checked=state.useModel;
    check.onchange=()=>{state.useModel=check.checked;};
    label.append(check,document.createTextNode(' Use installed local model · '+state.offlineModel));
    copy.push(element('p','','When enabled, the question and selected source excerpts go to the local model running on this computer.'),label);
  }
  showDialog(title,...copy);
};

async function localAnswer(prompt, fallback) {
  if (!state.offlineModel || !state.useModel || !fallback.refs.length || !['Evidence excerpts','Source overview','Source comparison'].includes(fallback.mode)) return fallback;
  try {
    const result = await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:prompt,evidence:fallback.refs.slice(0,8).map(ref=>({source:ref.name.slice(0,350),location:ref.location.slice(0,200),text:ref.text.slice(0,1600)}))}),signal:AbortSignal.timeout(95000)});
    if (!result.ok) throw Error('Model unavailable');
    const model = await result.json();
    if (typeof model.answer !== 'string' || !Array.isArray(model.citations) || !model.citations.length) throw Error('No citations');
    const valid = [...new Set(model.citations)];
    if (valid.some(index => !Number.isInteger(index) || index < 1 || index > Math.min(8,fallback.refs.length))) throw Error('Invalid citation');
    return {text:model.answer, refs:valid.map(index=>fallback.refs[index-1]),mode:'Local model · review sources'};
  } catch {
    return {...fallback, text:'Local model unavailable or evidence was insufficient.\n\n'+fallback.text};
  }
}

async function ask(prompt) {
  prompt=prompt.trim();
  const chat=state.chats[state.current];
  if (!prompt || chat.some(turn=>!turn.result)) return;
  question.value='';
  const turn={prompt};
  chat.push(turn);
  renderThread();
  icons();
  thread.lastElementChild?.scrollIntoView({block:'nearest'});
  try { turn.result = await localAnswer(prompt,answer(prompt,state.docs)); }
  catch { turn.result = {text:'The workspace could not process this question. Try fewer sources or a more specific question.',refs:[],mode:'Unable to answer'}; }
  if (chat === state.chats[state.current]) {
    renderThread();
    icons();
    thread.lastElementChild?.scrollIntoView({block:'nearest'});
  }
}
byId('composer').onsubmit=event=>{event.preventDefault();addQuestion();};
function addQuestion() { ask(question.value); }
question.onkeydown=event=>{
  if (event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();addQuestion();}
};
for (const suggestion of document.querySelectorAll('.suggest')) suggestion.onclick=()=>ask(suggestion.dataset.prompt);
if (['127.0.0.1','localhost'].includes(location.hostname)) {
  fetch('/api/config',{signal:AbortSignal.timeout(3000)}).then(result=>result.ok ? result.json() : null).then(data=>{
    if (data?.model) {
      state.offlineModel=data.model;
      byId('privacy').replaceChildren(icon('shield-check'),document.createTextNode(' Local model available'));
      icons();
    }
  }).catch(()=>{});
}
switchView('chat');

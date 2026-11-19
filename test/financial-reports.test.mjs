import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financialAnswer,pdfReportLines} from '../dist/financial-reports.mjs';

const cells=[['USD millions'],['Metric','2024','2025'],['Revenue','100','125'],['Gross profit','40','50'],['Net income','(5)','10'],['Total current assets','60','84'],['Total current liabilities','30','42'],['Net cash from operating activities','30','50']];
const doc={name:'Annual report',tables:[{name:'Statement',rows:cells}]};

test('financial calculations cite report rows and distinguish margins from cash flow',()=>{
  assert.match(financialAnswer('Revenue growth 2024 to 2025',[doc]).text,/25 USD million \(25%\)/);
  assert.match(financialAnswer('Net margin in 2024',[doc]).text,/-5%/);
  assert.match(financialAnswer('Current ratio for 2025',[doc]).text,/2×/);
  const result=financialAnswer('Operating cash flow in 2025',[doc]);
  assert.match(result.text,/50 USD million/);
  assert.match(result.refs[0].text,/2024 \| 2025/);
  assert.equal(financialAnswer('Why did revenue grow in 2025?',[doc]),null);
  assert.match(financialAnswer('Revenue in 2023',[doc]).text,/could not match/);
  assert.match(financialAnswer('Revenue in 2025',[doc,{...doc,name:'Another company'}]).text,/More than one figure/);
});

test('positioned PDF rows retain year-to-amount alignment and page citations',()=>{
  const items=cells.flatMap((row,i)=>row.map((str,j)=>({str,width:str.length*5,transform:[1,0,0,1,j?100+j*110-str.length*5:10,500-i*15]})));
  const document={name:'Report.pdf',tables:[],reportPages:[{location:'Page 6',rows:pdfReportLines(items)}]};
  assert.equal(financialAnswer('Gross margin in 2025',[document]).refs[0].location,'Page 6');
  assert.match(financialAnswer('Gross margin in 2025',[document]).text,/40%/);
});

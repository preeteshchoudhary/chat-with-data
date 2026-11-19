import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectPdfEvidence,verifyPdfAnswer} from '../dist/pdf-chat.mjs';

const docs=[{name:'Study.pdf',blocks:[
  {location:'Page 1',text:'Executive overview of the field pilot.'},
  {location:'Page 2',text:'The field pilot used a stratified sampling design.'},
  {location:'Page 9',text:'The pilot had a small sample and seasonal effects.'}
]}];
test('PDF retrieval ranks findings and respects page limits',()=>{
  assert.equal(selectPdfEvidence('What design was used?',docs).refs[0].location,'Page 2');
  assert.deepEqual(selectPdfEvidence('Summarize pages 2–3',docs).refs.map(x=>x.location),['Page 2']);
  assert.equal(selectPdfEvidence('Summarize page 400',docs).modelRefs.length,0);
  assert.ok(selectPdfEvidence('Summarize this PDF',docs).refs.some(ref=>ref.location==='Page 9'));
});
test('PDF claims require matching quotes with valid page references',()=>{
  const {refs}=selectPdfEvidence('What design was used?',docs);
  const answer=(id,quote)=>({claims:[{text:'It used stratified sampling.',evidence:[{id,quote}]}]});
  assert.match(verifyPdfAnswer(answer(1,'stratified sampling design'),refs).text,/\[1\]/);
  assert.equal(verifyPdfAnswer(answer(1,'randomized sampling'),refs),null);
  assert.equal(verifyPdfAnswer(answer(9,'stratified sampling design'),refs),null);
});

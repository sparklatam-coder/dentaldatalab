import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperator,operatorPanel,correctionContact,ISSUE_URL} from '../scripts/site-operations.mjs';
test('operator identity remains unknown until supplied and email rejects injection',()=>{
 assert.deepEqual(validateOperator(),{operatorName:null,correctionEmail:null});
 for(const email of ['a@example.com?bcc=x@y.com','a@example.com\r\nBCC:x@y.com','javascript:alert(1)'])assert.throws(()=>validateOperator({correctionEmail:email}));
 assert.throws(()=>validateOperator({operatorName:'<b>name</b>'}));
 assert.match(operatorPanel({}),/확인 중/);
});
test('public correction route is explicit and does not silently send local memo',()=>{
 const h=correctionContact({});assert(h.includes(ISSUE_URL));assert.match(h,/누구나 볼 수/);assert.match(h,/자동으로 제출되지/);assert(!h.includes('mailto:'));
 const withMail=correctionContact({correctionEmail:'correct@example.com'});assert.match(withMail,/mailto:correct@example.com/);
});

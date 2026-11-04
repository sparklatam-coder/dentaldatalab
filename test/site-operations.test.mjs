import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperator,operatorPanel,correctionContact,mailtoHref,mailtoLink,ISSUE_URL} from '../scripts/site-operations.mjs';
test('mailto helpers keep @ readable, encode the rest and share one rendering across footer, operator panel and correction page',()=>{
 assert.equal(mailtoHref('a+b@example.com'),'mailto:a%2Bb@example.com');
 assert.equal(mailtoHref('a@example.com','[치과데이터랩] 공개정보 정정 요청'),'mailto:a@example.com?subject='+encodeURIComponent('[치과데이터랩] 공개정보 정정 요청'));
 assert.equal(mailtoLink("o'x@example.com"),'<a href="mailto:o&#39;x@example.com">o&#39;x@example.com</a>');
 const config={correctionEmail:'ceo@example.com'};
 assert(operatorPanel(config).includes(mailtoLink('ceo@example.com')));
 assert(correctionContact(config).includes(`href="${mailtoHref('ceo@example.com','[치과데이터랩] 공개정보 정정 요청')}"`));
});
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

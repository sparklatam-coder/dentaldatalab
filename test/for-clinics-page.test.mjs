import test from 'node:test';
import assert from 'node:assert/strict';
import {forClinicsBody, CORRECTION_SUBJECT} from '../scripts/for-clinics-page.mjs';
import {isIndexableRoute} from '../scripts/seo.mjs';

test('owner page explains sources, offers a free correction path and promises no paid placement', () => {
  const html = forClinicsBody({correctionEmail: 'fix@example.test', snapshot: '2026-09-30'});
  assert.match(html, /심평원 공공데이터\(2026-09-30 기준\)/);
  assert.match(html, new RegExp('mailto:fix@example.test\\?subject=' + encodeURIComponent(CORRECTION_SUBJECT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /비용을 내고 노출 위치나 표시 내용을 바꿀 수 있는 방법도 없습니다/);
  assert.match(html, /환자 정보나 개인 연락처는 적지 마세요/);
  assert.match(html, /처리 기한을 약속하지는 않습니다/);
  assert.doesNotMatch(html, /무료 진단|컨설팅|프리미엄|상위 노출 가능/);
});

test('without a correction email the page still offers the public form and no empty mailto', () => {
  const html = forClinicsBody({correctionEmail: null, snapshot: '2026-09-30'});
  assert.doesNotMatch(html, /mailto:/);
  assert.match(html, /공개 정정 제보 양식\(GitHub\)/);
});

test('owner page and condition pages are indexable', () => {
  for (const route of ['/for-clinics/', '/conditions/', '/conditions/sunday/', '/regions/110000/110001/night/']) assert.ok(isIndexableRoute(route), route);
});

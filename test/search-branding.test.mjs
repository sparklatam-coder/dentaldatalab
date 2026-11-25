import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationMeta,brandingMeta,publisherSchema} from '../scripts/search-branding.mjs';
test('Naver verification omitted until a valid public challenge is supplied',()=>{
 assert.equal(verificationMeta(), '');
 assert.match(verificationMeta('abcdef1234567890'),/content="abcdef1234567890"/);
 for (const bad of ['<script>alert(1)</script>','short',{},'has spaces 123']) assert.throws(()=>verificationMeta(bad));
});
test('branding escapes page text and uses absolute image URLs',()=>{
 const meta=brandingMeta('https://dentaldatalab.com','<title>','"description"');
 assert.match(meta,/&lt;title&gt;/);assert.match(meta,/&quot;description&quot;/);
 assert.match(meta,/https:\/\/dentaldatalab.com\/assets\/og-share.png/);
 const schema=publisherSchema('https://dentaldatalab.com');assert.equal(schema['@id'],'https://dentaldatalab.com/#publisher');assert.equal(schema.logo.width,192);assert.equal(schema.address,undefined);
});
test('pages may use their own share card under /assets/og/ only',()=>{
 const meta=brandingMeta('https://dentaldatalab.com','토요일 진료 치과','설명','/assets/og/condition-saturday.png');
 assert.match(meta,/og:image" content="https:\/\/dentaldatalab.com\/assets\/og\/condition-saturday.png"/);
 assert.match(meta,/twitter:image" content="https:\/\/dentaldatalab.com\/assets\/og\/condition-saturday.png"/);
 assert.match(meta,/og:image:alt" content="토요일 진료 치과 — 치과데이터랩"/);
 for (const bad of ['https://evil.test/x.png','/assets/og/../x.png','/assets/og/x.jpg','/assets/og/"x.png']) assert.throws(()=>brandingMeta('https://dentaldatalab.com','t','d',bad));
});

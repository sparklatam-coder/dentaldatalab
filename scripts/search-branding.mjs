import {esc} from '../src/shared.mjs';
export function verificationMeta(value='') {
  if (!value) return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new Error('Invalid Naver site verification code');
  return `<meta name="naver-site-verification" content="${value}">`;
}
export function brandingMeta(origin,title,description) {
  const image=origin+'/assets/og-share.png';
  return `<meta property="og:image" content="${image}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="치과데이터랩 — 전국 치과 공공데이터"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${image}"><meta name="twitter:image:alt" content="치과데이터랩 — 전국 치과 공공데이터"><link rel="icon" href="/assets/logo-192.png" type="image/png" sizes="192x192"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180">`;
}
export function publisherSchema(origin) {
  return {'@context':'https://schema.org','@type':'Organization','@id':origin+'/#publisher',name:'치과데이터랩',alternateName:'Dental Data Lab',url:origin,logo:{'@type':'ImageObject',url:origin+'/assets/logo-192.png',width:192,height:192}};
}

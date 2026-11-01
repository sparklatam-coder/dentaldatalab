import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SPEC=importlib.util.spec_from_file_location('booking_dom',ROOT/'scripts/parse-saved-naver-booking.py')
MODULE=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(MODULE)


class BookingDOMTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old_root=MODULE.ROOT;MODULE.ROOT=Path(self.temp.name)
        self.record={'clinicId':'c-fixture','name':'시험치과의원'}
        self.url='https://m.booking.naver.com/booking/13/bizes/419159'
        self.asset={'url':self.url,'ownership':'linked','checkedAt':'2026-10-31T20:00:00Z'}
    def tearDown(self):
        MODULE.ROOT=self.old_root;self.temp.cleanup()
    def parse(self,body,url=None):
        file=MODULE.ROOT/'123-booking.html'
        file.write_text('<!-- saved from url=(1)'+(url or self.url)+' -->'+body)
        return MODULE.parse(file,self.record,self.asset,{'시험치과의원'})

    def test_collapsed_intro_and_truncated_card_body_are_not_imported(self):
        cap=self.parse('''<h1 class="HeaderBookingHome__title__x">시험치과의원</h1>
          <div class="HomeSummary__detail_sub__x">업체의 표시 요약</div>
          <li class="HomeBookingList__booking_item__x"><div class="HomeBookingList__desc_title__x">첫 방문</div><div class="HomeBookingList__desc_detail__x">두 줄 밖에 숨은 카드 마지막 문장</div></li>
          <div class="Information__root__x Information__type_more__x"><div>아직 펼치지 않은 소개 전체</div></div><button>소개 더보기</button>''')
        text=cap['publisherContent']['text']
        self.assertIn('업체의 표시 요약',text);self.assertIn('첫 방문',text)
        self.assertNotIn('숨은 카드',text);self.assertNotIn('펼치지 않은',text)
        self.assertFalse(cap['metadata']['declaredScopeComplete'])
        self.assertEqual({s['kind'] for s in cap['metadata']['sections'] if s['status']=='incomplete'},{'introduction','serviceDescriptions'})

    def test_open_modal_is_complete_but_review_and_script_text_stay_out(self):
        cap=self.parse('''<h1 class="HeaderBookingHome__title__x">시험치과의원</h1>
          <div class="Information__root__x Information__type_more__x">접힌 중복 본문</div>
          <div class="common_modal show Information__home_detail_modal__x"><div class="Information__modal_inner__x">실제 소개<br>마지막 문장<p>추가 업체 설명</p><script>비공개 상태 문자열</script></div></div>
          <div class="review_content">방문자 리뷰 및 업체 답글</div>''')
        text=cap['publisherContent']['text']
        self.assertIn('실제 소개\n마지막 문장',text);self.assertIn('추가 업체 설명',text)
        for value in ['접힌 중복','방문자 리뷰','비공개 상태']:self.assertNotIn(value,text)
        self.assertEqual(cap['publisherContent']['contentKind'],'home')

    def test_service_notice_has_separate_scope_and_excludes_booking_selection(self):
        body='''<h1 class="BizItemHeader__title__x">시험치과의원</h1><h2 class="info_title">첫 방문</h2>
          <button role="tab" aria-selected="true" data-click-code="tab.book">예약하기</button>
          <section class="section_notice"><h3>알립니다</h3><div class="section_content">처음 방문시에만 예약 가능합니다.<br>검진은 전화로 문의해 주세요.</div></section>
          <div class="calendar">11월 1일 10시 예약 가능</div><footer>네이버 대표자와 회사 주소</footer>'''
        cap=self.parse(body,self.url+'/items/123?tab=book&startDate=2026-11-01')
        self.assertEqual(cap['contentKind'],'service_notice');self.assertEqual(cap['metadata']['itemId'],'123')
        self.assertIn('검진은 전화로',cap['publisherContent']['text'])
        self.assertNotIn('11월 1일 10시 예약 가능',cap['publisherContent']['text']);self.assertNotIn('네이버 대표자',cap['publisherContent']['text'])
        absent=self.parse(body.replace('<section class="section_notice"><h3>알립니다</h3><div class="section_content">처음 방문시에만 예약 가능합니다.<br>검진은 전화로 문의해 주세요.</div></section>',''),self.url+'/items/123?tab=book')
        self.assertEqual(absent['publisherContentStatus'],'not_displayed');self.assertNotIn('publisherContent',absent)

    def test_service_title_excludes_navigator_button_without_changing_content(self):
        body='''<h1 class="BizItemHeader__title__x">시험치과의원</h1>
          <h2 class="info_title"><div class="title">첫 방문</div><button><span>다른 상품 보기</span></button></h2>
          <button role="tab" aria-selected="true" data-click-code="tab.details">상세정보</button>
          <section class="section_detail"><div class="detail_info">원문 다른 상품 보기 유지</div></section>'''
        cap=self.parse(body,self.url+'/items/123?tab=details')
        self.assertEqual(cap['publisherContent']['title'],'첫 방문 · 서비스 상세')
        self.assertIn('원문 다른 상품 보기 유지',cap['publisherContent']['text'])


if __name__=='__main__':unittest.main()

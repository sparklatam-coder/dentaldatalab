import importlib.util
import json
import pathlib
import tempfile
import sys
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('research_loop',pathlib.Path(__file__).resolve().parents[1]/'scripts/clinic-research-loop.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ResearchLoopTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)
        self.work=self.root/'work';self.work.mkdir()
        self.clinics=[{'id':'else','name':'다치과','city':'서울','sido':'서울'}, {'id':'first','name':'가치과','city':'의정부시','sido':'경기'}, {'id':'manual','name':'나치과','city':'의정부시','sido':'경기'}]
        m.atomic(self.root/'data/clinics.json',{'clinics':self.clinics})
        m.atomic(self.root/'data/assets/uijeongbu-web-x.json',{'records':[{'clinicId':'manual'}]})
        self.p=patch.multiple(m,ROOT=self.root,WORK=self.work,STATE=self.work/'state.json',OUTPUT=self.root/'data/assets/national-web-auto.json',LOCK=self.work/'worker.lock',STOP=False,CHILD=None)
        self.p.start()
    def tearDown(self): self.p.stop();self.tmp.cleanup()
    def result(self,c):
        return {'clinicId':c['id'],'status':'researched','summary':'검색 확인','searches':['치과 홈페이지'],'assets':[]}
    def test_priority_and_manual_exclusion(self):
        self.assertEqual([c['id'] for c in m.queue(self.root,{'attempts':{}})],['first','else'])
        self.assertEqual([c['id'] for c in m.queue(self.root,{'attempts':{'first':{}}})],['else'])
    def test_empty_assets_and_candidate_ownership(self):
        c=self.clinics[1];r=self.result(c)
        self.assertEqual(m.convert(r,c,'stamp')['assets'],[])
        r['assets']=[{'kind':'website','url':'https://clinic.example','sourceUrl':'https://clinic.example/about','bodyRead':True,'nameObserved':'가치과','addressObserved':'','phoneObserved':'','notes':'확인 필요'}]
        a=m.convert(r,c,'stamp')['assets'][0]
        self.assertEqual(a['ownership'],'candidate');self.assertEqual(a['bodyStatus'],'read')
        r['assets'][0]['url']='http://127.0.0.1/admin'
        with self.assertRaises(ValueError):m.convert(r,c,'stamp')
    def test_wrong_clinic_rejected(self):
        with self.assertRaises(ValueError):m.convert(self.result(self.clinics[0]),self.clinics[1],'stamp')
    def test_success_checkpoint_then_next_institution(self):
        with patch.object(m,'run_worker',side_effect=lambda c,*a:self.result(c)) as worker,patch('sys.argv',['loop','--once']):
            self.assertEqual(m.main(),0);self.assertEqual(worker.call_args[0][0]['id'],'first')
            self.assertEqual(m.main(),0);self.assertEqual(worker.call_args[0][0]['id'],'else')
        self.assertEqual(len(m.read(m.OUTPUT,{})['records']),2)
        self.assertFalse(m.LOCK.exists())
    def test_failure_is_not_researched_and_not_retried(self):
        with patch.object(m,'run_worker',side_effect=RuntimeError('auth failed')) as worker,patch('sys.argv',['loop','--once']):
            self.assertEqual(m.main(),1);self.assertFalse(m.OUTPUT.exists())
            self.assertEqual(m.read(m.STATE,{})['attempts']['first']['status'],'error')
            self.assertEqual(m.main(),2);self.assertEqual(worker.call_count,1)
        self.assertFalse(m.LOCK.exists())
    def test_worker_subprocess_structured_output(self):
        fake=self.root/'fake-codex'
        fake.write_text('#!'+sys.executable+'\nimport json,sys\nfrom pathlib import Path\nargs=sys.argv\npublic=json.loads(sys.stdin.read().split("PUBLIC INSTITUTION:\\n")[1])\nPath(args[args.index("-o")+1]).write_text(json.dumps({"clinicId":public["id"],"status":"not_found","summary":"No candidate","searches":["public search"],"assets":[]}))\n')
        fake.chmod(0o700)
        result=m.run_worker(self.clinics[1],str(fake),5,'gpt-6.1-sol')
        self.assertEqual(result['clinicId'],'first')
        self.assertEqual(result['assets'],[])
        self.assertTrue((self.work/'first.result.json').exists())
        self.assertIsNotNone(m.CHILD.poll())

    def test_duplicate_lock_refuses_launch(self):
        m.LOCK.write_text('123')
        with patch.object(m,'run_worker') as worker,patch('sys.argv',['loop','--once']):
            self.assertEqual(m.main(),1);worker.assert_not_called()

if __name__=='__main__':unittest.main()

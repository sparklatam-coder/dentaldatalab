import importlib.util
import json
import os
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
        self.assertEqual([c['id'] for c in m.queue(self.root,{'attempts':{'first':{'status':'interrupted'},'else':{'status':'error'}}})],['first'])
    def test_empty_assets_and_candidate_ownership(self):
        c=self.clinics[1];r=self.result(c)
        self.assertEqual(m.convert(r,c,'stamp')['assets'],[])
        r['assets']=[{'kind':'website','url':'https://clinic.example','sourceUrl':'https://clinic.example/about','bodyRead':True,'nameObserved':'가치과','addressObserved':'','phoneObserved':'','notes':'확인 필요'}]
        a=m.convert(r,c,'stamp')['assets'][0]
        self.assertEqual(a['ownership'],'candidate');self.assertEqual(a['bodyStatus'],'read')
        r['assets'][0]['url']='http://127.0.0.1/admin'
        with self.assertRaises(ValueError):m.convert(r,c,'stamp')
    def test_summary_is_record_level_and_bounded(self):
        c=self.clinics[1];r=self.result(c)
        r['searches']=['"가치과" 홈페이지','"가치과" 블로그'];r['summary']='전체 조사 요약\x00\x07 끝'
        record=m.convert(r,c,'stamp')
        self.assertEqual(record['searches'],[{'query':'"가치과" 홈페이지'},{'query':'"가치과" 블로그'}])
        self.assertEqual(record['researchSummary'],'전체 조사 요약 끝')
        r['summary']='가'*(m.MAX_TEXT+50)
        self.assertEqual(len(m.convert(r,c,'stamp')['researchSummary']),m.MAX_TEXT)
        r['assets']=[{'kind':'website','url':'https://clinic.example','sourceUrl':'https://clinic.example/about','bodyRead':True,'nameObserved':'가치과\x1b[31m','addressObserved':'','phoneObserved':'','notes':'나'*(m.MAX_TEXT+1)}]
        a=m.convert(r,c,'stamp')['assets'][0]
        self.assertEqual(a['identityEvidence'][0]['value'],'가치과[31m');self.assertEqual(len(a['notes']),m.MAX_TEXT)
    def test_oversized_worker_output_is_rejected(self):
        c=self.clinics[1]
        r=self.result(c);r['searches']=['q']*(m.MAX_SEARCHES+1)
        with self.assertRaises(ValueError):m.convert(r,c,'stamp')
        r=self.result(c);r['assets']=[{'kind':'website','url':'https://clinic%d.example'%i,'sourceUrl':'https://clinic.example/about','bodyRead':False,'nameObserved':'','addressObserved':'','phoneObserved':'','notes':''} for i in range(m.MAX_ASSETS+1)]
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

    def test_parallel_workers_checkpoint_every_institution(self):
        import threading,time
        seen=[];active=[0];peak=[0];lock=threading.Lock()
        def worker(c,*a):
            with lock: active[0]+=1;peak[0]=max(peak[0],active[0]);seen.append(c['id'])
            time.sleep(0.2)
            with lock: active[0]-=1
            return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','3','--interval','0']):
            self.assertEqual(m.main(),0)
        self.assertEqual(sorted(seen),['else','first']);self.assertEqual(seen[0],'first')
        self.assertEqual(len(m.read(m.OUTPUT,{})['records']),2)
        state=m.read(m.STATE,{});self.assertEqual(state['state'],'complete')
        self.assertEqual({v['status'] for v in state['attempts'].values()},{'researched'})
        self.assertFalse(m.LOCK.exists())
    def test_parallel_single_error_is_recorded_and_loop_continues(self):
        import time
        def worker(c,exe,timeout,model,backend='codex'):
            if c['id']=='first': time.sleep(0.1); raise RuntimeError('bad output')
            return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','2','--interval','0']):
            self.assertEqual(m.main(),0)
        state=m.read(m.STATE,{});self.assertEqual(state['state'],'complete')
        self.assertEqual(state['attempts']['first']['status'],'error');self.assertEqual(state['attempts']['else']['status'],'researched')
        self.assertEqual([r['clinicId'] for r in m.read(m.OUTPUT,{})['records']],['else'])
        self.assertEqual([c['id'] for c in m.queue(self.root,state)],[])
    def test_max_clinics_counts_finished_not_launched(self):
        seen=[]
        def worker(c,exe,timeout,model,backend='codex'):
            seen.append(c['id'])
            if c['id']=='first' and backend=='claude': return dict(self.result(c),status='access_limited',summary='blocked')
            return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','1','--claude','/x','--claude-parallel','1','--max-clinics','1','--interval','0']):
            self.assertEqual(m.main(),0)
        self.assertEqual(len(m.read(m.OUTPUT,{})['records']),1)
    def test_claude_worker_structured_output_from_stream(self):
        fake=self.root/'fake-claude'
        fake.write_text('#!'+sys.executable+'\nimport json,sys\nargs=sys.argv\nassert "-p" in args and "WebSearch,WebFetch" in args and "--json-schema" in args\nschema=json.loads(args[args.index("--json-schema")+1])\nassert schema["required"]\ntext=sys.stdin.read()\nassert "TOOLS AND METHOD (Claude Code)" in text\npublic=json.loads(text.split("PUBLIC INSTITUTION:\\n")[1])\nprint(json.dumps({"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch","input":{"query":"q"}}]}}))\nprint(json.dumps({"type":"result","subtype":"success","is_error":False,"structured_output":{"clinicId":public["id"],"status":"not_found","summary":"없음","searches":["q"],"assets":[]}}))\n')
        fake.chmod(0o700)
        result=m.run_worker(self.clinics[1],str(fake),5,'claude-sonnet-5-5','claude')
        self.assertEqual(result['clinicId'],'first');self.assertEqual(result['status'],'not_found')
        self.assertTrue((self.work/'first.result.json').exists())
        self.assertIn('"tool_use"',(self.work/'first.events.jsonl').read_text())
        fake.write_text('#!'+sys.executable+'\nimport json\nprint(json.dumps({"type":"result","subtype":"error_during_execution","is_error":True,"result":"rate limit"}))\n')
        with self.assertRaises(RuntimeError):m.run_worker(self.clinics[1],str(fake),5,'claude-sonnet-5-5','claude')
    def test_mixed_pools_tag_records_with_worker(self):
        import time
        used=[]
        def worker(c,exe,timeout,model,backend='codex'):
            used.append((c['id'],backend,exe)); time.sleep(0.2); return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','1','--claude','/x/claude','--claude-parallel','1','--interval','0']):
            self.assertEqual(m.main(),0)
        self.assertEqual(sorted(b for _,b,_ in used),['claude','codex'])
        self.assertEqual({e for _,_,e in used},{'codex','/x/claude'})
        records={r['clinicId']:r for r in m.read(m.OUTPUT,{})['records']}
        self.assertEqual({records[k]['worker']['backend'] for k in records},{'codex','claude'})
        self.assertEqual(records['first']['worker']['backend'],'codex')
    def test_access_limited_blocks_only_that_pool_and_requeues(self):
        import time
        calls=[]
        def worker(c,exe,timeout,model,backend='codex'):
            calls.append((c['id'],backend)); time.sleep(0.05)
            if backend=='claude': return dict(self.result(c),status='access_limited',summary='search blocked')
            return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','1','--claude','/x/claude','--claude-parallel','1','--interval','0']):
            self.assertEqual(m.main(),0)
        self.assertEqual(sum(1 for _,b in calls if b=='claude'),1)
        records=m.read(m.OUTPUT,{})['records']
        self.assertEqual(sorted(r['clinicId'] for r in records),['else','first'])
        self.assertTrue(all(r['worker']['backend']=='codex' and r['researchStatus']=='researched' for r in records))
        state=m.read(m.STATE,{});self.assertEqual(state['state'],'complete')
        self.assertEqual({v['status'] for v in state['attempts'].values()},{'researched'})
    def test_all_pools_blocked_exits_blocked(self):
        def worker(c,exe,timeout,model,backend='codex'): return dict(self.result(c),status='access_limited',summary='search blocked')
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','1','--interval','0']):
            self.assertEqual(m.main(),2)
        state=m.read(m.STATE,{});self.assertEqual(state['state'],'blocked');self.assertFalse(m.OUTPUT.exists())
        self.assertEqual([c['id'] for c in m.queue(self.root,state)],['first','else'])
    def test_claude_only_pool(self):
        used=[]
        def worker(c,exe,timeout,model,backend='codex'): used.append(backend); return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','0','--claude','/x/claude','--claude-parallel','2','--interval','0']):
            self.assertEqual(m.main(),0)
        self.assertEqual(used,['claude','claude'])
        with patch('sys.argv',['loop','--parallel','0']),self.assertRaises(SystemExit): m.main()
    def test_parallel_single_failure_continues_until_streak(self):
        import time
        m.atomic(self.root/'data/clinics.json',{'clinics':self.clinics+[{'id':'c%d'%i,'name':'치과%d'%i,'city':'서울','sido':'서울'} for i in range(8)]})
        def worker(c,exe,timeout,model,backend='codex'):
            time.sleep(0.02)
            if c['id'] in ('first','c1'): raise ValueError('unsafe or unsupported evidence URL')
            return self.result(c)
        with patch.object(m,'run_worker',side_effect=worker),patch('sys.argv',['loop','--parallel','2','--interval','0']):
            self.assertEqual(m.main(),0)
        st=m.read(m.STATE,{});self.assertEqual(st['state'],'complete')
        self.assertEqual(st['attempts']['first']['status'],'error');self.assertEqual(st['attempts']['c1']['status'],'error')
        self.assertEqual(len(m.read(m.OUTPUT,{})['records']),8)
        with patch.object(m,'run_worker',side_effect=RuntimeError('auth failed')),patch('sys.argv',['loop','--parallel','3','--interval','0','--resume-after-error']):
            m.atomic(m.STATE,{'schemaVersion':1,'attempts':{},'state':'ready'});(self.root/'data/assets/national-web-auto.json').unlink()
            self.assertEqual(m.main(),1)
        st=m.read(m.STATE,{});self.assertEqual(st['state'],'error')
        self.assertGreaterEqual(sum(1 for v in st['attempts'].values() if v['status']=='error'),m.MAX_FAILURE_STREAK)
    def test_duplicate_lock_refuses_launch(self):
        m.LOCK.write_text('123')
        with patch.object(m,'run_worker') as worker,patch('sys.argv',['loop','--once']):
            self.assertEqual(m.main(),1);worker.assert_not_called()

if __name__=='__main__':unittest.main()

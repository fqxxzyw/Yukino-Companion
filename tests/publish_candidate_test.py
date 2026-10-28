import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('candidate_publisher',Path(__file__).resolve().parents[1]/'scripts/publish-candidate.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class CandidatePublicationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        for folder in ['release','build']:(self.root/folder).mkdir()
        self.env={'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'123','GITHUB_REPOSITORY':'synthetic/fixture'}
        self.exe=self.root/'release/Yukino-Companion-0.4.0-Base-Setup.exe';self.exe.write_bytes(b'synthetic fixture, not an executable')
        self.source={'commit':'a'*40,'runId':'123','installer':self.exe.name,'bytes':self.exe.stat().st_size,'sha256':module.sha(self.exe),'signatureStatus':'NotSigned','nativeInstallLaunchUpgradeUninstall':False,'completeFeatureAcceptance':False}
        for name in ['release/base-installer.json','build/base-package.json','build/base-payload.json']:(self.root/name).write_text('{}')
        (self.root/'release/SHA256SUMS.txt').write_text(module.sha(self.exe)+'  '+self.exe.name+'\n')
        self.write_source();self.calls=[];self.scenario='ok';self.promoted=False
    def write_source(self):
        (self.root/'release/candidate-source.json').write_text(json.dumps(self.source))
    def gh(self,*args):
        self.calls.append(args)
        if args[:2]==('release','create'):
            if self.scenario=='create-failure':raise RuntimeError('existing tag or failed creation')
            self.assertIn('--draft',args);self.assertIn('--prerelease',args);self.assertIn('a'*40,args)
            return ''
        if args[:3]==('api','--method','PATCH'):
            self.promoted=True;self.assertIn('make_latest=false',args);self.assertIn('draft=false',args);return '{}'
        if args[0]=='api' and args[1].endswith('releases?per_page=100'):
            return json.dumps([{'id':77,'tag_name':'v0.4.0-test.123'}])
        self.assertEqual(args,('api','repos/synthetic/fixture/releases/77'))
        assets=[{'name':p.name,'size':p.stat().st_size,'digest':'sha256:'+module.sha(p)} for p in [*sorted((self.root/'release').iterdir()),self.root/'build/base-package.json',self.root/'build/base-payload.json']]
        if self.scenario=='digest-mismatch':assets[0]['digest']='sha256:'+'0'*64
        if self.scenario=='extra-asset':assets.append({'name':'unexpected','size':1,'digest':'none'})
        return json.dumps({'draft':not self.promoted and self.scenario!='not-draft','prerelease':True,'target_commitish':'b'*40 if self.scenario=='wrong-commit' else 'a'*40,'assets':assets,'html_url':'https://example.invalid/prerelease'})
    def test_exact_candidate_published_as_prerelease_with_pending_validation(self):
        result=module.publish(self.root,self.env,self.gh);self.assertTrue(self.promoted);self.assertEqual(result['validation'],'pending')
        self.assertIn('尚未完成',(self.root/'build/candidate-release-notes.md').read_text(encoding='utf8'))
        self.assertFalse(any('--clobber' in c or 'delete' in c for c in self.calls))
    def test_bad_remote_bytes_or_identity_never_promoted(self):
        for scenario in ['digest-mismatch','extra-asset','not-draft','wrong-commit','create-failure']:
            with self.subTest(scenario=scenario):
                self.scenario=scenario;self.calls=[];self.promoted=False
                with self.assertRaises((ValueError,RuntimeError)):module.publish(self.root,self.env,self.gh)
                self.assertFalse(self.promoted)
    def test_wrong_source_run_and_false_acceptance_claims_rejected_before_remote_write(self):
        for key,value in [('commit','b'*40),('runId','456'),('nativeInstallLaunchUpgradeUninstall',True),('completeFeatureAcceptance',True)]:
            original=self.source[key];self.source[key]=value;self.write_source()
            with self.assertRaises(ValueError):module.publish(self.root,self.env,self.gh)
            self.assertEqual(self.calls,[]);self.source[key]=original
        self.write_source()
    def test_changed_installer_rejected_before_remote_write(self):
        self.exe.write_bytes(b'changed bytes')
        with self.assertRaises(ValueError):module.publish(self.root,self.env,self.gh)
        self.assertEqual(self.calls,[])

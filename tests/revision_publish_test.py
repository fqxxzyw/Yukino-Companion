import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publish_revision',ROOT/'scripts/publish-revision.py')
publication=importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class RevisionPublicationTest(unittest.TestCase):
    def test_only_same_commit_branch_push_check_can_approve(self):
        commit='a'*40
        base={'id':1,'head_sha':commit,'head_branch':publication.BRANCH,'event':'push','created_at':'2026-01-01','status':'completed','conclusion':'success'}
        self.assertEqual(publication.check_runs({'workflow_runs':[base]},commit)['conclusion'],'success')
        for change in ({'head_sha':'b'*40},{'head_branch':'main'},{'event':'pull_request'}):
            self.assertIsNone(publication.check_runs({'workflow_runs':[base|change]},commit))
        newer=base|{'id':2,'created_at':'2026-01-02','conclusion':'failure'}
        self.assertEqual(publication.check_runs({'workflow_runs':[base,newer]},commit)['conclusion'],'failure')

    def test_release_requires_exact_installer_seven_outfits_and_passed_native_smoke(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for folder in ['release','build/native-smoke-evidence']:(root/folder).mkdir(parents=True,exist_ok=True)
            exe=root/'release'/publication.INSTALLER;exe.write_bytes(b'synthetic installer')
            sha=hashlib.sha256(exe.read_bytes()).hexdigest()
            source={'commit':'a'*40,'tree':'b'*40,'runId':'123','installer':exe.name,'bytes':exe.stat().st_size,'sha256':sha,'completeFeatureAcceptance':False,'nativeInstallLaunchUpgradeUninstall':False}
            def write(path,obj):(root/path).write_text(json.dumps(obj),encoding='utf8')
            write('release/candidate-source.json',source)
            write('release/base-installer.json',{})
            write('build/base-payload.json',{})
            write('build/base-package.json',{'characterModelsEmbedded':True,'characterVariants':17,'characterOutfits':7})
            write('build/native-smoke-evidence/report.json',{'passed':True,'fixtureOnly':False})
            (root/'release/SHA256SUMS.txt').write_text(f'{sha}  {exe.name}\n',encoding='utf8')
            _,paths=publication.validate_inputs(root,'a'*40,'b'*40,'123')
            self.assertEqual(len(paths),6)
            with self.assertRaisesRegex(ValueError,'source/tree/run'):publication.validate_inputs(root,'a'*40,'c'*40,'123')
            write('build/native-smoke-evidence/report.json',{'passed':False,'fixtureOnly':False})
            with self.assertRaisesRegex(ValueError,'native installer'):publication.validate_inputs(root,'a'*40,'b'*40,'123')
            write('build/native-smoke-evidence/report.json',{'passed':True,'fixtureOnly':False})
            exe.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'installer bytes'):publication.validate_inputs(root,'a'*40,'b'*40,'123')

    def test_workflow_is_restricted_and_depends_on_native_smoke(self):
        caller=(ROOT/'.github/workflows/windows-revision-candidate.yml').read_text(encoding='utf8')
        workflow=(ROOT/'.github/workflows/windows-revision-publish.yml').read_text(encoding='utf8')
        self.assertIn('needs: [candidate, native_smoke]',caller)
        self.assertIn("github.ref == 'refs/heads/"+publication.BRANCH+"'",caller)
        self.assertIn('workflow_call:',workflow)
        self.assertIn('contents: write',workflow)
        self.assertNotIn('release/**/*',workflow)


if __name__=='__main__':
    unittest.main()

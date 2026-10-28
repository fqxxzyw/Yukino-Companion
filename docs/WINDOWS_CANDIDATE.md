# Windows installer candidate

The handoff branch builds a real `Yukino-Companion-0.4.0-Base-Setup.exe`
with Inno Setup 6.7.3 on a disposable Windows 2022 GitHub runner.
Seven character outfits (17 catalogued visual variants) are embedded and checked
against their pinned hashes. Language/translation/voice weights, prerecorded pet
voices and Python runtimes remain application-managed downloads.

The candidate workflow has read-only repository permissions. It does not create
Releases, publish mirrors, delete branches, or restore the private full workflow.
It uploads the installer only after installation into a Chinese path, actual
installed-app startup, upgrade, rejection of an unknown nonempty directory,
uninstallation and preservation of personal files pass. Every application payload
file is compared to the build manifest after installation and upgrade.
Screenshots and failure reports are retained separately, even when validation fails.

`candidate-source.json` records the actual source commit/tree, run, ASAR hash,
installer bytes/hash and Authenticode status. Hashes do not establish signing,
malware scanning, physical-GPU performance or complete feature acceptance.

## Tests

- `npm test`: public source regressions and the complete common publication
  contract against the base workflow that exists in the public tree.
- `npm run test:release`: the same common assertions against both workflows plus
  all full-workflow assertions. Set `YUKINO_PRIVATE_WINDOWS_WORKFLOW` to the
  approved external YAML first. Missing input is an error, not a skipped test.
  This command validates automation with synthetic fixtures; it never dispatches
  a workflow or publishes a Release. Keep the input outside the repository.

The former mixed suite is split into a shared contract and a mandatory-input
full-automation suite. Assertions concerning CUDA, transfer deletion, full
component inference and the full installer remain in that explicit suite.

Local Linux validation during implementation: 701 public Node tests, 21 explicit
release-automation tests using the supplied private input, and two additional
candidate-workflow contract tests passed. This is not a Windows acceptance claim.
Native CI results and installer evidence must be checked for each exact commit.

## Deliberately pending

The separate 108-action update is not included. Physical audio/GPU, multi-monitor,
long-running desktop pet behavior, actual user inference resources, the complete
live dialogue → translation → voice → motion chain, and visual quality remain
separate acceptance work. An installer candidate is not a claim that these passed.

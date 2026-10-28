# Windows installer test release

The handoff branch builds a real `Yukino-Companion-0.4.0-Base-Setup.exe`
using pinned, signature-checked Inno Setup 6.7.3 on Windows 2022.
Seven outfits and 17 visual variants are embedded and checked against their
original hashes. Outfit 01 retains its existing held/unselectable state.
Inference weights, voices and runtimes remain opt-in application downloads.

At the user's explicit request, the order is **build → test prerelease → native
validation**. The release prominently identifies installation and feature
acceptance as pending. Only the separate prerelease job has repository write
permission, restricted to the handoff branch. It creates a unique draft, verifies
every uploaded asset's size and SHA-256, and exposes it as a non-latest prerelease.
It cannot replace assets, remove releases, mirror resources or delete branches.
Existing publication workflows and their stricter gates remain unchanged.

`candidate-source.json` binds the source commit/tree, run, ASAR hash, installer
bytes/hash and signature status. Following publication, a fresh disposable
Windows runner installs in a Chinese path, launches the actual installed app,
upgrades, rejects an unknown nonempty directory, and uninstalls while preserving
personal files. All payload bytes are checked after installation and upgrade.
Screenshots and failure evidence are retained independently of the release.

## Test scopes

`npm test` includes public source tests and the common publication contract for
the public base workflow. `npm run test:release` additionally requires the approved
external `YUKINO_PRIVATE_WINDOWS_WORKFLOW` YAML. Missing input fails explicitly.
The shared and full-only suites preserve the original CUDA, transfer cleanup,
publication, native-gate and component-inference assertions; the private workflow
is not restored or executed.

## Corrections found by native builds

- Windows CRLF conversion changed pinned JSON/module bytes. `.gitattributes`
  now preserves LF; original hashes and model bytes remain unchanged.
- Python compile checks decode supplied script bytes explicitly as UTF-8.
- ASAR extraction now uses native path separators when checking bundled models.
  A real nested ASAR fixture verifies successful reads and rejection of tampering.

## Pending acceptance

The separate 108-action update is excluded. Physical audio/GPU, multiple monitors,
long-term desktop-pet use, actual downloaded inference resources, complete live
conversation → translation → voice → motion, and visual quality remain pending.
Hashes do not establish code signing, malware scanning or feature acceptance.

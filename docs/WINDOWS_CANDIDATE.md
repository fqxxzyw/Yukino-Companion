# Windows installer test release

The handoff branch builds a real `Yukino-Companion-0.4.0-Base-Setup.exe`
using pinned, signature-checked Inno Setup 6.7.3 on Windows 2022.
Seven outfits and 17 visual variants are embedded and checked against their
original hashes. Outfit 01 retains its existing held/unselectable state.
Inference weights, voices and runtimes remain opt-in application downloads.

At the user's explicit request, the order is **build → test prerelease → native
validation**. The release prominently identifies installation and feature
acceptance as pending. The separate prerelease job and a narrowly scoped job marking an earlier
defective test release have repository write permission only on the handoff branch. It creates a unique draft, verifies
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

- The first published candidate exposed a real ASAR inode mismatch on startup.
  Packaged built-ins now permit virtual inode differences but retain size and
  SHA-256 checks; user-imported files continue to use strict file identity.
  Installed-app validation now checks actual IPC model loading and a rendered
  frame, and preserves an additional screenshot after dismissing setup.

The 8dee5c9 installer was published and its installed renderer reported the
expected default model and a completed frame. The first verification process then
hung while closing its debugging connection; that run was cancelled. A read-only
revalidation workflow binds to the already published run, commit, size and
SHA-256, and reruns installation, rendered-model, upgrade and uninstall checks
with a corrected short-lived verifier. It never creates a second Release.

## Published candidate revalidation result

On 2026-10-29, the Windows revalidation run `40853118595` succeeded against
`v0.4.0-test.40851833722`. Installer SHA-256:
`1172190ce36032f85491db8966a2f336ffe03ef46d677f6b41cef15f8c0911fd`.
The installer source was `8dee5c95512df806753d65a588f865d58a6ad711`;
the revalidation scripts used `974894a569a91076207c3a9db38a0458c8f42d0d`.

The disposable Windows 2022 worker installed to a Chinese path, launched the
installed app, loaded and rendered the default `yukino-07-v1` model, checked
101 installed payload files after installation and upgrade, rejected an unknown
nonempty target, and confirmed uninstall preserved a personal file. The official
aria2 binary also completed a small HTTPS download and hash check. Node 706,
Python 65, and community 19 public tests passed. The screenshot was inspected.
Other character visuals, actual inference, audio devices, physical GPU and full
resource downloads remain unverified. The installer is unsigned and has not had
an independent malware scan.

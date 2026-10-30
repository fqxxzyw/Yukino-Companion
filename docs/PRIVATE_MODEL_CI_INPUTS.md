# Private model inputs for public-source CI

Public source trees exclude standalone character model files. CI recovers the
17 bundled variants from the previously published, user-authorized installer,
after verifying its fixed byte length and SHA-256. Each model must also match
the current catalog's pinned length and SHA-256 before it becomes a build input.
The installer, extracted files and build inputs are not uploaded as standalone
model artifacts. The new compiled installer may contain the models.

On Linux, the Ubuntu 1.9 innoextract package cannot read the Inno Setup 6.7.3
installer. CI builds the unmerged compatibility work at
[dscharrer/innoextract#210](https://github.com/dscharrer/innoextract/pull/210),
using the exact Git commit `376a13e7c41cc5528b6088d0dd16ec1b323a8d37`. The
commit adds parsing for newer loader structures, setup metadata and blocks;
the upstream author reports compatibility through Inno Setup 7.0.2. It is an
independent extractor, not an official release of innoextract. It uses the
[zlib license](https://github.com/dscho/innoextract/blob/376a13e7c41cc5528b6088d0dd16ec1b323a8d37/LICENSE).
The extractor and temporary unpacked contents are used only on the ephemeral
runner. A real CI run against our installer is required to establish that this
particular combination works; a source review or compilation alone is not a
successful extraction test.

The separate six blink-review runtime checks and one launcher check need an
unapproved review-only model that was not distributed in the installer. They
are explicitly skipped when that asset is absent; all other tests still run.

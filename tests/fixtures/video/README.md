# Synthetic video fixtures (CC0-1.0)

These two original geometric blobs are QA data, not Yukino or dsh-pet artwork.
They are dedicated to the public domain under CC0-1.0.

Regenerate using already-installed Pillow and FFmpeg (no downloads):

```sh
python tests/fixtures/video/generate-video-fixtures.py
```

Each WebM has 128×128 VP9 + alpha, 24 fps, 48 frames, 2 seconds, no audio.
Transparent probe: `(0, 0)`; opaque probe: `(64, 76)` in all frames.
48 decoded frames contain 47 distinct RGBA frame hashes.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| blue.webm | 5341 | 458971713029d5a84413da8029b95eab7440957aa428f54626f80af67be42bd5 |
| pink.webm | 5231 | 398ff5469449939f1a060ec7093d35b6b45f46da106acef190df71c5720245f3 |

Different FFmpeg versions may produce different encoded bytes. If regenerated,
update the capture fixture manifest's `bytes` fields and this table. Decoding with
FFmpeg must explicitly select `-c:v libvpx-vp9` to retain the alpha channel.
The desktop QA harness is not run by ordinary Node tests and was not graphically
executed in the restricted implementation container.

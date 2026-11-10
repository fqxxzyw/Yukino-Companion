# Bundled architectural photographs

These eight WebP maps are derived from Poly Haven 1K JPG maps. Architectural
maps were reduced to 768 × 768 pixels with Pillow and encoded as WebP, quality
86. Grass maps retain 1024 × 1024 pixels, quality 88. There are no runtime
requests to Poly Haven.

| Prefix | Original asset | Included channels |
| --- | --- | --- |
| `concrete_wall_006` | https://polyhaven.com/a/concrete_wall_006 | Diffuse, Rough |
| `wood_planks_dirt` | https://polyhaven.com/a/wood_planks_dirt | Diffuse, Rough |
| `mossy_rock` | https://polyhaven.com/a/mossy_rock | Diffuse, Rough |
| `leafy_grass` | https://polyhaven.com/a/leafy_grass | Diffuse, Rough |

All four source assets are CC0: https://polyhaven.com/license and
https://creativecommons.org/publicdomain/zero/1.0/ .
Source manifests: `https://api.polyhaven.com/files/<asset_id>`.

Albedo is read as sRGB colour; roughness is scalar linear data. World-space
projection controls physical texture scale independently of bridge and temple
mesh UVs. Wood luminance modulates the authored vermilion coating so the shrine
does not become a raw brown plank wall. These are photographic surface samples,
not photographs or scans of the actual named bridge or shrine.

The grass photograph is by Charlotte Baglioni. It is projected at its source
two-metre width, blended with authored ground and root fibres; raised creek-bank
height masks preserve the stony wet margin. Thin curved grass blades remain
separate geometry. It also refines the bridge verges and campus/coastal lawns.

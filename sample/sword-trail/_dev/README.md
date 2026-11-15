# Sword Trail — Actions & Stuff 1.13 patch

The resource pack is the parent `sword-trail` directory.
`SwordTrail-AS-1.13.mcpack` is an importable copy without this development
directory. Enable Actions & Stuff 1.13 and put this patch above it. This patch
requires the original A&S pack. No behavior pack is needed.

Hold a wooden, stone, copper, iron, golden, diamond, or netherite sword in the
main hand and swing. Both views keep the original A&S sword and player
animations, placement, material options, and renderers. Both sample markers on the
sword itself and show a short, pale blue trail. Merely holding a sword does not
create a trail. The attack query also covers swings at blocks.

For the initial game test, enable only A&S and this patch. Turn off A&S's
**3D Tools** option to use its vanilla texture-mesh swords. The patch respects
the original setting; it does not force a model or replace sword rendering.
Check first person, third person, rapid consecutive swings, turning while
swinging, enchanted swords, and changing the held item or perspective.

## Local assets and references

- Original A&S 1.13 sword attachables: preserved in full, with only additional
  trail aliases, initialization, sampling, one render controller, and a reference
  to the augmented query geometry.
- A&S 1.13 `geometry.oreville_ans.mqnsmu`: binding skeleton for the ribbon.
- A&S 1.13 `geometry.oreville_ans.kglzcj`: the original `queryable_geometry`.
  Its original bones, meshes, and settings are preserved, with two invisible
  sampling bones added. Bone queries read this one selected geometry, not the
  union of every rendered geometry. The original glint renderer uses this
  augmented copy through its existing alias; no extra sword is rendered.
- A&S sword placement and combo animations: referenced from A&S, not copied or
  simplified in this patch.
- A&S 1.13 `zxyjrj`: alternating-controller bone query lifecycle.
- A&S 1.13 `textures/oreville/ans/dgz.png` and `oreville_auulis`: referenced
  directly for translucent, emissive triangular trail geometry.
- ClothPhysics: three-bone affine plane fitting and actor/model coordinate
  conversion. The trail has no cloth solver or terrain collision.

The manifest dependency uses the supplied A&S 1.13 pack's actual internal UUID
and version (`1.1.68`). Patch version `0.0.3` fixes the missing-bone errors in
`0.0.2`. It contains no A&S player definition, texture or material overrides.

## Rebuild and verify

From the ClothPhysics directory:

```powershell
node sword-trail/_dev/build.mjs
node sword-trail/_dev/check.mjs
python sword-trail/_dev/package.py
```

The checks execute the saved Molang using a restricted offline interpreter and
validate geometry math, frame scheduling, reference closure, lifecycle
guards, the selected query geometry, and preservation of original A&S behavior. They cannot
validate Bedrock's actual attachable transform evaluation,
render-pass ordering, or graphics pipelines. The JavaScript timing printed by
the checker is not an in-game performance measurement.

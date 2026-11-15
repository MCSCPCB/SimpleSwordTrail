from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
target = root / "SwordTrail-AS-1.13.mcpack"
allowed_dirs = {"animations", "animation_controllers", "attachables", "materials", "models", "render_controllers", "textures"}
files = sorted(p for p in root.rglob("*") if p.is_file() and (p.relative_to(root).parts[0] in allowed_dirs or p.name in {"manifest.json", "pack_icon.png"}))
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as pack:
    for source in files:
        pack.write(source, source.relative_to(root).as_posix())
with zipfile.ZipFile(target) as pack:
    assert pack.testzip() is None
    assert "manifest.json" in pack.namelist()
    assert not any(name.startswith("_dev/") for name in pack.namelist())
    for name in pack.namelist():
        if name.endswith((".json", ".material")):
            json.loads(pack.read(name))
print(json.dumps({"file": str(target), "files": len(files), "resource_bytes": sum(p.stat().st_size for p in files), "mcpack_bytes": target.stat().st_size}, ensure_ascii=False, indent=2))

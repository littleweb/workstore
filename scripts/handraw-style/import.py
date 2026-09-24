"""Vendor the complete, installed handraw-style package's indexed resources.
Usage: python3 scripts/handraw-style/import.py /path/to/handraw-style
No network, credential, or user content is copied.
"""
import hashlib, json, shutil, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1]).resolve()
ref = source / 'skills/handdraw-style-prompter/references'
public = root / 'public/handraw-style'
public.mkdir(parents=True, exist_ok=True)
manifest = {}
def copy(relative, destination):
    src = source / relative
    target = root / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)
    manifest[str(destination)] = {'source': str(relative), 'sha256': hashlib.sha256(src.read_bytes()).hexdigest()}
styles = json.loads((ref / 'styles.json').read_text())
for style in styles:
    n = int(style['number']); bucket = f'{(n-1)//200*200+1:03}-{((n-1)//200+1)*200:03}'
    image = Path('images/individual') / bucket / (style['number'] + '_grid.webp')
    if not (source / image).exists(): image = image.with_name(style['number'] + '.webp')
    target = Path('public/handraw-style/styles') / (style['number'] + '.webp')
    copy(image, target)
    style['image'] = '/' + str(target.relative_to('public'))
layouts = json.loads((ref / 'layouts.json').read_text())
for layout in layouts:
    image = (source/'skills/handdraw-style-prompter/gallery'/layout['image']).resolve().relative_to(source)
    target = Path('public/handraw-style/layouts') / (layout['id'] + '.webp')
    copy(image, target)
    layout['image'] = '/' + str(target.relative_to('public'))
    layout['prompt'] = (ref/layout['prompt_file']).read_text()
colors = json.loads((ref/'colors.json').read_text())
for color in colors:
    image = (source/'skills/handdraw-style-prompter/gallery'/color['image']).resolve().relative_to(source)
    target = Path('public/handraw-style/colors') / (color['id'] + '.webp')
    copy(image, target)
    color['image'] = '/' + str(target.relative_to('public'))
for filename in ['LICENSE','SKILL.md','version.json','styles_200_reorganized.md','skills/handdraw-style-prompter/SKILL.md','skills/poster-prompt-generator/SKILL.md','skills/handdraw-style-prompter/references/styles.json','skills/handdraw-style-prompter/references/layouts.json','skills/handdraw-style-prompter/references/colors.json']:
    copy(Path(filename), Path('third-party/handraw-style') / filename)
copy(Path('skills/handdraw-style-prompter/references/model_capabilities.json'), Path('src/covers/capabilities.json'))
catalog = {'version': json.loads((source/'version.json').read_text())['version'], 'styles':styles,'layouts':layouts,'colors':colors}
(root/'src/covers/catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
(root/'third-party/handraw-style/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(root/'src/covers/attribution.json').write_text(json.dumps({'source':'https://github.com/yang0/handraw-style','version':catalog['version'],'license':(source/'LICENSE').read_text()},ensure_ascii=False,indent=2)+'\n')
print(f"Imported {len(styles)} styles, {len(layouts)} layouts, {len(colors)} colors")

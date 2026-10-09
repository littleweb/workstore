"""Verify every built-in tutorial and preserve a compact delivery audit."""
import hashlib
import json
import subprocess
import re
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
examples = json.loads((root / 'src/course-whiteboard/examples.json').read_text())
assert len(examples) == 10
assert len(set(e['config']['style'] for e in examples)) == 10
assert sorted(e['config']['duration'] for e in examples) == [30,30,60,60,120,120,180,180,300,300]
proof = root / 'docs/course-whiteboard-proof'
proof.mkdir(exist_ok=True)
sheet = Image.new('RGB', (960, len(examples)*204), '#f5ebd7')
draw = ImageDraw.Draw(sheet)
records = []
cover_sheet = Image.new('RGB', (1000, 5*524), 'white')
cover_draw = ImageDraw.Draw(cover_sheet)
for row, example in enumerate(examples):
    folder = root / 'public/course/whiteboard' / example['id']
    video = folder / 'tutorial.mp4'
    plan = json.loads((folder / 'tutorial.json').read_text())
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
    visual = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    duration = example['config']['duration']
    style = json.loads((folder / 'style.json').read_text())
    assert style['style'] == example['config']['style'] == plan['referenceStyle']
    cover = folder / 'square-cover.png'
    assert cover.read_bytes() != (folder / '01.png').read_bytes()
    assert (folder / 'square-cover-prompt.md').is_file()
    cover_image = Image.open(cover)
    assert cover_image.width == cover_image.height and cover_image.width >= 1024
    assert style['ratio'] == '1:1' and style['cover'] == example['cover']
    cover_sheet.paste(cover_image.convert('RGB').resize((500, 500)), ((row%2)*500, (row//2)*524+24))
    cover_draw.text(((row%2)*500+8,(row//2)*524+5), example['config']['style']+' | '+example['id'], fill='#343434')
    assert abs(float(probe['format']['duration'])-duration) < .1
    assert (visual['codec_name'],visual['width'],visual['height'],visual['r_frame_rate'],int(visual['nb_frames'])) == ('h264',1280,720,'24/1',duration*24)
    assert audio['codec_name'] == 'aac'
    volume = subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True)
    mean_db = float(re.search(r'mean_volume: ([-.0-9]+) dB',volume.stderr)[1])
    assert mean_db > -40
    srt_scenes = json.loads((folder / 'parsed-srt.json').read_text())['scenes']
    assert len(srt_scenes) == duration//30
    assert all(s['sceneDurationMs'] == 30000 for s in srt_scenes)
    assert len(plan['scenes']) == duration//30
    for scene in plan['scenes']:
        assert scene['audioVoice'] == 'kokoro-zh-zf_021-s0.93-v1'
        assert all(not re.search(r'[，。！？；,.!?;]$',c['text']) for c in scene['captions'])
        assert scene['annotation']['sceneDurationMs'] == 30000
        assert len(scene['annotation']['elements']) == 4
    frames = []
    for column, second in enumerate([1,duration/2+(14 if duration>=60 else 0),duration-.75]):
        output = Path('/tmp') / f"whiteboard-{example['id']}-{column}.png"
        subprocess.run(['ffmpeg','-v','error','-y','-ss',str(second),'-i',str(video),'-frames:v','1',str(output)],check=True)
        frame = Image.open(output).convert('RGB').resize((320,180))
        sheet.paste(frame,(column*320,row*204+24))
        frames.append(second)
    draw.text((8,row*204+5), f"{example['id']} | {duration}s | {len(plan['scenes'])} scenes", fill='#343434')
    records.append({'id':example['id'],'title':example['title'],'style':example['config']['style'],'coverSize':list(cover_image.size),'coverRatio':'1:1','coverSha256':hashlib.sha256(cover.read_bytes()).hexdigest(),'seconds':duration,'scenes':len(plan['scenes']),'frames':int(visual['nb_frames']),'videoCodec':'h264','audioCodec':'aac','size':[1280,720],'fps':24,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'reviewedFramesSeconds':frames,'meanAudioDb':mean_db,'srtSceneDurationsMs':[s['sceneDurationMs'] for s in srt_scenes]})
sheet.save(proof / 'reference-contact-sheet.jpg',quality=90)
cover_sheet.save(proof / 'style-cover-contact-sheet.jpg',quality=90)
(root / 'docs/course-whiteboard-reference-videos.json').write_text(json.dumps({'method':'ffprobe metadata, original annotation/SRT and first/middle/end rendered frames','skillCommit':'696a7243c0e6ffb6827676e539c2ca5ebae2bf6b','totalSeconds':sum(r['seconds'] for r in records),'totalScenes':sum(r['scenes'] for r in records),'videos':records},ensure_ascii=False,indent=2)+'\n')
print('Verified 10 H.264/AAC tutorials, 46 scenes and 1380 seconds.')

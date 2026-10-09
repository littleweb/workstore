import hashlib
import json
from pathlib import Path
import re
import subprocess
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[2]
refs=json.loads((root/'src/course-animation/examples.json').read_text())
assert len(refs)==10
sheet=Image.new('RGB',(960,len(refs)*204),'#f7f8f4')
draw=ImageDraw.Draw(sheet)
records=[]
for row,ref in enumerate(refs):
    folder=root/'public/course/animations'/ref['id']
    video=folder/'tutorial.mp4'
    plan=json.loads((folder/'tutorial.json').read_text())
    seconds=ref['config']['duration']
    assert sum(s['seconds'] for s in plan['scenes'])==seconds
    for scene in plan['scenes']:
        assert scene['audioVoice']=='kokoro-zh-zf_021-s0.93-v1'
        assert all(not re.search(r'[，。！？；,.!?;]$',c['text']) for c in scene['captions'])
        assert all(0<=c['startMs']<c['endMs']<=scene['seconds']*1000 for c in scene['captions'])
    data=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
    v=next(s for s in data['streams'] if s['codec_type']=='video')
    a=next(s for s in data['streams'] if s['codec_type']=='audio')
    assert (v['codec_name'],v['width'],v['height'],v['r_frame_rate'],int(v['nb_frames']))==('h264',1280,720,'24/1',seconds*24)
    assert a['codec_name']=='aac' and abs(float(data['format']['duration'])-seconds)<.1
    output=subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True)
    db=float(re.search(r'mean_volume: ([-.0-9]+) dB',output.stderr)[1])
    assert db>-40
    for column,time in enumerate([2,seconds/2+1,seconds-1]):
        target=Path('/tmp')/f"course-natural-{ref['id']}-{column}.png"
        subprocess.run(['ffmpeg','-v','error','-y','-ss',str(time),'-i',str(video),'-frames:v','1',str(target)],check=True)
        sheet.paste(Image.open(target).convert('RGB').resize((320,180)),(column*320,row*204+24))
    draw.text((8,row*204+5),f"{ref['id']} | {seconds}s | natural neural voice",fill='#333333')
    records.append({'id':ref['id'],'path':f"public/course/animations/{ref['id']}/tutorial.mp4",'duration':data['format']['duration'],'frames':v['nb_frames'],'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'audio':'aac','scenes':len(plan['scenes']),'meanAudioDb':db,'voice':'kokoro-zh-zf_021-s0.93-v1','sceneSeconds':[s['seconds'] for s in plan['scenes']]})
sheet.save(root/'docs/course-animation-proof/natural-voice-references.jpg',quality=90)
audit={'engine':'Remotion 4.0.534','skillCommit':'32b241b97f4e0e4ab61fe9a41b05e6e64503f8c5','speech':json.loads((root/'vendor/course-tts/UPSTREAM.json').read_text()),'videos':records}
(root/'docs/course-animation-reference-videos.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
print('Verified all ten naturally narrated tutorials, video frames, captions and audio.')

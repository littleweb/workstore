"""Shared local neural TTS. Model files are verified and bundled at build time."""
import json
import logging
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
PROFILE = 'kokoro-zh-gentle-v1'

def synthesize(job):
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from misaki import zh
    logging.basicConfig(level=logging.ERROR)
    logging.getLogger('jieba').setLevel(logging.ERROR)
    engine = Kokoro(str(ROOT / 'kokoro-v1.1-zh.int8.onnx'),
                    str(ROOT / 'voices-v1.1-zh.bin'), vocab_config=str(ROOT / 'config.json'))
    # Keep mixed Chinese/English terms; never silently omit their pronunciation.
    g2p = zh.ZHG2P(version='1.1', en_callable=lambda text: engine.tokenizer.phonemize(text, 'en-us'))
    inputs = json.loads((job / 'speech-input.json').read_text())
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 40:
        raise ValueError('Invalid speech batch')
    settings_path = job / 'speech-settings.json'
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    voice = settings.get('value', 'zf_007')
    voices = ['zf_007','zf_001','zf_002','zf_003','zf_004','zf_008','zf_017','zf_018','zf_019','zf_021','zf_022','zf_023']
    if voice not in voices:
        raise ValueError('Invalid speech voice')
    speed = .93 if voices.index(voice) >= 6 else 1.0
    profile = PROFILE if voice == 'zf_007' else f'kokoro-zh-{voice}-s{speed:g}-v1'
    result = []
    for index, text in enumerate(inputs):
        if not isinstance(text, str) or not text.strip() or len(text) > 600:
            raise ValueError('Invalid speech text')
        phonemes, _ = g2p(text)
        if not phonemes:
            raise ValueError('Speech text could not be pronounced')
        samples, rate = engine.create(phonemes, voice=voice, speed=speed, is_phonemes=True)
        if len(samples) < rate*.1 or not np.isfinite(samples).all():
            raise ValueError('Neural speech output is invalid')
        sf.write(job / f'{index+1:02}-raw.wav', samples, rate, subtype='PCM_16')
        result.append({'profile':profile,'seconds':len(samples)/rate,'sampleRate':rate})
        print(json.dumps({'progress':(index+1)/len(inputs),'stage':f'正在生成自然柔和讲解 {index+1}/{len(inputs)}'},ensure_ascii=False),flush=True)
    (job / 'speech-result.json').write_text(json.dumps(result))

if __name__ == '__main__':
    synthesize(Path(sys.argv[1]))

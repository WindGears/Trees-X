"""Publish only a complete, hash-verified real frame sequence. Never synthesize motion."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
sys.path.insert(0, str(OUT / 'tooling'))
import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
film = json.loads((OUT / 'vpb-film.json').read_text(encoding='utf-8'))
folder = OUT / ('film-preview-' + film['blendSha256'][:12])
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['status'] == 'complete'
assert manifest['settings']['blendSha256'] == film['blendSha256']
assert manifest['settings']['mode'] == 'preview'
assert set(manifest['frames']) == {str(i) for i in range(1, 385)}
for number in range(1, 385):
    entry = manifest['frames'][str(number)]
    source = folder / entry['file']
    assert source.name == f'frame-{number:04d}.png'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == entry['sha256']
    with Image.open(source) as pixels:
        assert pixels.size == (1920, 850)

temporary = folder / 'preview-encoding.mp4'
command = [ffmpeg, '-hide_banner', '-y', '-framerate', '24', '-start_number', '1',
           '-i', str(folder / 'frame-%04d.png'), '-frames:v', '384', '-an',
           '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
           '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
           '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709',
           '-color_trc', 'iec61966-2-1', '-movflags', '+faststart', str(temporary)]
encoded = subprocess.run(command, capture_output=True, text=True)
(folder / 'encode.log').write_text(encoded.stderr, encoding='utf-8')
encoded.check_returncode()
decoded = subprocess.run([ffmpeg, '-hide_banner', '-i', str(temporary), '-map', '0:v:0',
                          '-f', 'framemd5', '-'], capture_output=True, text=True, check=True)
rows = [line for line in decoded.stdout.splitlines() if line and not line.startswith('#')]
assert len(rows) == 384, len(rows)
assert len({line.rsplit(',', 1)[1].strip() for line in rows}) > 360
assert re.search(r'Duration: 00:00:16\.00', decoded.stderr), decoded.stderr[:1200]
assert '1920x850' in decoded.stderr
(folder / 'decoded.framemd5').write_text(decoded.stdout, encoding='utf-8')
review = folder / 'decoded-review'
review.mkdir(exist_ok=True)
subprocess.run([ffmpeg, '-hide_banner', '-y', '-i', str(temporary), '-vf',
                r'select=eq(n\,0)+eq(n\,80)+eq(n\,143)+eq(n\,279)+eq(n\,383)',
                '-fps_mode', 'vfr', str(review / 'chapter-%02d.png')], capture_output=True, check=True)
destination = ROOT / 'public/media/reventon'
destination.mkdir(parents=True, exist_ok=True)
with Image.open(folder / 'frame-0001.png') as pixels:
    pixels.convert('RGB').save(destination / 'poster.jpg', quality=96, subsampling=0)
movie = destination / 'preview.mp4'
movie.write_bytes(temporary.read_bytes())
report = {'status': 'production-preview', 'finalVisualApproved': False,
          'sourceBlendSha256': film['blendSha256'], 'frameManifest': str(folder.relative_to(ROOT) / 'manifest.json'),
          'videoSha256': hashlib.sha256(movie.read_bytes()).hexdigest(), 'videoBytes': movie.stat().st_size,
          'posterSha256': hashlib.sha256((destination / 'poster.jpg').read_bytes()).hexdigest(),
          'duration': 16, 'fps': 24, 'decodedFrames': len(rows), 'resolution': [1920, 850],
          'chapters': film['chapters'], 'encoder': 'libx264 CRF 14, yuv420p; lossy web preview, not master',
          'color': 'BT.709 matrix/primaries, sRGB transfer, limited range',
          'source': 'User-provided local VPB/3dm and embedded textures; reconstructed and rendered in Blender Cycles',
          'sourceFolder': 'lamborghini-reventon-re-made-1.snapshot.2',
          'license': 'User-supplied asset; public redistribution rights not established'}
(OUT / 'film-publication.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(destination / 'provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(destination / 'poster.jpg.provenance.json').write_text(json.dumps({
    'origin': 'Blender Cycles frame 1 of reventon-vpb-film.blend, using original user-provided VPB geometry and textures',
    'sourceBlendSha256': film['blendSha256'], 'frameSha256': manifest['frames']['1']['sha256'],
    'generatedByAIImageTool': False,
}, indent=2), encoding='utf-8')
print('FILM_PUBLISHED', json.dumps(report, ensure_ascii=True), flush=True)

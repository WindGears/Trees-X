"""Build a clearly labeled three-still review, not a pretend video player."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
motion = json.loads((OUT / 'motion-proof.json').read_text(encoding='utf-8'))
stills = json.loads((OUT / 'motion-stills/report.json').read_text(encoding='utf-8'))
verification = json.loads((OUT / 'motion-verification.json').read_text(encoding='utf-8'))
assert motion['blendSha256'] == stills['blendSha256'] == verification['blendSha256']
assert verification['result'] == 'PASS'
assert hashlib.sha256((ROOT / motion['blend']).read_bytes()).hexdigest() == motion['blendSha256']
assert stills['resolutionPercent'] == 100 and stills['samples'] == 512
labels = {'doors': ('01 / 0–4 秒', '车门开启', '44 个原车门零件完整对应开合状态；门板、玻璃、后视镜一起运动。'),
          'cabin': ('02 / 4–8 秒', '座舱观察', '使用原场景保存的内饰机位。皮革、仪表及局部纹理尚未完成最终还原。'),
          'structure': ('03 / 8–16 秒', '部件分离与合拢', '四轮、车门和后舱盖组件做可逆分离。属于模型展示，不是工程拆解；舱盖支撑没有机械开合绑定。')}
sections = []
for shot in stills['shots']:
    image_path = ROOT / shot['file']
    assert hashlib.sha256(image_path.read_bytes()).hexdigest() == shot['sha256']
    assert hashlib.sha256((ROOT / shot['linearMaster']).read_bytes()).hexdigest() == shot['masterSha256']
    with Image.open(image_path) as image:
        assert image.size == (3968, 1758)
    number, title, description = labels[shot['id']]
    path = 'motion-stills/' + image_path.name
    sections.append(f'<section><small>{number}</small><h2>{title}</h2><p>{description}</p>'
                    f'<a href="{path}" target="_blank" rel="noopener"><img src="{path}" alt="{title}的实际 Cycles 关键帧" /></a>'
                    f'<p class="meta">第 {shot["frame"]} 帧 · 3968×1758 · 512 samples 上限 · 单帧实测 {shot["seconds"]} 秒 · 点击查看原图</p></section>')
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reventón · 动作关键帧</title><style>
*{box-sizing:border-box}body{margin:0;background:#161817;color:#eceee9;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1600px;margin:auto;padding:44px 40px}h1{font-size:clamp(28px,3vw,44px);font-weight:500}h2{font-size:26px;font-weight:500}
p{color:#b9c1b9;line-height:1.8;max-width:95ch}a{color:inherit;text-underline-offset:4px}a:focus-visible{outline:3px solid #d5bc80;outline-offset:4px}
nav{display:flex;flex-wrap:wrap;gap:24px;margin:28px 0}.status{border-left:2px solid #d5bc80;color:#d5bc80;padding:12px 18px}
section{margin:56px 0;border-top:1px solid #3c443d;padding-top:24px}small,.meta{font-size:13px;color:#a4ada5}img{display:block;width:100%;height:auto;aspect-ratio:3968/1758}
@media(max-width:760px){main{padding:24px 16px}section{margin:36px 0}}
</style></head><body><main><small>TREES X / BLENDER MOTION PROOF</small><h1>开门、座舱与部件分离</h1>
<p class="status">三张真实渲染关键帧 · 可编辑时间线已建立 · 完整视频尚未渲染</p>
<p>16 秒、24 fps、384 帧的动作验证工程。以下是三处关键状态，不是视频截图拼成的假动画。
最终输出仍沿用当前静帧的几何、贴图、光照和渲染规格；与原参考图的视觉差距尚未消除。</p>
<nav><a href="comparison.html">返回原图对照</a><a href="reventon-motion-proof.blend">下载动作工程</a><a href="motion-verification.json">动作验证记录</a><a href="motion-stills/report.json">关键帧渲染记录</a></nav>
''' + ''.join(sections) + '''<footer><p>母版可以保存高精度帧序列，避免有损视频压缩。网页播放版需要单独进行编码、色彩和细节对照，不能把“高质量编码”宣称为像素完全无损。当前尚未进行连续成片的穿模、时序噪声和编码验收。</p></footer></main></body></html>'''
(OUT / 'motion-review.html').write_text(page, encoding='utf-8')
print('Motion review ready: verified 4K keyframes only, no unrendered film claim.')

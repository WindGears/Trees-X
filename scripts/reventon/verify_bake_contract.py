"""Small numerical bake/export test: color space and multi-object atlas survival."""
from pathlib import Path
import json
import bpy
import numpy as np

OUT = Path(__file__).resolve().parents[2] / 'artifacts/reventon/realtime'
assert bpy.app.background
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.render.bake.margin = 0
scene.render.bake.use_clear = True
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'
mat = bpy.data.materials.new('Contract')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
nodes.clear()
out = nodes.new('ShaderNodeOutputMaterial')
emission = nodes.new('ShaderNodeEmission')
emission.inputs['Color'].default_value = (.18, .18, .18, 1)
links.new(emission.outputs[0], out.inputs['Surface'])
objects = []
for index in range(2):
    bpy.ops.mesh.primitive_plane_add(location=(index * 3, 0, 0))
    obj = bpy.context.object
    obj.data.materials.append(mat)
    for loop in obj.data.uv_layers.active.data:
        loop.uv.x = loop.uv.x * .4 + .05 + .5 * index
        loop.uv.y = loop.uv.y * .8 + .1
    objects.append(obj)
for obj in objects:
    obj.select_set(True)
results = {}
for space in ('sRGB', 'Non-Color'):
    image = bpy.data.images.new(space, width=64, height=64, float_buffer=True, alpha=True)
    image.colorspace_settings.name = space
    target = nodes.new('ShaderNodeTexImage')
    target.image = image
    nodes.active = target
    bpy.ops.object.bake(type='EMIT')
    pixels = np.array(image.pixels[:]).reshape(64, 64, 4)
    values = [float(pixels[32, x, 0]) for x in (16, 48)]
    expected = 1.055 * .18 ** (1 / 2.4) - .055 if space == 'sRGB' else .18
    assert all(abs(v - expected) < .001 for v in values), (space, values, expected)
    image.save_render(str(OUT / ('contract-' + space + '.png')), scene=scene)
    results[space] = {'samples': values, 'expected': expected, 'multiObjectAtlas': 'PASS'}
    nodes.remove(target)
(OUT / 'bake-contract.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print('BAKE_CONTRACT_PASS', json.dumps(results), flush=True)

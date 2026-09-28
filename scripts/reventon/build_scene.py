"""Build an independent .blend from extracted Rhino geometry. Run background only."""
from pathlib import Path
import json
import sys
import time
import math
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from materials import make_library, family_for, basic
from restore_materials import restore

if not bpy.app.background:
    raise RuntimeError('Run this builder in a separate background Blender, never over the live scene')
START = time.monotonic()
OUTPUT = ROOT / 'artifacts/reventon'
manifest = json.loads((OUTPUT / 'source/manifest.json').read_text(encoding='utf-8'))
cache = np.load(OUTPUT / 'source/geometry.npz')
scene = bpy.data.scenes.new('Reventon / Studio Validation')
bpy.context.window.scene = scene
library = make_library()
model = bpy.data.collections.new('Reventon / Original Geometry')
scene.collection.children.link(model)
collections = {}
ground_z = min(m['bounds'][0][2] for m in manifest['meshes'] if 'TIRE' in m['layer'].upper())
uv_missing, normals_missing, family_counts = [], [], {}
for item in manifest['meshes']:
    key = item['key']
    collection_key = f"{item['layerIndex']:02d} / {item['layer']}"
    if collection_key not in collections:
        collection = bpy.data.collections.new(collection_key)
        model.children.link(collection)
        collection.hide_render = item['layer'] in ('DOOR OPEN', 'HOOD OPEN')
        collection.hide_viewport = collection.hide_render
        collections[collection_key] = collection
    positions, faces = cache[key + '_v'], cache[key + '_f']
    mesh = bpy.data.meshes.new(key)
    mesh.vertices.add(len(positions))
    mesh.vertices.foreach_set('co', positions.ravel())
    mesh.loops.add(faces.size)
    mesh.loops.foreach_set('vertex_index', faces.ravel())
    mesh.polygons.add(len(faces))
    mesh.polygons.foreach_set('loop_start', np.arange(0, faces.size, 3, dtype=np.int32))
    mesh.polygons.foreach_set('loop_total', np.full(len(faces), 3, dtype=np.int32))
    mesh.polygons.foreach_set('use_smooth', np.ones(len(faces), dtype=np.bool_))
    mesh.update()
    uv, normals = cache[key + '_uv'], cache[key + '_n']
    if len(uv) == len(positions):
        layer = mesh.uv_layers.new(name='Source UV')
        layer.data.foreach_set('uv', uv[faces.ravel()].ravel())
    else:
        uv_missing.append(key)
    if len(normals) == len(positions):
        mesh.normals_split_custom_set_from_vertices(normals.tolist())
    else:
        normals_missing.append(key)
    obj = bpy.data.objects.new(f"{key} / {item['material'] or 'unnamed'}", mesh)
    obj.location.z = -ground_z
    collections[collection_key].objects.link(obj)
    for field in ('sourceIndex', 'sourceObjectId', 'materialIndex', 'material', 'layer'):
        obj['source_' + field] = item[field]
    family = family_for(item)
    obj['lookdev_family'] = family
    mesh.materials.append(library[family])
    family_counts[family] = family_counts.get(family, 0) + 1

studio = bpy.data.collections.new('Studio / Lights and Cameras')
scene.collection.children.link(studio)
def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()

def camera(name, position, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens, data.clip_start, data.clip_end = lens, 0.02, 10000
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = position
    aim(obj, target)
    return obj

camera_records={r['id']:r['fields'] for r in json.loads((OUTPUT/'source/vpb-cameras.json').read_text()) if r['type']=='CameraSetting'}
def recovered_camera(name,identifier):
    fields=camera_records[identifier]
    # VPB Transform3D 15002 contains scale 256 and ground translation 154.8734;
    # its -90 degree X rotation cancels the child source's +90 degree rotation.
    position=[x/256 for x in fields['from']['value']]
    target=[x/256 for x in fields['at']['value']]
    vertical_fov=fields['fieldOfView']['value'][0]
    sensor_height=36/(3968/1758)
    result=camera(name,position,target,sensor_height/(2*math.tan(vertical_fov/2)))
    result['source_camera_id']=identifier
    result['conversion']='VPB coordinates / 256 from Transform3D 15002; vertical FOV preserved'
    result['source_target']=target
    result['source_position']=position
    return result
hero = recovered_camera('Camera / Hero',31158)
wheel = recovered_camera('Camera / Wheel',31208)
# Only the hero JPG retains the exact camera match. The wheel is an authored
# adjustment of a saved VPB viewpoint; do not present it as an exact recovery.
wheel.location.x-=0.35
wheel.location.y+=0.36
aim(wheel,wheel['source_target'])
wheel['authored_position_offset']=(-0.35,0.36,0)
wheel['camera_match']='Authored framing based on saved viewpoint 31208; reference 7 has no complete camera metadata'
hero['camera_match']='Position, target and vertical FOV match reference 6 JPEG metadata'
scene.camera = hero
for name, position, target, energy, width, height in [
    ('Key softbox', (-3, 2, 5.8), (0, 0.5, 0), 1800, 5.0, 3.0),
    ('Roof strip', (1, -1, 5), (0, 0, 0), 1500, 4.5, 1.5),
    ('Side softbox', (4, 0, 2.8), (0, 0, 0.5), 1150, 5, 2.8),
    ('Front fill', (-1, 5, 2), (0, 0.5, 0.5), 480, 3, 3),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.size_y = energy, 'RECTANGLE', width, height
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = position
    aim(obj, target)

floor_mesh = bpy.data.meshes.new('Studio ground')
floor_mesh.from_pydata([(-2000,-2000,-0.002),(2000,-2000,-0.002),(2000,2000,-0.002),(-2000,2000,-0.002)], [], [(0,1,2,3)])
floor = bpy.data.objects.new('Studio / seamless ground', floor_mesh)
studio.objects.link(floor)
floor_mat, _ = basic('Neutral studio floor', (0.33,0.33,0.32), 0, 0.78)
floor.data.materials.append(floor_mat)
profile=[(8+6*math.sin(i*math.pi/64),6*(1-math.cos(i*math.pi/64))-0.002) for i in range(33)]
profile.append((14,25))
segments=96
cyc_mesh=bpy.data.meshes.new('Seamless cyclorama')
cyc_vertices=[(r*math.cos(j*2*math.pi/segments),r*math.sin(j*2*math.pi/segments),z) for r,z in profile for j in range(segments)]
cyc_faces=[(i*segments+j,(i+1)*segments+j,(i+1)*segments+(j+1)%segments,i*segments+(j+1)%segments) for i in range(len(profile)-1) for j in range(segments)]
cyc_mesh.from_pydata(cyc_vertices,[],cyc_faces)
for polygon in cyc_mesh.polygons: polygon.use_smooth=True
cyc=bpy.data.objects.new('Studio / curved backdrop',cyc_mesh)
studio.objects.link(cyc);cyc.data.materials.append(floor_mat)
cyc.visible_shadow=False;cyc.visible_glossy=False;cyc.visible_transmission=False;cyc.visible_diffuse=False
world = bpy.data.worlds.new('Studio / neutral ambient')
world.use_nodes = True
background = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
background.inputs[0].default_value = (0.45,0.45,0.45,1)
background.inputs[1].default_value = 0.45
scene.world = world
try:
    scene.render.engine = 'CYCLES'
except TypeError as error:
    raise RuntimeError(f'Cycles unavailable: {error}')
scene.cycles.samples = 512
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = 0.005
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 8
scene.cycles.device = 'GPU'
scene.render.resolution_x, scene.render.resolution_y = 3968, 1758
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'
scene.view_settings.view_transform = 'AgX'
restored_counts = restore(scene)
scene['source_sha256'] = manifest['sha256']
scene['source_triangle_count'] = manifest['triangles']
scene['ground_offset'] = -ground_z
scene['source_units_warning'] = manifest['coordinatePolicy']
readme = bpy.data.texts.new('READ ME / source and limitations')
readme.write('Imported from the supplied CR1.3dm without decimation. Original UVs and normals retained where available.\n')
readme.write('VPB texture pixels were recovered. Cycles shaders are reconstructions, not a lossless VRED shader conversion.\n')
readme.write('Whole-car reference: 6-beauty.jpg. Wheel reference: 7-beauty.jpg. Static quality comparison pending.\n')
readme.write('Open-door and open-hood source variants are hidden, not deleted.\n')
readme.write(json.dumps({'externalTextures':manifest['externalTextures'],'uvMissing':uv_missing,'normalMissing':normals_missing},ensure_ascii=False,indent=2))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.region_3d.view_camera_zoom = 0
            area.spaces.active.clip_end = 300
            area.spaces.active.overlay.show_overlays = False

# This process was launched with --factory-startup; remove only its unused default scene.
for old in list(bpy.data.scenes):
    if old != scene:
        bpy.data.scenes.remove(old)
report = {'blender':bpy.app.version_string,'importedMeshes':len(model.all_objects),
          'vertices':sum(len(o.data.vertices) for o in model.all_objects),
          'triangles':sum(len(o.data.polygons) for o in model.all_objects),
          'uvMissing':uv_missing,'normalsMissing':normals_missing,'materialFamilies':family_counts,
          'restoredMaterialAssignments':restored_counts,
          'groundOffset':-ground_z,'buildSeconds':round(time.monotonic()-START,2)}
assert report['triangles'] == manifest['triangles']
assert report['vertices'] == manifest['vertices']
(OUTPUT / 'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / 'reventon-restored.blend'), compress=True)
print('REVENTON_BUILD_COMPLETE',json.dumps(report))

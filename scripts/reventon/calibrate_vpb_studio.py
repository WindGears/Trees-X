"""Authored studio adjustments, kept distinct from recovered source parameters."""
import bpy
from mathutils import Vector
from materials import set_input


def calibrate(scene):
    # Added softboxes overexposed the headlamp lenses. Keep diffuse fill while
    # returning most sharp specular shaping to the recovered environment.
    for light in bpy.data.lights:
        if light.type == 'AREA':
            assert hasattr(light, 'specular_factor')
            light.specular_factor = .12
    backdrop = bpy.data.objects['Studio / curved backdrop']
    backdrop.visible_transmission = True
    backdrop.visible_glossy = True
    floor = bpy.data.materials['RX / Neutral studio floor']
    shader = next(n for n in floor.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    set_input(shader, 'Base Color', (.5, .5, .5, 1))
    data = bpy.data.lights.new('Studio / cabin bounce', 'AREA')
    data.energy = 150
    data.shape = 'RECTANGLE'
    data.size, data.size_y = 1.4, .8
    data.specular_factor = .12
    obj = bpy.data.objects.new(data.name, data)
    bpy.data.collections['Studio / Lights and Cameras'].objects.link(obj)
    obj.location = (1.5, .35, 1.55)
    obj.rotation_euler = (Vector((-.3, .55, .65)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    scene['studio_calibration'] = 'Authored Cycles: softbox specular influence .12; cabin bounce 150 W; floor .5; curved background visible to glossy/transmission rays'

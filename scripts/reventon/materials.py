"""Explicit Cycles look-development materials, not recovered VRED shaders.

Base families are replaced by restore_materials where recovered images apply.
Unmapped source materials stay explicitly reconstructed; no logo is invented.
"""
import math
import bpy

def socket(node, identifier, output=False):
    sockets = node.outputs if output else node.inputs
    return next(s for s in sockets if s.identifier == identifier)

def set_input(node, identifier, value):
    socket(node, identifier).default_value = value

def basic(name, color, metallic, roughness, coat=0):
    material = bpy.data.materials.new('RX / ' + name)
    material.use_nodes = True
    material.diffuse_color = (*color, 1)
    material['provenance'] = 'Reconstructed in Blender; not original VPB material'
    node = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    for key, value in {'Base Color': (*color, 1), 'Metallic': metallic,
                       'Roughness': roughness, 'Coat Weight': coat, 'Coat Roughness': 0.24}.items():
        set_input(node, key, value)
    return material, node

def fine_bump(material, shader, scale, strength, distance):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '3D'
    noise.noise_type = 'FBM'
    set_input(noise, 'Scale', scale)
    set_input(noise, 'Detail', 2)
    bump = nodes.new('ShaderNodeBump')
    set_input(bump, 'Strength', strength)
    set_input(bump, 'Distance', distance)
    coords = nodes.new('ShaderNodeTexCoord')
    links.new(socket(coords, 'Object', True), socket(noise, 'Vector'))
    links.new(socket(noise, 'Fac', True), socket(bump, 'Height'))
    links.new(socket(bump, 'Normal', True), socket(shader, 'Normal'))

def carbon_material():
    material, shader = basic('Carbon study', (0.027, 0.03, 0.033), 0.42, 0.29, 0.48)
    material['limitation'] = 'Fallback only; restore_materials replaces carbon using recovered VPB image 26251'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    set_input(mapping, 'Rotation', (0, 0, math.pi / 4))
    links.new(socket(coords, 'UV', True), socket(mapping, 'Vector'))
    checker = nodes.new('ShaderNodeTexChecker')
    set_input(checker, 'Scale', 170)
    set_input(checker, 'Color1', (0.015, 0.017, 0.02, 1))
    set_input(checker, 'Color2', (0.055, 0.06, 0.065, 1))
    links.new(socket(mapping, 'Vector', True), socket(checker, 'Vector'))
    links.new(socket(checker, 'Color', True), socket(shader, 'Base Color'))
    wave = nodes.new('ShaderNodeTexWave')
    wave.bands_direction = 'X'
    set_input(wave, 'Scale', 850)
    links.new(socket(mapping, 'Vector', True), socket(wave, 'Vector'))
    bump = nodes.new('ShaderNodeBump')
    set_input(bump, 'Distance', 0.00007)
    set_input(bump, 'Strength', 0.23)
    links.new(socket(wave, 'Fac', True), socket(bump, 'Height'))
    links.new(socket(bump, 'Normal', True), socket(shader, 'Normal'))
    set_input(shader, 'Anisotropic', 0.38)
    return material

def make_library():
    specs = {
        'paint': ((0.105, 0.115, 0.11), 0.65, 0.34, 0.18),
        'rubber': ((0.018, 0.019, 0.019), 0, 0.72, 0),
        'plastic': ((0.014, 0.016, 0.017), 0.0, 0.45, 0),
        'leather': ((0.022, 0.022, 0.021), 0, 0.55, 0),
        'cloth': ((0.055, 0.052, 0.045), 0, 0.88, 0),
        'chrome': ((0.55, 0.57, 0.58), 1, 0.17, 0),
        'metal': ((0.17, 0.18, 0.19), 0.9, 0.34, 0),
        'rim': ((0.045, 0.05, 0.052), 0.85, 0.2, 0.35),
        'brake': ((0.24, 0.25, 0.25), 0.85, 0.42, 0),
        'stitch': ((0.4, 0.4, 0.36), 0, 0.8, 0),
        'decal_missing': ((0.065, 0.067, 0.064), 0.2, 0.4, 0),
        'glass': ((0.92, 0.96, 0.94), 0, 0.055, 0),
        'red_glass': ((0.38, 0.006, 0.004), 0, 0.08, 0),
    }
    library = {}
    for name, spec in specs.items():
        material, shader = basic(name, *spec)
        library[name] = material
        if 'glass' in name:
            set_input(shader, 'Transmission Weight', 1.0)
            set_input(shader, 'IOR', 1.48)
            set_input(shader, 'Thin Wall', True)
        if name == 'paint':
            fine_bump(material, shader, 3800, 0.12, 0.000025)
        if name in ('rubber', 'leather', 'cloth'):
            fine_bump(material, shader, 1800 if name == 'rubber' else 1200, 0.3, 0.00012)
        if name == 'decal_missing':
            material['limitation'] = 'Fallback for unmapped decals; recovered badge images are assigned by restore_materials'
    library['carbon'] = carbon_material()
    return library

def family_for(mesh):
    name, layer = mesh['material'].lower(), mesh['layer'].upper()
    if 'TIRE' in layer or name == 'tire': return 'rubber'
    if name.startswith('body'): return 'paint'
    if 'carbon' in name: return 'carbon'
    if name in ('tail_light', 'detail_glass_red'): return 'red_glass'
    if 'glass' in name or name == 'window': return 'glass'
    if 'badge' in name or 'emblem' in name or 'LOGO' in layer: return 'decal_missing'
    if 'mirror' in name or 'chrome' in name or 'reflector' in name or name == 'head_light': return 'chrome'
    if name.startswith('brake'): return 'brake'
    if name.startswith('rim'): return 'rim'
    if 'stitch' in name: return 'stitch'
    if 'leather' in name: return 'leather'
    if 'cloth' in name or 'mottled' in name: return 'cloth'
    if 'rubber' in name: return 'rubber'
    if 'metal' in name: return 'metal'
    return 'plastic'

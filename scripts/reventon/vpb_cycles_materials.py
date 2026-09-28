"""Source-bound Cycles material adapter. Shader equivalence is NOT claimed.

Legacy roughness scale: Autodesk General Truelight Material Settings (2025).
Bump payload: Autodesk engineer Michael Nikelsky, forum post 8522576 (2019).
"""
from pathlib import Path
import json
import math
import bpy
from materials import basic, socket, set_input

ROOT = Path(__file__).resolve().parents[2]
TEXTURES = ROOT / 'artifacts/reventon/textures'
IMAGES = {r['id']: r for r in json.loads((TEXTURES / 'manifest.json').read_text(encoding='utf-8'))['images']}


def roughness(old):
    return min(1.0, max(0.0, old / 40.0) ** 0.25)


class Adapter:
    def __init__(self, records):
        self.records = records
        self.cache = {}
        self.materials = {r['id']: r for r in json.loads((ROOT / 'artifacts/reventon/source/vpb-materials.json').read_text(encoding='utf-8'))['materials']}

    def component(self, fields, kind):
        group = self.records.get(fields.get('colorComponentData'), {}).get('fields', {})
        return self.records.get(group.get(kind + 'Component'), {}).get('fields', {})

    def image(self, material, identifier, fields, kind, data=False):
        record = IMAGES[identifier]
        # Color and data uses receive separate datablocks even for identical files.
        cache_key = (record['file'], data)
        if cache_key not in self.cache:
            image = bpy.data.images.load(str(TEXTURES / record['file']), check_existing=False)
            image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
            image['source_vpb_image_id'] = identifier
            image['source_pixel_sha256'] = record['pixelSha256']
            image.pack()
            self.cache[cache_key] = image
        nodes, links = material.node_tree.nodes, material.node_tree.links
        node = nodes.new('ShaderNodeTexImage')
        node.image = self.cache[cache_key]
        coords = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeMapping')
        settings = self.component(fields, kind)
        triplanar = settings.get('textureProjectionType') == 2 or material['source_type'] == 'UTriplanarMaterial'
        if triplanar:
            size = fields.get('textureSizeMM', [0.06, 0.06]) if material['source_type'] == 'UTriplanarMaterial' else settings.get('textureSizeMM', [0.07, 0.07])
            set_input(mapping, 'Scale', (1 / max(size[0], .0001),) * 3)
            node.projection = 'BOX'
            node.projection_blend = fields.get('edgeBlend', settings.get('triplanarBlend', [0.3])[0])
            links.new(socket(coords, 'Object', True), socket(mapping, 'Vector'))
        else:
            repeat = settings.get('repeat', [1, 1])
            set_input(mapping, 'Scale', (repeat[0], repeat[1], 1))
            offset = settings.get('offset', [0, 0])
            set_input(mapping, 'Location', (offset[0], offset[1], 0))
            set_input(mapping, 'Rotation', (0, 0, math.radians(settings.get('rotate', [0])[0])))
            links.new(socket(coords, 'UV', True), socket(mapping, 'Vector'))
        links.new(socket(mapping, 'Vector', True), socket(node, 'Vector'))
        return node, triplanar

    def make(self, identifier):
        record = self.materials[identifier]
        fields = {k: v['value'] for k, v in record['fields'].items()}
        kind = record['type']
        color = fields.get('diffuseColor', fields.get('baseColor', [0.02] * 3))
        old_roughness = fields.get('roughness', fields.get('roughnessU', 0.5))
        metallic = 0
        if kind in ('UChromeMaterial', 'UBrushedMetalMaterial'):
            metallic = 1
            color = fields.get('reflectionColor', fields.get('specularColor', color))
        if kind == 'UGlassMaterial':
            color = fields.get('exteriorColor', [1] * 3)
        mat, shader = basic('VPB ' + str(identifier), color, metallic, roughness(old_roughness))
        mat['source_vpb_material_id'] = identifier
        mat['source_type'] = kind
        mat['source_names'] = json.dumps(record['names'], ensure_ascii=False)
        mat['source_legacy_roughness'] = old_roughness
        mat['provenance'] = 'Original VPB assignment/parameters/images; Cycles BSDF is a documented reconstruction'
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        reflectivity = fields.get('reflectivity', .04)
        if not metallic:
            set_input(shader, 'Specular IOR Level', min(1, reflectivity / .08))
        if kind == 'UGlassMaterial':
            r0 = min(.95, reflectivity)
            set_input(shader, 'IOR', (1 + math.sqrt(r0)) / (1 - math.sqrt(r0)))
            set_input(shader, 'Specular IOR Level', .5)
            set_input(shader, 'Transmission Weight', 1)
            set_input(shader, 'Thin Wall', True)
            # Source unfrosted glass does not use the stored roughness slider.
            if not fields.get('useFrostedGlass', False):
                set_input(shader, 'Roughness', 0)
        if kind in ('UUnicolorPaintMaterial', 'UMetallicPaintMaterial', 'UReflectivePlasticMaterial'):
            set_input(shader, 'Coat Weight', 1)
            set_input(shader, 'Coat Roughness', .04)
        if kind == 'UWovenClothMaterial':
            set_input(shader, 'Roughness', .75)
            set_input(shader, 'Sheen Weight', .3)
        if fields.get('useColorTexture') and fields.get('colorMap'):
            image, _ = self.image(mat, fields['colorMap'], fields, 'diffuse')
            multiply = nodes.new('ShaderNodeMixRGB')
            multiply.blend_type = 'MULTIPLY'
            set_input(multiply, 'Fac', 1)
            set_input(multiply, 'Color2', (*color, 1))
            links.new(socket(image, 'Color', True), socket(multiply, 'Color1'))
            links.new(socket(multiply, 'Color', True), socket(shader, 'Base Color'))
            if fields.get('useAlpha'):
                links.new(socket(image, 'Alpha', True), socket(shader, 'Alpha'))
        if fields.get('useSpecularTexture') and fields.get('specularMap') and not metallic:
            image, _ = self.image(mat, fields['specularMap'], fields, 'specular', True)
            gain = nodes.new('ShaderNodeMath')
            gain.operation = 'MULTIPLY'
            set_input(gain, 'Value_001', reflectivity / .08)
            links.new(socket(image, 'Color', True), socket(gain, 'Value'))
            links.new(socket(gain, 'Value', True), socket(shader, 'Specular IOR Level'))
        if fields.get('useBumpTexture') and fields.get('bumpMap'):
            image, triplanar = self.image(mat, fields['bumpMap'], fields, 'bump', True)
            split = nodes.new('ShaderNodeSeparateXYZ')
            links.new(socket(image, 'Color', True), socket(split, 'Vector'))
            if triplanar or fields.get('bumpType') == 1:
                # In VRED's stored bump format blue is height, not normal Z.
                bump = nodes.new('ShaderNodeBump')
                set_input(bump, 'Strength', 1)
                set_input(bump, 'Distance', min(.002, fields.get('bumpIntensity', 1) * .0003))
                links.new(socket(split, 'Z', True), socket(bump, 'Height'))
                links.new(socket(bump, 'Normal', True), socket(shader, 'Normal'))
            else:
                # Reconstruct a positive normal Z from RG. Keep original pixels intact.
                operations = []
                for channel in ('X', 'Y'):
                    scale = nodes.new('ShaderNodeMath'); scale.operation = 'MULTIPLY_ADD'
                    set_input(scale, 'Value_001', 2); set_input(scale, 'Value_002', -1)
                    links.new(socket(split, channel, True), socket(scale, 'Value'))
                    square = nodes.new('ShaderNodeMath'); square.operation = 'MULTIPLY'
                    links.new(socket(scale, 'Value', True), socket(square, 'Value'))
                    links.new(socket(scale, 'Value', True), socket(square, 'Value_001'))
                    operations.append(square)
                subtract = nodes.new('ShaderNodeMath'); subtract.operation = 'SUBTRACT'
                set_input(subtract, 'Value', 1)
                add = nodes.new('ShaderNodeMath'); add.operation = 'ADD'
                for i, node in enumerate(operations):
                    links.new(socket(node, 'Value', True), socket(add, 'Value' if i == 0 else 'Value_001'))
                links.new(socket(add, 'Value', True), socket(subtract, 'Value_001'))
                subtract.use_clamp = True
                root = nodes.new('ShaderNodeMath'); root.operation = 'SQRT'
                links.new(socket(subtract, 'Value', True), socket(root, 'Value'))
                encode = nodes.new('ShaderNodeMath'); encode.operation = 'MULTIPLY_ADD'
                set_input(encode, 'Value_001', .5); set_input(encode, 'Value_002', .5)
                links.new(socket(root, 'Value', True), socket(encode, 'Value'))
                combine = nodes.new('ShaderNodeCombineXYZ')
                links.new(socket(split, 'X', True), socket(combine, 'X'))
                # VRED tangent Y is DirectX; Blender tangent Y is OpenGL.
                invert = nodes.new('ShaderNodeMath'); invert.operation = 'SUBTRACT'
                set_input(invert, 'Value', 1)
                links.new(socket(split, 'Y', True), socket(invert, 'Value_001'))
                links.new(socket(invert, 'Value', True), socket(combine, 'Y'))
                links.new(socket(encode, 'Value', True), socket(combine, 'Z'))
                normal = nodes.new('ShaderNodeNormalMap'); normal.uv_map = 'VPB UV'
                set_input(normal, 'Strength', min(2, fields.get('bumpIntensity', 1)))
                links.new(socket(combine, 'Vector', True), socket(normal, 'Color'))
                links.new(socket(normal, 'Normal', True), socket(shader, 'Normal'))
        rough = self.component(fields, 'roughness')
        if rough.get('useTexture') and rough.get('image') in IMAGES:
            image, _ = self.image(mat, rough['image'], fields, 'roughness', True)
            group = self.records[fields['colorComponentData']]['fields']
            bounds = group['roughnessTextureRange']
            mix = nodes.new('ShaderNodeMixRGB')
            set_input(mix, 'Color1', (roughness(bounds[0]),) * 3 + (1,))
            set_input(mix, 'Color2', (roughness(bounds[2]),) * 3 + (1,))
            links.new(socket(image, 'Color', True), socket(mix, 'Fac'))
            links.new(socket(mix, 'Color', True), socket(shader, 'Roughness'))
        return mat

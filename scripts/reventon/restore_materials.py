"""Cycles look development using recovered VPB images, preserving provenance."""
from pathlib import Path
import json
import math
import bpy
import numpy as np
from materials import basic, socket, set_input, fine_bump

ROOT=Path(__file__).resolve().parents[2]
TEXTURES=ROOT/'artifacts/reventon/textures'
IMAGES={r['id']:r for r in json.loads((TEXTURES/'manifest.json').read_text())['images']}

def texture(material, image_id, data=False, scale=1):
    record=IMAGES[image_id]
    image=bpy.data.images.load(str(TEXTURES/record['file']),check_existing=True)
    image.colorspace_settings.name='Non-Color' if data else 'sRGB'
    image['source_vpb_image_id']=image_id
    image['source_pixel_sha256']=record['pixelSha256']
    image.pack()
    nodes,links=material.node_tree.nodes,material.node_tree.links
    node=nodes.new('ShaderNodeTexImage');node.image=image
    coords=nodes.new('ShaderNodeTexCoord')
    mapping=nodes.new('ShaderNodeMapping')
    set_input(mapping,'Scale',(scale,scale,scale))
    links.new(socket(coords,'UV',True),socket(mapping,'Vector'))
    links.new(socket(mapping,'Vector',True),socket(node,'Vector'))
    material['texture_provenance']='Recovered pixels from user supplied 2 TEMP.vpb; Cycles shader reconstructed'
    return node

def image_normal(material,shader,image_id,strength=1):
    image=texture(material,image_id,True)
    node=material.node_tree.nodes.new('ShaderNodeNormalMap')
    node.space='TANGENT';node.uv_map='Source UV'
    set_input(node,'Strength',strength)
    material.node_tree.links.new(socket(image,'Color',True),socket(node,'Color'))
    material.node_tree.links.new(socket(node,'Normal',True),socket(shader,'Normal'))

def restore(scene):
    paint=bpy.data.materials['RX / paint']
    shader=next(n for n in paint.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    set_input(shader,'Base Color',(0.00547,0.00590,0.00639,1))
    set_input(shader,'Metallic',0);set_input(shader,'Roughness',0.13)
    set_input(shader,'Specular IOR Level',0.5)
    set_input(shader,'Coat Weight',0)
    glass=bpy.data.materials['RX / glass']
    glass_shader=next(n for n in glass.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    set_input(glass_shader,'Base Color',(0.98,0.99,0.98,1))
    set_input(glass_shader,'Roughness',0.008)
    # Source Glass white reflectivity is 0.02; translate that normal-incidence
    # Fresnel reflectance to a dielectric IOR (not a full VRED glass conversion).
    set_input(glass_shader,'IOR',(1+math.sqrt(0.02))/(1-math.sqrt(0.02)))
    tire,ts=basic('Original tire normal',(0.0083,)*3,0,0.42)
    image_normal(tire,ts,26050,0.65)
    wear=texture(tire,26049,True,2)
    mix=tire.node_tree.nodes.new('ShaderNodeMixRGB')
    set_input(mix,'Color1',(0.3,)*3+(1,));set_input(mix,'Color2',(0.65,)*3+(1,))
    tire.node_tree.links.new(socket(wear,'Color',True),socket(mix,'Fac'))
    tire.node_tree.links.new(socket(mix,'Color',True),socket(ts,'Roughness'))
    # VPB uses this image as a specular map, not merely roughness. Keep the
    # original image and expose its variation in the reconstructed dielectric.
    contrast=tire.node_tree.nodes.new('ShaderNodeMath');contrast.operation='POWER'
    set_input(contrast,'Value_001',3.0)
    tire.node_tree.links.new(socket(wear,'Color',True),socket(contrast,'Value'))
    tire.node_tree.links.new(socket(contrast,'Value',True),socket(ts,'Specular IOR Level'))
    gold,gs=basic('Geometric emblem gold',(0.55,0.34,0.07),0.85,0.24)
    badge,bs=basic('Geometric badge backing',(0.006,)*3,0.3,0.23)
    # The original badge skins contain overlapping sub-surfaces. The wordmark is
    # projected as a separate, source-image decal to avoid z-fighting between them.
    decal,decal_shader=basic('Original badge wordmark',(0.55,0.34,0.07),0.7,0.26)
    decal_image=texture(decal,26713,True)
    decal.node_tree.links.new(socket(decal_image,'Color',True),socket(decal_shader,'Alpha'))
    rim,rs=basic('Black rim lacquer',(0.002597,)*3,0,0.5,1.0)
    set_input(rs,'Coat Roughness',0.045)
    carbons={}
    for name,scale in [('Body carbon',1),('Wheel carbon',30)]:
        mat,shader=basic(name,(0.08,)*3,0.3,0.3,0.3)
        image=texture(mat,26251,False,scale)
        mix=mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY'
        set_input(mix,'Fac',1);set_input(mix,'Color2',(0.55,0.55,0.55,1) if name=='Wheel carbon' else (0.2,0.2,0.2,1))
        mat.node_tree.links.new(socket(image,'Color',True),socket(mix,'Color1'))
        mat.node_tree.links.new(socket(mix,'Color',True),socket(shader,'Base Color'))
        bump=mat.node_tree.nodes.new('ShaderNodeBump')
        set_input(bump,'Strength',0.04);set_input(bump,'Distance',0.00001)
        mat.node_tree.links.new(socket(image,'Color',True),socket(bump,'Height'))
        mat.node_tree.links.new(socket(bump,'Normal',True),socket(shader,'Normal'))
        carbons[name]=mat
    atlas,ats=basic('Original body detail atlas',(1,)*3,0.1,0.4)
    image=texture(atlas,27811)
    atlas.node_tree.links.new(socket(image,'Color',True),socket(ats,'Base Color'))
    brake,bks=basic('Original brake atlas',(1,)*3,0.65,0.31)
    image=texture(brake,28906)
    brake.node_tree.links.new(socket(image,'Color',True),socket(bks,'Base Color'))
    disc,ds=basic('Machined brake disc',(0.35,)*3,1.0,0.18)
    nodes,links=disc.node_tree.nodes,disc.node_tree.links
    tangent=nodes.new('ShaderNodeTangent');tangent.direction_type='RADIAL';tangent.axis='X'
    links.new(socket(tangent,'Tangent',True),socket(ds,'Tangent'))
    set_input(ds,'Anisotropic',0.95)
    coords=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
    set_input(mapping,'Location',(-0.5,-0.5,-0.5))
    links.new(socket(coords,'Generated',True),socket(mapping,'Vector'))
    wave=nodes.new('ShaderNodeTexWave');wave.wave_type='RINGS';wave.rings_direction='X'
    set_input(wave,'Scale',450);set_input(wave,'Distortion',4);set_input(wave,'Detail Scale',4)
    links.new(socket(mapping,'Vector',True),socket(wave,'Vector'))
    bump=nodes.new('ShaderNodeBump');set_input(bump,'Distance',0.00004);set_input(bump,'Strength',0.28)
    links.new(socket(wave,'Fac',True),socket(bump,'Height'));links.new(socket(bump,'Normal',True),socket(ds,'Normal'))
    scratch=texture(disc,26452,True,3)
    contrast=nodes.new('ShaderNodeMath');contrast.operation='POWER';set_input(contrast,'Value_001',4)
    links.new(socket(scratch,'Color',True),socket(contrast,'Value'))
    mix=nodes.new('ShaderNodeMixRGB');set_input(mix,'Color1',(0.035,)*3+(1,));set_input(mix,'Color2',(0.22,)*3+(1,))
    links.new(socket(contrast,'Value',True),socket(mix,'Fac'));links.new(socket(mix,'Color',True),socket(ds,'Roughness'))
    count={}
    decals=bpy.data.collections.new('Restoration / original wordmark decals');scene.collection.children.link(decals)
    for obj in list(bpy.data.collections['Reventon / Original Geometry'].all_objects):
        name=obj.get('source_material','').lower();layer=obj.get('source_layer','')
        material=None
        if 'TIRE' in layer:material=tire
        elif layer=='LOGO NEW':material=gold if name=='emblem' else badge
        # Rhino left these three windscreen surfaces UNASSIGNED. Their bounds and
        # source topology identify the two glazing skins and cached centre surface.
        elif obj.data.name in ('m30','m35','m607'):material=glass
        elif name=='rim_wheel_emblem':material=atlas
        elif 'carbon' in name:material=carbons['Wheel carbon' if name.startswith('rim') else 'Body carbon']
        elif name.startswith('rim'):material=rim
        elif layer.startswith('BRAKE'):material=brake
        elif layer=='DISK' and name=='brake_smooth_metal':material=disc
        elif name=='badge' and layer!='LOGO NEW':material=atlas
        if material:
            obj.data.materials.clear();obj.data.materials.append(material)
            count[material.name]=count.get(material.name,0)+1
        if material==badge:
            positions=np.empty((len(obj.data.vertices),3),dtype='float32')
            obj.data.vertices.foreach_get('co',positions.ravel())
            centre=positions.mean(axis=0)
            obj.data.materials.append(gold)
            for poly in obj.data.polygons:
                # Gold bevel follows the existing badge geometry; no invented logo.
                if abs(centre[0])>0.8 and abs(poly.normal.x)<0.65:poly.material_index=1
            if obj.data.name in ('m0','m3','m6','m9'):
                side=1 if centre[0]>0 else -1
                x=(positions[:,0].max() if side>0 else positions[:,0].min())+side*0.00015
                ymin,ymax=positions[:,1].min(),positions[:,1].max()
                zmin,zmax=positions[:,2].min(),positions[:,2].max()
                left,right=(ymin,ymax) if side>0 else (ymax,ymin)
                mesh=bpy.data.meshes.new(obj.data.name+' / wordmark')
                mesh.from_pydata([(x,left,zmin),(x,right,zmin),(x,right,zmax),(x,left,zmax)],[],[(0,1,2,3)])
                uv=mesh.uv_layers.new(name='Source UV');uv.data.foreach_set('uv',[0,0,1,0,1,1,0,1])
                overlay=bpy.data.objects.new(mesh.name,mesh);overlay.location=obj.location
                decals.objects.link(overlay);mesh.materials.append(decal)
                overlay['provenance']='Original VPB image 26713 projected onto original badge; no generated lettering'
    # Recovered linear HDR is packed in the blend. Render lights remain individually editable.
    pixels=np.load(TEXTURES/'studio-linear.npy')
    image=bpy.data.images.new('Original Studio 1 / recovered',width=pixels.shape[1],height=pixels.shape[0],float_buffer=True)
    image.colorspace_settings.name='Linear Rec.709'
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw=str(TEXTURES/'studio-recovered.exr');image.file_format='OPEN_EXR';image.save();image.pack()
    nodes,links=scene.world.node_tree.nodes,scene.world.node_tree.links
    env=nodes.new('ShaderNodeTexEnvironment');env.image=image
    coords=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
    set_input(mapping,'Rotation',(0,0,0))
    links.new(socket(coords,'Generated',True),socket(mapping,'Vector'))
    links.new(socket(mapping,'Vector',True),socket(env,'Vector'))
    background=next(n for n in nodes if n.type=='BACKGROUND')
    links.new(socket(env,'Color',True),socket(background,'Color'))
    set_input(background,'Strength',1.0)
    for light in bpy.data.lights:
        light.energy*=0.16
    floor=bpy.data.materials['RX / Neutral studio floor']
    shader=next(n for n in floor.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    set_input(shader,'Base Color',(0.33,)*3+(1,))
    scene['quality_gate']='Recovered source textures; reconstructed Cycles shaders. Static comparison pending; not film approved.'
    return count

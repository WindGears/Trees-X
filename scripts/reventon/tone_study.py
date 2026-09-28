"""Bounded display-transform study on our linear Cycles masters, inside Blender.

Reinhard here is the published extended luminance formula, NOT a claim to emulate
Autodesk's private implementation or the unknown Photoshop edits in the references.
"""
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/reventon/renders'
scene=bpy.context.scene
scene.view_settings.view_transform='Standard'
scene.view_settings.exposure=0
scene.view_settings.gamma=1
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_depth='16'
for shot in ('hero','wheel'):
    image=bpy.data.images.load(str(OUT/f'{shot}-validation.exr'),check_existing=False)
    w,h=image.size
    pixels=np.empty(w*h*4,dtype='float32');image.pixels.foreach_get(pixels)
    pixels=pixels.reshape(h,w,4);rgb=pixels[:,:,:3]*2
    luminance=rgb@np.array([.2126,.7152,.0722],dtype='float32')
    pixels[:,:,:3]=rgb*((1+luminance/4)/(1+luminance))[:,:,None]
    target=bpy.data.images.new(shot+' / Reinhard study',width=w,height=h,float_buffer=True)
    target.pixels.foreach_set(pixels.ravel())
    target.save_render(filepath=str(OUT/f'{shot}-tone-study.png'),scene=scene)
    bpy.data.images.remove(image);bpy.data.images.remove(target)
print('REVENTON_TONE_STUDY_COMPLETE')

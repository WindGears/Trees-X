package com.treesx.product;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class PresentationV3Validator {
    private PresentationV3Validator() {}
    static void validate(Presentation p) {
        var progress = p.actions().stream().filter(a -> a.kind().equals("progress")).toList();
        var programs=progress.stream().filter(a -> a.motion()!=null && a.motion().program()!=null).toList();
        boolean typewriter="glb".equals(p.source().kind()) && "typewriter-v1".equals(p.source().adapter());
        boolean piano="glb".equals(p.source().kind()) && "piano-v1".equals(p.source().adapter());
        String programType=typewriter ? "typewriter-layout-v1" : piano ? "piano-sound-path-v1" : null;
        if(programType!=null || !programs.isEmpty()) {
            if(programType==null || p.version()!=3 || programs.size()!=1 || progress.size()!=1 || (piano && p.actions().size()!=1) ||
                !programType.equals(programs.get(0).motion().program().type()) ||
                !programs.get(0).id().equals(p.structureActionId()) || !p.source().explode().isEmpty() ||
                p.actions().stream().anyMatch(a -> a.behavior()!=null && (!typewriter || !a.behavior().type().equals("typewriter-strike")))) fail();
        }
        if(progress.stream().anyMatch(a -> a.id().equals("explosion"))) fail();
        if (p.version()!=3 && (!progress.isEmpty() || p.structureActionId()!=null ||
            p.hotspots().stream().anyMatch(h -> h.anchor()!=null) || p.guide().stream().anyMatch(g -> g.progress()!=null))) fail();
        for (var a:p.actions()) if (a.kind().equals("progress")!=(a.motion()!=null) || (a.motion()!=null && a.behavior()!=null)) fail();
        var ids = progress.stream().map(Presentation.Action::id).collect(java.util.stream.Collectors.toSet());
        if (p.structureActionId()!=null && (!p.structure() || !ids.contains(p.structureActionId()))) fail();
        for (var h:p.hotspots()) if(h.anchor()!=null) vector(h.anchor(),3);
        for (var g:p.guide()) if(g.progress()!=null) {
            if(!ids.contains(g.progress().actionId())) fail();
            unit(g.progress().value());
        }
        Set<String> owned = new HashSet<>();
        for(var a:p.actions()) {
            if(a.behavior()!=null) owned.add(a.node()+":"+a.behavior().type());
            else if(!a.kind().equals("progress") && p.source().kind().equals("procedural")) {
                if(p.source().key().equals("speaker") && a.id().equals("turn-knob")) owned.add("knob:rotate");
                if(p.source().key().equals("car") && a.id().equals("open-doors")) { owned.add("door-left:rotate"); owned.add("door-right:rotate"); }
                if(p.source().key().equals("typewriter") && a.id().equals("press-key")) { owned.add("key:translate"); owned.add("lever:rotate"); owned.add("carriage:translate"); }
            }
        }
        if(p.structureActionId()==null && p.structure()) {
            if(p.source().kind().equals("glb")) p.source().explode().forEach(e -> owned.add(e.node()+":translate"));
            else {
                var nodes = switch(p.source().key()) {
                    case "speaker" -> List.of("shell","front","driver","knob");
                    case "car" -> List.of("body","cabin","door-left","door-right","wheel--1--1.14","wheel--1-1.14","wheel-1--1.14","wheel-1-1.14");
                    default -> List.of("shell","keys","lever","carriage");
                };
                nodes.forEach(n -> owned.add(n+":translate"));
            }
        }
        for(var a:progress) {
            var m=a.motion(); finite(m.duration());
            if(m.program()!=null) {
                if(m.tracks()!=null) fail();
                PresentationV2Validator.relative(m.program().file());
                continue;
            }
            if(m.tracks()==null || m.tracks().isEmpty()) fail();
            for(var t:m.tracks()) {
                vector(t.range(),2); unit(t.range().get(0)); unit(t.range().get(1));
                if(t.range().get(0)>=t.range().get(1) || !owned.add(t.node()+":"+t.type())) fail();
                if(t.type().equals("translate")) vector(t.offset(),3);
                else {
                    vector(t.axis(),3);
                    double length=Math.sqrt(t.axis().stream().mapToDouble(v -> v*v).sum());
                    if(Math.abs(length-1)>0.001 || t.angle()==null) fail();
                    finite(t.angle()); if(Math.abs(t.angle())>Math.PI) fail();
                }
            }
        }
    }
    private static void unit(double value) { finite(value); if(value<0 || value>1) fail(); }
    private static void finite(double value) { if(!Double.isFinite(value)) fail(); }
    private static void vector(List<Double> values,int size) { if(values==null || values.size()!=size || values.stream().anyMatch(v -> v==null || !Double.isFinite(v))) fail(); }
    private static void fail() { throw new IllegalArgumentException("Invalid v3 motion configuration"); }
}

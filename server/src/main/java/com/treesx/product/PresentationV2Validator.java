package com.treesx.product;

import java.util.HashSet;
import java.util.List;

final class PresentationV2Validator {
    private PresentationV2Validator() {}
    static void validate(Presentation p) {
        var source = p.source();
        if (p.version() == 1 && (!source.kind().equals("procedural") || p.stage() != null)) fail();
        if (p.version() >= 2) {
            var s = p.stage();
            if (s == null) fail();
            finite(s.groundY(), s.exposure(), s.environmentIntensity(), s.ambient(), s.key().intensity(), s.rim().intensity());
            vector(s.key().position()); vector(s.rim().position());
            if (s.environmentFile() != null) relative(s.environmentFile());
        }
        if (source.kind().equals("procedural")) {
            if (!List.of("speaker", "typewriter", "car").contains(source.key())) fail();
            if (p.actions().stream().anyMatch(a -> a.behavior() != null)) fail();
            if (p.stage() != null && p.stage().environmentFile() != null) fail();
            return;
        }
        if (p.version() < 2 || source.adapter()==null || !List.of("pbr-v1","typewriter-v1","piano-v1","reventon-v1").contains(source.adapter()) || source.bundle() == null ||
            source.transform() == null || source.finishMaterials() == null || source.explode() == null) fail();
        local(source.bundle().manifest());
        vector(source.transform().position()); vector(source.transform().rotation()); finite(source.transform().scale());
        if (new HashSet<>(source.finishMaterials()).size() != source.finishMaterials().size() ||
            source.explode().stream().map(Presentation.Explosion::node).distinct().count() != source.explode().size() ||
            p.structure() != (!source.explode().isEmpty() || p.structureActionId()!=null) ||
            (p.structureActionId()!=null && !source.explode().isEmpty()) ||
            (p.finishes().size() > 1 && source.finishMaterials().isEmpty())) fail();
        source.explode().forEach(e -> vector(e.offset()));
        p.actions().forEach(a -> {
            if (a.kind().equals("progress")) return;
            var b = a.behavior();
            if (b == null) fail();
            if(b.type().equals("typewriter-strike")) {
                if(!"typewriter-v1".equals(source.adapter()) || p.version()!=3 || !a.kind().equals("pulse") ||
                    b.axis()!=null || (b.amount()!=null && b.amount()!=0) || b.index()==null || b.index()<0 || b.index()>43) fail();
                return;
            }
            if(b.amount()==null) fail();
            vector(b.axis()); finite(b.amount());
            double length = Math.sqrt(b.axis().stream().mapToDouble(v -> v*v).sum());
            if (Math.abs(length-1) > 0.001) fail();
        });
    }
    static void local(String path) { if (path == null || !path.startsWith("/")) fail(); relative(path.substring(1)); }
    static void relative(String path) {
        if (path==null || !path.matches("[a-zA-Z0-9_.\\-/]+")) fail();
        for (String part : path.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) fail();
    }
    private static void finite(double... values) { for (double value : values) if (!Double.isFinite(value)) fail(); }
    private static void vector(List<Double> values) {
        if (values == null || values.size() != 3 || values.stream().anyMatch(v -> v == null || !Double.isFinite(v))) fail();
    }
    private static void fail() { throw new IllegalArgumentException("Invalid v2 presentation configuration"); }
}

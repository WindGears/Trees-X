package com.treesx.product;

import jakarta.validation.Validator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class PresentationValidator {
    private PresentationValidator() {}
    public static void validate(Presentation p, Validator validator) {
        if (p == null || !validator.validate(p).isEmpty()) fail();
        PresentationV2Validator.validate(p);
        PresentationV3Validator.validate(p);
        if (p.camera().maxDistance() <= p.camera().minDistance()) fail();
        vector(p.camera().position()); vector(p.camera().target());
        Set<String> views = unique(p.views().stream().map(Presentation.View::id).toList());
        Set<String> hotspots = unique(p.hotspots().stream().map(Presentation.Hotspot::id).toList());
        Set<String> actions = unique(p.actions().stream().map(Presentation.Action::id).toList());
        unique(p.finishes().stream().map(Presentation.Finish::id).toList());
        unique(p.guide().stream().map(Presentation.Guide::id).toList());
        if (!views.contains("perspective")) fail();
        p.views().forEach(v -> { vector(v.position()); vector(v.target()); });
        p.hotspots().forEach(h -> vector(h.cameraOffset()));
        p.guide().forEach(g -> {
            if (g.view() != null && !views.contains(g.view())) fail();
            if (g.hotspotId() != null && !hotspots.contains(g.hotspotId())) fail();
            if (g.actionId() != null && !actions.contains(g.actionId())) fail();
            if (Boolean.TRUE.equals(g.explode()) && !p.structure()) fail();
        });
    }
    private static Set<String> unique(List<String> ids) {
        Set<String> set = new HashSet<>(ids);
        if (set.size() != ids.size()) fail();
        return set;
    }
    private static void vector(List<Double> values) {
        if (values.stream().anyMatch(v -> v == null || !Double.isFinite(v))) fail();
    }
    private static void fail() { throw new IllegalArgumentException("Invalid presentation configuration"); }
}

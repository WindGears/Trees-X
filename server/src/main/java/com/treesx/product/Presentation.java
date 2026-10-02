package com.treesx.product;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public record Presentation(
    @Min(1) @Max(1) int version, @NotNull @Valid Source source,
    @NotNull @Valid Camera camera, @NotEmpty List<@Valid View> views,
    @NotNull List<@Valid Hotspot> hotspots, @NotEmpty List<@Valid Finish> finishes,
    @NotNull List<@Valid Action> actions, boolean structure, @NotNull List<@Valid Guide> guide
) {
    public record Source(@Pattern(regexp="procedural") @NotNull String kind,
                         @Pattern(regexp="speaker|typewriter|car") @NotNull String key) {}
    public record Camera(@NotNull @Size(min=3,max=3) List<Double> position,
                         @NotNull @Size(min=3,max=3) List<Double> target,
                         @Positive double minDistance, @Positive double maxDistance) {}
    public record View(@NotBlank String id, @NotBlank String label,
                       @NotNull @Size(min=3,max=3) List<Double> position,
                       @NotNull @Size(min=3,max=3) List<Double> target) {}
    public record Hotspot(@NotBlank String id, @NotBlank String node, @NotBlank String name,
                          @NotBlank String description,
                          @NotNull @Size(min=3,max=3) List<Double> cameraOffset) {}
    public record Finish(@NotBlank String id, @NotBlank String name,
                         @NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String color) {}
    public record Action(@NotBlank String id, @NotBlank String label,
                         @NotNull @Pattern(regexp="toggle|pulse") String kind, @NotBlank String node) {}
    public record Guide(@NotBlank String id, @NotBlank String title, @NotBlank String description,
                        String view, String hotspotId, String actionId, Boolean explode, Boolean overview) {}
}


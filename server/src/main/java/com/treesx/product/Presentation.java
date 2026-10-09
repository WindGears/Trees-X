package com.treesx.product;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public record Presentation(
    @Min(1) @Max(3) int version, @NotNull @Valid Source source,
    @NotNull @Valid Camera camera, @NotEmpty List<@Valid View> views,
    @NotNull List<@Valid Hotspot> hotspots, @NotEmpty List<@Valid Finish> finishes,
    @NotNull List<@Valid Action> actions, boolean structure, @NotNull List<@Valid Guide> guide,
    @Valid Stage stage, String structureActionId
) {
    public record Source(@Pattern(regexp="procedural|glb") @NotNull String kind,
                         String key, String adapter, @Valid Bundle bundle, @Valid Transform transform,
                         List<@NotBlank String> finishMaterials, List<@Valid Explosion> explode) {}
    public record Bundle(@NotBlank String manifest, @NotBlank String id, @Positive int version,
                         @NotNull @Pattern(regexp="[a-f0-9]{64}") String sha256) {}
    public record Transform(@NotNull @Size(min=3,max=3) List<Double> position,
                            @NotNull @Size(min=3,max=3) List<Double> rotation, @Positive double scale) {}
    public record Explosion(@NotBlank String node, @NotNull @Size(min=3,max=3) List<Double> offset) {}
    public record Light(@NotNull @Size(min=3,max=3) List<Double> position,
                        @NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String color, @Positive double intensity) {}
    public record Stage(@NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String background,
                        @NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String ground,
                        double groundY, @Positive double exposure, @Positive double environmentIntensity,
                        String environmentFile, @Positive double ambient, @NotNull @Valid Light key,
                        @NotNull @Valid Light rim) {}
    public record Camera(@NotNull @Size(min=3,max=3) List<Double> position,
                         @NotNull @Size(min=3,max=3) List<Double> target,
                         @Positive double minDistance, @Positive double maxDistance) {}
    public record View(@NotBlank String id, @NotBlank String label,
                       @NotNull @Size(min=3,max=3) List<Double> position,
                       @NotNull @Size(min=3,max=3) List<Double> target) {}
    public record Hotspot(@NotBlank String id, @NotBlank String node, @NotBlank String name,
                          @NotBlank String description,
                          @NotNull @Size(min=3,max=3) List<Double> cameraOffset,
                          @Size(min=3,max=3) List<Double> anchor, String group, Boolean marker) {}
    public record Finish(@NotBlank String id, @NotBlank String name,
                         @NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String color) {}
    public record Action(@NotBlank String id, @NotBlank String label,
                         @NotNull @Pattern(regexp="toggle|pulse|progress") String kind, @NotBlank String node,
                         @Valid Behavior behavior, @Valid Motion motion) {}
    public record Motion(@Positive double duration, @NotBlank String openLabel, @NotBlank String closeLabel,
                         List<@Valid Track> tracks, @Valid Program program) {}
    public record Program(@NotNull @Pattern(regexp="typewriter-layout-v1|piano-sound-path-v1") String type, @NotBlank String file) {}
    public record Track(@NotBlank String node, @NotNull @Pattern(regexp="translate|rotate") String type,
                        @NotNull @Size(min=2,max=2) List<Double> range,
                        @Size(min=3,max=3) List<Double> offset, @Size(min=3,max=3) List<Double> axis, Double angle) {}
    public record Progress(@NotBlank String actionId, double value) {}
    public record Behavior(@NotNull @Pattern(regexp="rotate|translate|typewriter-strike") String type,
                           @Size(min=3,max=3) List<Double> axis, Double amount, Integer index) {}
    public record Guide(@NotBlank String id, @NotBlank String title, @NotBlank String description,
                        String view, String hotspotId, String actionId, Boolean explode, Boolean overview,
                        @Valid Progress progress) {}
}

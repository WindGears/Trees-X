package com.treesx;

import com.treesx.product.Presentation;
import com.treesx.product.PresentationValidator;
import com.treesx.product.ProductDto;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ReventonPresentationContractTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final String DOORS = """
        {"id":"open-doors","label":"Open doors","kind":"progress","node":"car-product",
         "motion":{"duration":2,"openLabel":"Open doors","closeLabel":"Close doors","tracks":[
           {"node":"door-left","type":"rotate","range":[0,1],"axis":[1,0,0],"angle":-1.15},
           {"node":"door-right","type":"rotate","range":[0,1],"axis":[1,0,0],"angle":-1.15}]}}
        """;
    private static final String PARTS = """
        {"id":"explore-parts","label":"Explore parts","kind":"progress","node":"car-product",
         "motion":{"duration":3,"openLabel":"Separate parts","closeLabel":"Assemble car","tracks":[
           {"node":"body","type":"translate","range":[0.3,1],"offset":[0,1,0]},
           {"node":"cabin","type":"translate","range":[0.3,1],"offset":[0,0.4,0]},
           {"node":"door-left","type":"translate","range":[0,0.7],"offset":[0,0,1]},
           {"node":"door-right","type":"translate","range":[0,0.7],"offset":[0,0,-1]},
           {"node":"wheels-front","type":"translate","range":[0,0.7],"offset":[1,0,0]},
           {"node":"wheels-rear","type":"translate","range":[0,0.7],"offset":[-1,0,0]},
           {"node":"engine-cover","type":"translate","range":[0.3,1],"offset":[0,1,0]}]}}
        """;
    private static final String FIXTURE = """
        {"version":3,
         "source":{"kind":"glb","adapter":"reventon-v1",
                   "bundle":{"id":"reventon-contract","version":1,
                             "manifest":"/models/bundles/reventon-contract/v1/manifest.json","sha256":"%s"},
                   "transform":{"position":[0,0,0],"rotation":[0,0,0],"scale":1},
                   "finishMaterials":[],"explode":[]},
         "camera":{"position":[3,2,5],"target":[0,1,0],"minDistance":1,"maxDistance":12},
         "views":[{"id":"perspective","label":"Overview","position":[3,2,5],"target":[0,1,0]}],
         "hotspots":[{"id":"door-left","node":"door-left","name":"Left door","description":"Contract fixture only",
                      "cameraOffset":[1,1,2],"anchor":[0.2,0.1,0]}],
         "finishes":[{"id":"default","name":"Original material","color":"#202020"}],
         "actions":[%s,%s],"structure":true,"structureActionId":"explore-parts",
         "guide":[{"id":"doors","title":"Doors","description":"Contract fixture only","view":"perspective",
                   "hotspotId":"door-left","progress":{"actionId":"open-doors","value":0.6}},
                  {"id":"parts","title":"Parts","description":"Contract fixture only",
                   "progress":{"actionId":"explore-parts","value":0.5}}],
         "stage":{"background":"#e8e3db","ground":"#c9c2b8","groundY":0,"exposure":1,
                  "environmentIntensity":1,"ambient":1,
                  "key":{"position":[3,6,4],"color":"#ffffff","intensity":1},
                  "rim":{"position":[-4,3,-2],"color":"#ffffff","intensity":1}}}
        """.formatted("0".repeat(64), DOORS, PARTS);

    private static Presentation validate(String json) throws Exception {
        var presentation = MAPPER.readValue(json, Presentation.class);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            PresentationValidator.validate(presentation, factory.getValidator());
        }
        return presentation;
    }

    private static void rejects(String json) {
        assertThrows(IllegalArgumentException.class, () -> validate(json));
    }

    @Test
    void twoIndependentProgressActionsShareExistingTrackContract() throws Exception {
        var p = validate(FIXTURE);
        assertEquals("reventon-v1", p.source().adapter());
        assertEquals("explore-parts", p.structureActionId());
        assertEquals(2, p.actions().size());
        assertEquals(2, p.actions().get(0).motion().tracks().size());
        assertEquals(7, p.actions().get(1).motion().tracks().size());
        assertTrue(p.actions().stream().allMatch(a -> a.motion().program() == null));
        assertEquals(p, validate(MAPPER.writeValueAsString(p)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"execute-js", "custom-adapter"})
    void adapterMustBeRegistered(String adapter) {
        rejects(FIXTURE.replace("reventon-v1", adapter));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2})
    void progressAndLocalAnchorsRequireV3(int version) {
        rejects(FIXTURE.replace("\"version\":3", "\"version\":" + version));
    }

    @Test
    void v2GlbStillWorksButV1CannotDeclareGlb() throws Exception {
        var p = validate(FIXTURE);
        var v2 = new Presentation(2, p.source(), p.camera(), p.views(), List.of(), p.finishes(), List.of(),
            false, List.of(), p.stage(), null);
        assertEquals(v2, validate(MAPPER.writeValueAsString(v2)));
        rejects(MAPPER.writeValueAsString(v2).replace("\"version\":2", "\"version\":1"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"typewriter-layout-v1", "piano-sound-path-v1", "execute-js"})
    void carCannotAcquireRegisteredOrExecutablePrograms(String program) {
        var action = """
            {"id":"open-doors","label":"Doors","kind":"progress","node":"car-product",
             "motion":{"duration":2,"openLabel":"Open","closeLabel":"Close",
                       "program":{"type":"%s","file":"rig.json"}}}
            """.formatted(program);
        rejects(FIXTURE.replace(DOORS, action));
    }

    @Test
    void differentTransformChannelsCombineButDuplicateOwnersAreRejected() {
        // The valid fixture controls door rotation and translation independently.
        rejects(FIXTURE.replace("\"node\":\"door-right\",\"type\":\"rotate\"",
            "\"node\":\"door-left\",\"type\":\"rotate\""));
        rejects(FIXTURE.replace("\"node\":\"door-right\",\"type\":\"translate\"",
            "\"node\":\"door-left\",\"type\":\"translate\""));
        rejects(FIXTURE.replace("\"explode\":[]",
            "\"explode\":[{\"node\":\"door-left\",\"offset\":[0,0,1]}]"));
    }

    @Test
    void rejectsInvalidRotationRangesAnchorsAndSemanticReferences() {
        for (var json : List.of(
            FIXTURE.replace("\"angle\":-1.15", "\"angle\":4.0"),
            FIXTURE.replace("\"axis\":[1,0,0]", "\"axis\":[2,0,0]"),
            FIXTURE.replace("\"range\":[0.3,1]", "\"range\":[0.7,0.4]"),
            FIXTURE.replace("\"anchor\":[0.2,0.1,0]", "\"anchor\":[0.2,0.1]"),
            FIXTURE.replace("\"hotspotId\":\"door-left\"", "\"hotspotId\":\"missing\""),
            FIXTURE.replace("\"view\":\"perspective\"", "\"view\":\"missing\""),
            FIXTURE.replace("\"actionId\":\"open-doors\"", "\"actionId\":\"missing\""),
            FIXTURE.replace("\"value\":0.6", "\"value\":1.1"),
            FIXTURE.replace("\"structureActionId\":\"explore-parts\"", "\"structureActionId\":\"missing\""))) {
            rejects(json);
        }
    }

    @Test
    void existingV1V2V3AndRegisteredTypewriterContractsRemainValid() throws Exception {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            for (var resource : List.of("/samples/products.json", "/samples/progress-products.json")) {
                try (var input = getClass().getResourceAsStream(resource)) {
                    assertNotNull(input, resource);
                    for (var product : MAPPER.readValue(input, ProductDto[].class)) {
                        PresentationValidator.validate(product.presentation(), factory.getValidator());
                    }
                }
            }
            for (var resource : List.of("/fixtures/speaker-glb-v2.json", "/presentations/typewriter-kimi-v1.json")) {
                try (var input = getClass().getResourceAsStream(resource)) {
                    assertNotNull(input, resource);
                    var product = MAPPER.readValue(input, ProductDto.class);
                    PresentationValidator.validate(product.presentation(), factory.getValidator());
                }
            }
        }
    }
}

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

class PianoPresentationContractTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final String ACTION = """
        {"id":"sound-path","label":"Explore sound path","kind":"progress","node":"piano-product",
         "motion":{"duration":7,"openLabel":"Explore structure","closeLabel":"Restore piano",
                   "program":{"type":"piano-sound-path-v1","file":"rig.json"}}}
        """;
    private static final String FIXTURE = """
        {"version":3,
         "source":{"kind":"glb","adapter":"piano-v1",
                   "bundle":{"id":"piano-contract","version":1,
                             "manifest":"/models/bundles/piano-contract/v1/manifest.json","sha256":"%s"},
                   "transform":{"position":[0,0,0],"rotation":[0,0,0],"scale":1},
                   "finishMaterials":[],"explode":[]},
         "camera":{"position":[3,2,5],"target":[0,1,0],"minDistance":1,"maxDistance":12},
         "views":[{"id":"perspective","label":"Overview","position":[3,2,5],"target":[0,1,0]}],
         "hotspots":[],"finishes":[{"id":"default","name":"Original material","color":"#202020"}],
         "actions":[%s],"structure":true,"structureActionId":"sound-path",
         "guide":[{"id":"overview","title":"Complete structure","description":"Contract fixture only",
                   "progress":{"actionId":"sound-path","value":0}}],
         "stage":{"background":"#151c25","ground":"#05080d","groundY":0,"exposure":1,
                  "environmentIntensity":1,"ambient":1,
                  "key":{"position":[3,6,4],"color":"#eef5ff","intensity":1},
                  "rim":{"position":[-4,3,-2],"color":"#afbdd4","intensity":1}}}
        """.formatted("0".repeat(64), ACTION);

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
    void registeredPianoProgramAndGuideSurviveJsonRoundTrip() throws Exception {
        var presentation = validate(FIXTURE);
        assertEquals("piano-v1", presentation.source().adapter());
        assertEquals("piano-sound-path-v1", presentation.actions().get(0).motion().program().type());
        assertEquals("sound-path", presentation.structureActionId());
        assertEquals(presentation, validate(MAPPER.writeValueAsString(presentation)));
        assertEquals("motion/rig-v1.json", validate(FIXTURE.replace("rig.json", "motion/rig-v1.json"))
            .actions().get(0).motion().program().file());
    }

    @ParameterizedTest
    @ValueSource(strings = {"pbr-v1", "typewriter-v1", "execute-js"})
    void rejectsWrongAdapter(String adapter) {
        rejects(FIXTURE.replace("piano-v1", adapter));
    }

    @ParameterizedTest
    @ValueSource(strings = {"typewriter-layout-v1", "execute-js"})
    void rejectsWrongProgram(String program) {
        rejects(FIXTURE.replace("piano-sound-path-v1", program));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2})
    void pianoRequiresV3(int version) {
        rejects(FIXTURE.replace("\"version\":3", "\"version\":" + version));
    }

    @ParameterizedTest
    @ValueSource(strings = {"../rig.json", "/rig.json", "https://example.com/rig.json", "motion//rig.json",
        "motion/./rig.json", "motion\\rig.json", "rig.json?code=1", ""})
    void rejectsUnsafeMotionFile(String file) throws Exception {
        rejects(FIXTURE.replace("\"rig.json\"", MAPPER.writeValueAsString(file)));
    }

    @Test
    void requiresOneProgressProgramAndMatchingStructureReference() {
        for (var json : List.of(
            FIXTURE.replace(ACTION, ""),
            FIXTURE.replace(ACTION, ACTION + "," + ACTION.replace("\"id\":\"sound-path\"", "\"id\":\"other-progress\"")),
            FIXTURE.replace("\"structureActionId\":\"sound-path\"", "\"structureActionId\":\"missing\""),
            FIXTURE.replace("\"structureActionId\":\"sound-path\"", "\"structureActionId\":null"),
            FIXTURE.replace("\"structure\":true", "\"structure\":false"),
            FIXTURE.replace("\"kind\":\"progress\"", "\"kind\":\"toggle\""),
            FIXTURE.replace("\"program\":{\"type\":\"piano-sound-path-v1\",\"file\":\"rig.json\"}", "\"program\":null")
        )) rejects(json);
    }

    @Test
    void rejectsTracksExplosionsAndEveryOtherBehavior() {
        String program = "\"program\":{\"type\":\"piano-sound-path-v1\",\"file\":\"rig.json\"}";
        String tracks = "\"tracks\":[{\"node\":\"key\",\"type\":\"translate\",\"range\":[0,1],\"offset\":[0,-0.01,0]}]";
        String rotate = "{\"id\":\"rotate-key\",\"label\":\"Other action\",\"kind\":\"toggle\",\"node\":\"key\",\"behavior\":{\"type\":\"rotate\",\"axis\":[1,0,0],\"amount\":1}}";
        String strike = "{\"id\":\"strike\",\"label\":\"Typewriter strike\",\"kind\":\"pulse\",\"node\":\"key\",\"behavior\":{\"type\":\"typewriter-strike\",\"index\":0}}";
        for (var json : List.of(
            FIXTURE.replace(program, program + "," + tracks),
            FIXTURE.replace(program, tracks),
            FIXTURE.replace("\"explode\":[]", "\"explode\":[{\"node\":\"key\",\"offset\":[0,1,0]}]"),
            FIXTURE.replace("\"node\":\"piano-product\",", "\"node\":\"piano-product\",\"behavior\":{\"type\":\"translate\",\"axis\":[0,1,0],\"amount\":1},"),
            FIXTURE.replace(ACTION, ACTION + "," + rotate),
            FIXTURE.replace(ACTION, ACTION + "," + strike)
        )) rejects(json);
    }

    @Test
    void keepsTypewriterAndTrackContractsCompatible() throws Exception {
        try (var factory = Validation.buildDefaultValidatorFactory();
             var typewriterInput = getClass().getResourceAsStream("/presentations/typewriter-kimi-v1.json");
             var trackInput = getClass().getResourceAsStream("/samples/progress-products.json")) {
            var typewriter = MAPPER.readValue(typewriterInput, ProductDto.class);
            PresentationValidator.validate(typewriter.presentation(), factory.getValidator());
            assertEquals("typewriter-v1", typewriter.presentation().source().adapter());
            var samples = MAPPER.readValue(trackInput, ProductDto[].class);
            assertEquals(2, samples.length);
            for (var sample : samples) PresentationValidator.validate(sample.presentation(), factory.getValidator());
        }
    }
}

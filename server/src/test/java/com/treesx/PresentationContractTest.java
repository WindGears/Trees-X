package com.treesx;
import com.treesx.product.*;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class PresentationContractTest {
    @Test void typewriterProgramIsRegisteredAndPreservedWithoutExecutingConfiguration() throws Exception {
        var mapper=JsonMapper.builder().build();
        try(var factory=Validation.buildDefaultValidatorFactory();var input=getClass().getResourceAsStream("/presentations/typewriter-kimi-v1.json")) {
            var product=mapper.readValue(input,ProductDto.class);
            PresentationValidator.validate(product.presentation(),factory.getValidator());
            assertEquals(572,product.presentation().hotspots().size());
            assertEquals("typewriter-v1",product.presentation().source().adapter());
            String json=mapper.writeValueAsString(product.presentation());
            assertEquals(product.presentation(),mapper.readValue(json,Presentation.class));
            for(var invalid:java.util.List.of(json.replace("typewriter-v1","pbr-v1"),
                json.replace("typewriter-layout-v1","execute-js"),json.replace("rig.json","../rig.json"),
                json.replace("\"index\":23","\"index\":44"))) {
                assertThrows(IllegalArgumentException.class,()->PresentationValidator.validate(mapper.readValue(invalid,Presentation.class),factory.getValidator()));
            }
        }
    }
    @Test void samplesAreValidAndBrokenReferencesAreRejected() throws Exception {
        var mapper=JsonMapper.builder().build();
        try (var factory=Validation.buildDefaultValidatorFactory();
             var input=getClass().getResourceAsStream("/samples/products.json")) {
            var samples=mapper.readValue(input,ProductDto[].class);
            assertEquals(3,samples.length);
            for (var item:samples) PresentationValidator.validate(item.presentation(),factory.getValidator());
            String json=mapper.writeValueAsString(samples[0].presentation());
            var bad=mapper.readValue(json.replace("\"hotspotId\":\"driver\"","\"hotspotId\":\"missing\""),Presentation.class);
            assertThrows(IllegalArgumentException.class,() -> PresentationValidator.validate(bad,factory.getValidator()));
            var version=mapper.readValue(json.replace("\"version\":1","\"version\":3"),Presentation.class);
            assertThrows(IllegalArgumentException.class,() -> PresentationValidator.validate(version,factory.getValidator()));
        }
    }
    @Test void v2GlbAndStageAreValidatedWithoutAllowingExecutableAdapters() throws Exception {
        var mapper=JsonMapper.builder().build();
        try(var factory=Validation.buildDefaultValidatorFactory();
            var input=getClass().getResourceAsStream("/fixtures/speaker-glb-v2.json")) {
            var product=mapper.readValue(input,ProductDto.class);
            PresentationValidator.validate(product.presentation(),factory.getValidator());
            String json=mapper.writeValueAsString(product.presentation());
            var invalid=mapper.readValue(json.replace("pbr-v1","eval"),Presentation.class);
            assertThrows(IllegalArgumentException.class,() -> PresentationValidator.validate(invalid,factory.getValidator()));
            var remote=mapper.readValue(json.replace("/models/bundles/","https://example.com/"),Presentation.class);
            assertThrows(IllegalArgumentException.class,() -> PresentationValidator.validate(remote,factory.getValidator()));
        }
    }
    @Test void v3ProgressContractsRejectConflictsAndInvalidTracks() throws Exception {
        var mapper=JsonMapper.builder().build();
        try(var factory=Validation.buildDefaultValidatorFactory();var input=getClass().getResourceAsStream("/samples/progress-products.json")) {
            var products=mapper.readValue(input,ProductDto[].class);
            assertEquals(2,products.length);
            for(var product:products) PresentationValidator.validate(product.presentation(),factory.getValidator());
            var speaker=mapper.writeValueAsString(products[0].presentation());
            for(var json:java.util.List.of(
                speaker.replace("\"version\":3","\"version\":2"),
                speaker.replace("\"structureActionId\":\"explore-layers\"","\"structureActionId\":\"missing\""),
                speaker.replace("\"value\":0.7","\"value\":1.1"),
                speaker.replace("\"range\":[0.0,0.55]","\"range\":[0.8,0.2]"),
                speaker.replace("\"type\":\"translate\"","\"type\":\"rotate\""))) {
                var invalid=mapper.readValue(json,Presentation.class);
                assertThrows(IllegalArgumentException.class,()->PresentationValidator.validate(invalid,factory.getValidator()));
            }
            var car=mapper.writeValueAsString(products[1].presentation());
            for(var json:java.util.List.of(car.replace("\"angle\":-1.15","\"angle\":4.0"),car.replace("\"axis\":[1.0,0.0,0.0]","\"axis\":[2.0,0.0,0.0]"),car.replace("door-right","door-left"))) {
                assertThrows(IllegalArgumentException.class,()->PresentationValidator.validate(mapper.readValue(json,Presentation.class),factory.getValidator()));
            }
        }
    }
}

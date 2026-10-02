package com.treesx;
import com.treesx.product.*;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class PresentationContractTest {
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
            var version=mapper.readValue(json.replace("\"version\":1","\"version\":2"),Presentation.class);
            assertThrows(IllegalArgumentException.class,() -> PresentationValidator.validate(version,factory.getValidator()));
        }
    }
}


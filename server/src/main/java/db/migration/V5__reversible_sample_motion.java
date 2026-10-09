package db.migration;

import com.treesx.product.*;
import jakarta.validation.Validation;
import java.sql.Connection;
import java.util.Arrays;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.json.JsonMapper;

public class V5__reversible_sample_motion extends BaseJavaMigration {
    @Override public void migrate(Context context) throws Exception { upgrade(context.getConnection()); }

    public static void upgrade(Connection connection) throws Exception {
        var mapper=JsonMapper.builder().build();
        var log=LoggerFactory.getLogger(V5__reversible_sample_motion.class);
        try(var original=V5__reversible_sample_motion.class.getResourceAsStream("/samples/products.json");
            var replacement=V5__reversible_sample_motion.class.getResourceAsStream("/samples/progress-products.json");
            var factory=Validation.buildDefaultValidatorFactory()) {
            if(original==null || replacement==null) throw new IllegalStateException("Missing motion sample contract");
            var defaults=mapper.readValue(original,ProductDto[].class);
            var upgraded=mapper.readValue(replacement,ProductDto[].class);
            for(var item:upgraded) {
                PresentationValidator.validate(item.presentation(),factory.getValidator());
                var expected=Arrays.stream(defaults).filter(d -> d.slug().equals(item.slug())).findFirst().orElseThrow().presentation();
                try(var read=connection.prepareStatement("SELECT schema_version,config_json FROM presentations WHERE slug=? FOR UPDATE")) {
                    read.setString(1,item.slug());
                    try(var row=read.executeQuery()) {
                        if(!row.next()) { log.info("Motion migration skipped {}: absent product",item.slug()); continue; }
                        boolean matches=false;
                        if(row.getInt(1)==expected.version()) {
                            try { matches=expected.equals(mapper.readValue(row.getString(2),Presentation.class)); }
                            catch(RuntimeException ignored) { /* Preserve unrecognized/custom data. */ }
                        }
                        if(!matches) { log.info("Motion migration skipped {}: custom or already upgraded configuration preserved",item.slug()); continue; }
                    }
                }
                try(var write=connection.prepareStatement("UPDATE presentations SET schema_version=3,config_json=? WHERE slug=?")) {
                    write.setString(1,mapper.writeValueAsString(item.presentation())); write.setString(2,item.slug()); write.executeUpdate();
                    log.info("Motion migration upgraded {} to v3; product metadata retained",item.slug());
                }
            }
        }
    }
}

package db.migration;

import com.treesx.product.*;
import jakarta.validation.Validation;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import tools.jackson.databind.json.JsonMapper;

public class V2__seed_samples extends BaseJavaMigration {
    @Override public void migrate(Context context) throws Exception {
        var mapper=JsonMapper.builder().build();
        try (var input=getClass().getResourceAsStream("/samples/products.json");
             var factory=Validation.buildDefaultValidatorFactory()) {
            if (input==null) throw new IllegalStateException("Missing sample data");
            ProductDto[] samples=mapper.readValue(input,ProductDto[].class);
            try (var product=context.getConnection().prepareStatement(
                    "INSERT INTO products (slug,name,category,description,sort_order) VALUES (?,?,?,?,?)");
                 var config=context.getConnection().prepareStatement(
                    "INSERT INTO presentations (slug,schema_version,config_json) VALUES (?,?,?)")) {
                int order=0;
                for (ProductDto item:samples) {
                    PresentationValidator.validate(item.presentation(),factory.getValidator());
                    product.setString(1,item.slug()); product.setString(2,item.name());
                    product.setString(3,item.category()); product.setString(4,item.description());
                    product.setInt(5,order++); product.executeUpdate();
                    config.setString(1,item.slug()); config.setInt(2,item.presentation().version());
                    config.setString(3,mapper.writeValueAsString(item.presentation())); config.executeUpdate();
                }
            }
        }
    }
}


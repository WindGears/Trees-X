package com.treesx;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.core.io.ClassPathResource;
import org.flywaydb.core.Flyway;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TREES_MYSQL_TEST", matches="true")
class MysqlPersistenceTest {
    private static final String[] ARGS = {
        "--server.port=0",
        "--spring.datasource.url=jdbc:mysql://127.0.0.1:3306/trees_x_test?createDatabaseIfNotExist=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai"
    };
    private String get(int port,String path,int status) throws Exception {
        var response=HttpClient.newHttpClient().send(
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).GET().build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(status,response.statusCode(),response.body());
        return response.body();
    }
    @Test void motionMigrationUpgradesOnlyDefaultsAndPreservesCustomData() throws Exception {
        try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
            var jdbc=context.getBean(JdbcTemplate.class);
            var mapper=context.getBean(tools.jackson.databind.ObjectMapper.class);
            String original=jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class);
            int originalSchema=jdbc.queryForObject("SELECT schema_version FROM presentations WHERE slug='form-01'",Integer.class);
            String description=jdbc.queryForObject("SELECT description FROM products WHERE slug='form-01'",String.class);
            String cover=jdbc.queryForObject("SELECT cover FROM products WHERE slug='form-01'",String.class);
            Runnable migrate=()->jdbc.execute((ConnectionCallback<Void>) connection -> {
                try { db.migration.V5__reversible_sample_motion.upgrade(connection); return null; }
                catch(Exception e) { throw new IllegalStateException(e); }
            });
            try(var input=getClass().getResourceAsStream("/samples/products.json")) {
                var seed=mapper.readValue(input,com.treesx.product.ProductDto[].class)[0];
                String config=mapper.writeValueAsString(seed.presentation());
                try {
                    String custom=config.replace("转动旋钮","自定义控制件");
                    jdbc.update("UPDATE presentations SET schema_version=1,config_json=? WHERE slug='form-01'",custom);
                    migrate.run();
                    assertEquals(1,jdbc.queryForObject("SELECT schema_version FROM presentations WHERE slug='form-01'",Integer.class));
                    assertEquals(mapper.readTree(custom),mapper.readTree(jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class)));
                    jdbc.update("UPDATE presentations SET config_json=? WHERE slug='form-01'",config);
                    migrate.run();
                    assertEquals(3,jdbc.queryForObject("SELECT schema_version FROM presentations WHERE slug='form-01'",Integer.class));
                    int port=((WebServerApplicationContext)context).getWebServer().getPort();
                    assertTrue(get(port,"/api/v1/products/form-01",200).contains("explore-layers"));
                    var upgraded=mapper.readTree(jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class));
                    migrate.run();
                    assertEquals(upgraded,mapper.readTree(jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class)));
                    assertEquals(description,jdbc.queryForObject("SELECT description FROM products WHERE slug='form-01'",String.class));
                    assertEquals(cover,jdbc.queryForObject("SELECT cover FROM products WHERE slug='form-01'",String.class));
                } finally { jdbc.update("UPDATE presentations SET schema_version=?,config_json=? WHERE slug='form-01'",originalSchema,original); }
            }
        }
    }
    @Test void coverMigrationFillsMissingMetadataAndPreservesCustomCovers() throws Exception {
        try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
            var jdbc=context.getBean(JdbcTemplate.class);
            String original=jdbc.queryForObject("SELECT cover FROM products WHERE slug='form-01'",String.class);
            Runnable migrate=() -> jdbc.execute((ConnectionCallback<Void>) connection -> {
                ScriptUtils.executeSqlScript(connection,new ClassPathResource("db/migration/V4__workflow_sample_covers.sql"));
                return null;
            });
            try {
                jdbc.update("UPDATE products SET cover=NULL WHERE slug='form-01'");
                migrate.run();
                assertEquals("/covers/workbench/form-01.png",jdbc.queryForObject("SELECT cover FROM products WHERE slug='form-01'",String.class));
                int port=((WebServerApplicationContext)context).getWebServer().getPort();
                assertTrue(get(port,"/api/v1/products/form-01",200).contains("/covers/workbench/form-01.png"));
                jdbc.update("UPDATE products SET cover='/covers/custom.png' WHERE slug='form-01'");
                migrate.run();
                assertEquals("/covers/custom.png",jdbc.queryForObject("SELECT cover FROM products WHERE slug='form-01'",String.class));
            } finally { jdbc.update("UPDATE products SET cover=? WHERE slug='form-01'",original); }
        }
    }
    @Test void mysqlMigrationApiAndRestartPreserveData() throws Exception {
        String original, originalConfig;
        int originalSchema;
        try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
            var jdbc=context.getBean(JdbcTemplate.class);
            assertEquals("trees_x_test",jdbc.queryForObject("SELECT DATABASE()",String.class));
            original=jdbc.queryForObject("SELECT description FROM products WHERE slug='form-01'",String.class);
            int port=((WebServerApplicationContext)context).getWebServer().getPort();
            assertTrue(get(port,"/api/v1/products",200).contains("typewriter-study"));
            assertEquals("[]",get(port,"/api/v1/products?q=not-a-product",200));
            assertFalse(get(port,"/api/v1/products?category=%E6%9C%BA%E6%A2%B0",200).contains("form-01"));
            assertTrue(get(port,"/api/v1/products/reventon",200).contains("open-doors"));
            get(port,"/api/v1/products/missing",404);
            var post=HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                URI.create("http://127.0.0.1:"+port+"/api/v1/products")).POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
            // Public writes are denied by the security/CSRF boundary before controller dispatch.
            assertEquals(403,post.statusCode());
            String config=jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class);
            originalConfig=config;
            originalSchema=jdbc.queryForObject("SELECT schema_version FROM presentations WHERE slug='form-01'",Integer.class);
            try {
                jdbc.update("UPDATE presentations SET config_json=JSON_SET(config_json,'$.version',4) WHERE slug='form-01'");
                get(port,"/api/v1/products/form-01",503);
            } finally { jdbc.update("UPDATE presentations SET config_json=? WHERE slug='form-01'",config); }
            try(var fixture=getClass().getResourceAsStream("/fixtures/speaker-glb-v2.json")) {
                var mapper=context.getBean(tools.jackson.databind.ObjectMapper.class);
                var value=mapper.readValue(fixture,com.treesx.product.ProductDto.class);
                jdbc.update("UPDATE presentations SET schema_version=2,config_json=? WHERE slug='form-01'",mapper.writeValueAsString(value.presentation()));
                assertTrue(get(port,"/api/v1/products/form-01",200).contains("speaker-engineering"));
            }
            jdbc.update("UPDATE products SET description=? WHERE slug='form-01'","persistence-probe");
        }
        try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
            var jdbc=context.getBean(JdbcTemplate.class);
            try {
                context.getBean(Flyway.class).migrate();
                assertEquals("persistence-probe",jdbc.queryForObject("SELECT description FROM products WHERE slug='form-01'",String.class));
                int port=((WebServerApplicationContext)context).getWebServer().getPort();
                assertTrue(get(port,"/api/v1/products/form-01",200).contains("speaker-engineering"));
                assertEquals(2,jdbc.queryForObject("SELECT schema_version FROM presentations WHERE slug='form-01'",Integer.class));
                assertEquals(3,jdbc.queryForObject("SELECT COUNT(*) FROM products",Integer.class));
            } finally {
                jdbc.update("UPDATE products SET description=? WHERE slug='form-01'",original);
                jdbc.update("UPDATE presentations SET schema_version=?,config_json=? WHERE slug='form-01'",originalSchema,originalConfig);
            }
        }
    }
}

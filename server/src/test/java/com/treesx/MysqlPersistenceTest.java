package com.treesx;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
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
    @Test void mysqlMigrationApiAndRestartPreserveData() throws Exception {
        String original;
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
            assertEquals(405,post.statusCode());
            String config=jdbc.queryForObject("SELECT config_json FROM presentations WHERE slug='form-01'",String.class);
            try {
                jdbc.update("UPDATE presentations SET config_json=JSON_SET(config_json,'$.version',2) WHERE slug='form-01'");
                get(port,"/api/v1/products/form-01",503);
            } finally { jdbc.update("UPDATE presentations SET config_json=? WHERE slug='form-01'",config); }
            jdbc.update("UPDATE products SET description=? WHERE slug='form-01'","persistence-probe");
        }
        try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
            var jdbc=context.getBean(JdbcTemplate.class);
            try {
                context.getBean(Flyway.class).migrate();
                assertEquals("persistence-probe",jdbc.queryForObject("SELECT description FROM products WHERE slug='form-01'",String.class));
                assertEquals(3,jdbc.queryForObject("SELECT COUNT(*) FROM products",Integer.class));
            } finally { jdbc.update("UPDATE products SET description=? WHERE slug='form-01'",original); }
        }
    }
}


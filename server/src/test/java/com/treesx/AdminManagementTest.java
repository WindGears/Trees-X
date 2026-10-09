package com.treesx;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TREES_MYSQL_TEST",matches="true")
class AdminManagementTest {
    private static final String[] ARGS={"--server.port=0","--spring.datasource.url=jdbc:mysql://127.0.0.1:3306/trees_x_test?createDatabaseIfNotExist=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai"};
    private final ObjectMapper mapper=new ObjectMapper();
    private HttpClient client=client();
    private String base;
    private static HttpClient client() { return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build(); }
    private JsonNode call(String method,String path,Object body,int status,boolean csrf) throws Exception {
        var request=HttpRequest.newBuilder(URI.create(base+path));
        if(csrf) request.header("X-CSRF-TOKEN",call("GET","/api/v1/admin/session/csrf",null,200,false).get("token").asString());
        if(body==null) request.method(method,HttpRequest.BodyPublishers.noBody());
        else if(body instanceof String text) request.header("Content-Type","application/x-www-form-urlencoded").method(method,HttpRequest.BodyPublishers.ofString(text));
        else request.header("Content-Type","application/json").method(method,HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
        var response=client.send(request.build(),HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(status,response.statusCode(),response.body());
        return response.body().isBlank()?mapper.nullNode():mapper.readTree(response.body());
    }
    private void login() throws Exception {
        String user=System.getenv("TREES_ADMIN_USERNAME"), password=System.getenv("TREES_ADMIN_PASSWORD");
        call("POST","/api/v1/admin/session/login","username="+URLEncoder.encode(user,StandardCharsets.UTF_8)+"&password="+URLEncoder.encode(password,StandardCharsets.UTF_8),200,true);
        assertEquals(user,call("GET","/api/v1/admin/session",null,200,false).get("username").asString());
    }
    private ObjectNode edit(JsonNode detail) {
        ObjectNode result=(ObjectNode)detail.get("item").deepCopy();
        result.remove("category"); result.remove("listed"); result.set("presentation",detail.get("presentation").deepCopy());
        return result;
    }
    @Test void realSessionCsrfEditingVisibilityConflictAndRestart() throws Exception {
        String slug="management-check-"+UUID.randomUUID().toString().substring(0,8);
        Long categoryId=null;
        try {
            try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
                base="http://127.0.0.1:"+((WebServerApplicationContext)context).getWebServer().getPort();
                var jdbc=context.getBean(JdbcTemplate.class);
                call("GET","/api/v1/admin/products",null,401,false);
                call("POST","/api/v1/admin/products",Map.of(),403,false);
                call("POST","/api/v1/admin/session/login","username=wrong&password=wrong",401,true);
                String preLoginToken=call("GET","/api/v1/admin/session/csrf",null,200,false).get("token").asString();
                String preLoginSession=((CookieManager)client.cookieHandler().get()).getCookieStore().getCookies().toString();
                login();
                assertNotEquals(preLoginSession,((CookieManager)client.cookieHandler().get()).getCookieStore().getCookies().toString());
                var stale=client.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/admin/categories"))
                    .header("X-CSRF-TOKEN",preLoginToken).header("Content-Type","application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{}" )).build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(403,stale.statusCode());
                var hash=jdbc.queryForObject("SELECT password_hash FROM administrators WHERE username=?",String.class,System.getenv("TREES_ADMIN_USERNAME"));
                assertTrue(hash.startsWith("$2")); assertNotEquals(System.getenv("TREES_ADMIN_PASSWORD"),hash);
                call("POST","/api/v1/admin/categories",Map.of("name","No CSRF","sortOrder",9,"revision",0),403,false);
                var category=call("POST","/api/v1/admin/categories",Map.of("name",slug,"sortOrder",99,"revision",0),201,true);
                categoryId=category.get("id").asLong();
                var input=edit(call("GET","/api/v1/admin/products/form-01",null,200,false));
                input.put("slug",slug).put("name","管理流程验证").put("categoryId",categoryId).put("revision",0).put("description","保存前预览");
                call("POST","/api/v1/admin/products/preview",input,200,true);
                assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM products WHERE slug=?",Integer.class,slug));
                var invalid=input.deepCopy(); invalid.put("cover","https://example.com/image.png");
                call("POST","/api/v1/admin/products",invalid,400,true);
                invalid=input.deepCopy(); ((ObjectNode)invalid.get("presentation")).putArray("views").addNull();
                call("POST","/api/v1/admin/products",invalid,400,true);
                invalid=input.deepCopy(); ((ObjectNode)invalid.get("presentation").get("guide").get(0)).put("hotspotId","missing-node");
                call("POST","/api/v1/admin/products",invalid,400,true);
                var created=call("POST","/api/v1/admin/products",input,201,true);
                assertFalse(created.get("item").get("listed").asBoolean());
                call("GET","/api/v1/products/"+slug,null,404,false);
                input=edit(created); input.put("description","持久化与重启验证");
                ((ObjectNode)input.get("presentation").get("hotspots").get(0)).put("description","管理员修改的部件说明");
                var expectedActions=input.get("presentation").get("actions").deepCopy();
                var camera=(ObjectNode)input.get("presentation").get("camera");
                camera.set("position",mapper.valueToTree(List.of(2.0,2.0,4.0)));
                camera.set("target",mapper.valueToTree(List.of(0.0,1.0,0.0)));
                for(var view:input.get("presentation").get("views")) if(view.get("id").asString().equals("perspective")) {
                    ((ObjectNode)view).set("position",camera.get("position").deepCopy());
                    ((ObjectNode)view).set("target",camera.get("target").deepCopy());
                }
                var updated=call("PUT","/api/v1/admin/products/"+slug,input,200,true);
                assertEquals(expectedActions,updated.get("presentation").get("actions"));
                call("PUT","/api/v1/admin/products/"+slug,input,409,true);
                var visible=call("PUT","/api/v1/admin/products/"+slug+"/visibility",Map.of("revision",updated.get("item").get("revision").asLong(),"listed",true),200,true);
                assertEquals("持久化与重启验证",call("GET","/api/v1/products/"+slug,null,200,false).get("description").asString());
                assertTrue(call("GET","/api/v1/products",null,200,false).toString().contains(slug));
                call("DELETE","/api/v1/admin/categories/"+categoryId+"?revision=0",null,409,true);
                call("PUT","/api/v1/admin/categories/"+categoryId,Map.of("name",slug+"改","sortOrder",99,"revision",0),200,true);
                call("PUT","/api/v1/admin/products/"+slug+"/visibility",Map.of("revision",visible.get("revision").asLong(),"listed",false),409,true);
                var current=call("GET","/api/v1/admin/products/"+slug,null,200,false);
                call("PUT","/api/v1/admin/products/"+slug+"/visibility",Map.of("revision",current.get("item").get("revision").asLong(),"listed",false),200,true);
                call("GET","/api/v1/products/"+slug,null,404,false);
                call("POST","/api/v1/admin/session/logout",null,200,true);
                call("GET","/api/v1/admin/products",null,401,false);
            }
            try(var context=SpringApplication.run(TreesApplication.class,ARGS)) {
                base="http://127.0.0.1:"+((WebServerApplicationContext)context).getWebServer().getPort(); client=client(); login();
                var persisted=call("GET","/api/v1/admin/products/"+slug,null,200,false);
                assertEquals("持久化与重启验证",persisted.get("item").get("description").asString());
                assertEquals("管理员修改的部件说明",persisted.get("presentation").get("hotspots").get(0).get("description").asString());
                assertEquals(mapper.valueToTree(List.of(2.0,2.0,4.0)),persisted.get("presentation").get("camera").get("position"));
                for(var view:persisted.get("presentation").get("views")) if(view.get("id").asString().equals("perspective"))
                    assertEquals(persisted.get("presentation").get("camera").get("position"),view.get("position"));
                assertFalse(persisted.get("item").get("listed").asBoolean());
                call("GET","/api/v1/products/"+slug,null,404,false);
                call("GET","/api/v1/admin/products/unknown",null,404,false);
                var jdbc=context.getBean(JdbcTemplate.class);
                assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE version='6' AND success=1",Integer.class));
            }
        } finally {
            // Remove only this test's own data; never reseed or clear existing business tables.
            var env=System.getenv();
            try(var c=java.sql.DriverManager.getConnection("jdbc:mysql://127.0.0.1:3306/trees_x_test",env.get("TREES_DB_USERNAME"),env.get("TREES_DB_PASSWORD"))) {
                for(String table:List.of("presentations","products")) try(var s=c.prepareStatement("DELETE FROM "+table+" WHERE slug=?")) {s.setString(1,slug);s.executeUpdate();}
                if(categoryId!=null) try(var s=c.prepareStatement("DELETE FROM categories WHERE id=?")) {s.setLong(1,categoryId);s.executeUpdate();}
            }
        }
    }
}

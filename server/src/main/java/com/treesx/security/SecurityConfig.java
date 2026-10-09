package com.treesx.security;

import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean UserDetailsService users(AdministratorRepository admins) {
        return username -> admins.findById(username)
            .map(a -> User.withUsername(a.username).password(a.passwordHash).roles("ADMIN").build())
            .orElseThrow(() -> new UsernameNotFoundException("账号或密码不正确"));
    }
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(a -> a
            .requestMatchers("/api/v1/admin/session/csrf","/api/v1/admin/session/login").permitAll()
            .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
            .requestMatchers(org.springframework.http.HttpMethod.GET,"/api/v1/products/**","/api/v1/categories").permitAll()
            .anyRequest().denyAll())
            .requestCache(c -> c.disable())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req,res,ex) -> json(res,401,"请先登录管理员账号"))
                .accessDeniedHandler((req,res,ex) -> json(res,403,"会话校验失败，请重新登录后再试")))
            .formLogin(f -> f.loginProcessingUrl("/api/v1/admin/session/login")
                .successHandler((req,res,auth) -> json(res,200,"登录成功"))
                .failureHandler((req,res,ex) -> json(res,401,"账号或密码不正确")))
            .logout(l -> l.logoutUrl("/api/v1/admin/session/logout")
                .logoutSuccessHandler((req,res,auth) -> json(res,200,"已退出登录")));
        // Session CSRF tokens retain the default XOR/BREACH protection. The SPA fetches
        // a fresh masked token after login/logout, then sends it as X-CSRF-TOKEN.
        return http.build();
    }
    private static void json(jakarta.servlet.http.HttpServletResponse res,int status,String detail) throws java.io.IOException {
        res.setStatus(status); res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"detail\":\""+detail+"\"}");
    }
}

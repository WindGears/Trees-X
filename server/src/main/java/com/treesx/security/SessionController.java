package com.treesx.security;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/admin/session")
public class SessionController {
    public record Token(String headerName,String token) {}
    public record Session(String username) {}
    @GetMapping("/csrf") public Token csrf(CsrfToken token) { return new Token(token.getHeaderName(),token.getToken()); }
    @GetMapping public Session current(Authentication auth) { return new Session(auth.getName()); }
}

package com.treesx.security;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;

@Component
public class AdminBootstrap implements ApplicationRunner {
    private final AdministratorRepository admins;
    private final PasswordEncoder encoder;
    private final String username,password;
    private final boolean reset;
    public AdminBootstrap(AdministratorRepository admins,PasswordEncoder encoder,
            @Value("${TREES_ADMIN_USERNAME:admin}") String username,@Value("${TREES_ADMIN_PASSWORD:123456}") String password,
            @Value("${TREES_ADMIN_RESET:false}") boolean reset) {
        this.admins=admins; this.encoder=encoder; this.username=username; this.password=password; this.reset=reset;
    }
    @Override @Transactional public void run(ApplicationArguments args) {
        // Reset is an explicit, one-time local maintenance operation; normal restarts preserve credentials.
        long count=admins.count();
        if ((count!=0 && !reset) || username.isBlank() || password.isBlank()) return;
        if (!username.matches("[a-zA-Z0-9_-]{3,80}") || password.length()<6 || password.getBytes(StandardCharsets.UTF_8).length>72)
            throw new IllegalStateException("管理员初始化配置无效：账号3—80位，密码至少6位且UTF-8不超过72字节");
        if (count>1) throw new IllegalStateException("管理员数量超出单管理员约定，未执行初始化或重置");
        String hash=encoder.encode(password);
        if (reset && count!=0) admins.deleteAllInBatch();
        admins.save(new Administrator(username,hash));
    }
}

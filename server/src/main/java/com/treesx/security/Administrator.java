package com.treesx.security;

import jakarta.persistence.*;

@Entity @Table(name="administrators")
public class Administrator {
    @Id @Column(length=80) String username;
    @Column(name="password_hash",nullable=false,length=100) String passwordHash;
    protected Administrator() {}
    Administrator(String username,String passwordHash) { this.username=username; this.passwordHash=passwordHash; }
}

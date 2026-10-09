package com.treesx.product;
import jakarta.persistence.*;
@Entity @Table(name="categories")
public class CategoryEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    @Column(nullable=false,length=40,unique=true) String name;
    @Column(name="sort_order",nullable=false) int sortOrder;
    @Version @Column(nullable=false) long revision;
    protected CategoryEntity() {}
}

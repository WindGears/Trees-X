package com.treesx.product;
import jakarta.persistence.*;
@Entity @Table(name="products")
public class ProductEntity {
    @Id @Column(length=80) String slug;
    @Column(nullable=false,length=120) String name;
    @Column(nullable=false,length=40) String category;
    @Column(nullable=false,length=600) String description;
    @Column(name="sort_order",nullable=false) int sortOrder;
    @Column(length=512) String cover;
    @Column(name="display_status",nullable=false,length=20) String displayStatus;
    @Column(name="category_id",nullable=false) Long categoryId;
    @Column(nullable=false) boolean listed=true;
    @Version @Column(nullable=false) long revision;
    @Column(name="updated_at",nullable=false) java.time.Instant updatedAt=java.time.Instant.now();
    protected ProductEntity() {}
    ProductDto.Summary summary() { return new ProductDto.Summary(slug,name,category,description,cover,displayStatus); }
}

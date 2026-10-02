package com.treesx.product;
import jakarta.persistence.*;
@Entity @Table(name="presentations")
public class PresentationEntity {
    @Id @Column(length=80) String slug;
    @Column(name="schema_version",nullable=false) int schemaVersion;
    @Column(name="config_json",nullable=false,columnDefinition="json") String configJson;
    protected PresentationEntity() {}
}


package com.treesx.product;
public record ProductDto(String slug, String name, String category, String description,
                         Presentation presentation) {
    public Summary summary() { return new Summary(slug, name, category, description); }
    public record Summary(String slug, String name, String category, String description) {}
}


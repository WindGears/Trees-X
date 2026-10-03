package com.treesx.product;
public record ProductDto(String slug, String name, String category, String description, String cover, String displayStatus,
                         Presentation presentation) {
    public Summary summary() { return new Summary(slug, name, category, description, cover, displayStatus); }
    public record Summary(String slug, String name, String category, String description, String cover, String displayStatus) {}
}

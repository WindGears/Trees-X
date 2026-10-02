CREATE TABLE products (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(40) NOT NULL,
    description VARCHAR(600) NOT NULL,
    sort_order INT NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE presentations (
    slug VARCHAR(80) PRIMARY KEY,
    schema_version INT NOT NULL,
    config_json JSON NOT NULL,
    CONSTRAINT presentation_product_fk FOREIGN KEY (slug) REFERENCES products(slug)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


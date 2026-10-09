CREATE TABLE administrators (
    username VARCHAR(80) PRIMARY KEY,
    password_hash VARCHAR(100) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(40) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO categories (name, sort_order)
SELECT category, MIN(sort_order) FROM products GROUP BY category;
ALTER TABLE products
    ADD COLUMN category_id BIGINT,
    ADD COLUMN listed BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
UPDATE products p JOIN categories c ON p.category = c.name SET p.category_id = c.id;
ALTER TABLE products MODIFY category_id BIGINT NOT NULL,
    ADD CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id);

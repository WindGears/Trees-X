ALTER TABLE products
    ADD COLUMN cover VARCHAR(512) NULL,
    ADD COLUMN display_status VARCHAR(20) NOT NULL DEFAULT 'prototype',
    ADD CONSTRAINT product_display_status CHECK (display_status IN ('prototype', 'formal'));

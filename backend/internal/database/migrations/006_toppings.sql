ALTER TABLE products ADD CONSTRAINT products_id_store_unique UNIQUE(id,store_id);
CREATE TABLE toppings (
    id bigserial PRIMARY KEY,
    store_id bigint NOT NULL REFERENCES stores(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    image text NOT NULL,
    ingredients text NOT NULL DEFAULT '',
    allergens text NOT NULL DEFAULT '',
    available boolean NOT NULL DEFAULT false,
    extra_price integer NOT NULL CHECK(extra_price BETWEEN 0 AND 10000),
    extra_portion text NOT NULL DEFAULT '',
    standalone_price integer NOT NULL CHECK(standalone_price BETWEEN 1 AND 1000000),
    standalone_portion text NOT NULL DEFAULT '',
    standalone_product_id bigint NOT NULL UNIQUE,
    UNIQUE(id,store_id),
    FOREIGN KEY(standalone_product_id,store_id) REFERENCES products(id,store_id)
);
ALTER TABLE products ADD COLUMN topping_id bigint REFERENCES toppings(id) ON DELETE SET NULL;
CREATE TABLE product_toppings (
    store_id bigint NOT NULL,
    product_id bigint NOT NULL,
    topping_id bigint NOT NULL,
    option_id text NOT NULL,
    PRIMARY KEY(product_id,topping_id),
    UNIQUE(product_id,option_id),
    FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE CASCADE,
    FOREIGN KEY(topping_id,store_id) REFERENCES toppings(id,store_id) ON DELETE CASCADE
);

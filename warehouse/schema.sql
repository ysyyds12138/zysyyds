PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS user_permissions (
 user_id INTEGER NOT NULL REFERENCES users(id), permission TEXT NOT NULL,
 PRIMARY KEY(user_id, permission)
);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 category_id INTEGER NOT NULL REFERENCES categories(id), unit TEXT NOT NULL DEFAULT '件',
 length_cm REAL NOT NULL CHECK(length_cm>0), width_cm REAL NOT NULL CHECK(width_cm>0),
 height_cm REAL NOT NULL CHECK(height_cm>0), price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 reorder_point INTEGER NOT NULL DEFAULT 20 CHECK(reorder_point>=0),
 description TEXT NOT NULL DEFAULT '', images_json TEXT NOT NULL DEFAULT '[]',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS locations (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, zone TEXT NOT NULL,
 capacity_cm3 INTEGER NOT NULL CHECK(capacity_cm3>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS lots (
 id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
 batch_no TEXT NOT NULL, production_date TEXT NOT NULL, expiry_date TEXT,
 unit_volume_cm3 INTEGER NOT NULL CHECK(unit_volume_cm3>0),
 UNIQUE(product_id, batch_no), CHECK(expiry_date IS NULL OR expiry_date>=production_date)
);
CREATE TABLE IF NOT EXISTS stock (
 id INTEGER PRIMARY KEY, lot_id INTEGER NOT NULL REFERENCES lots(id),
 location_id INTEGER NOT NULL REFERENCES locations(id), quantity INTEGER NOT NULL CHECK(quantity>=0),
 UNIQUE(lot_id, location_id)
);
CREATE TABLE IF NOT EXISTS movements (
 id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
 product_id INTEGER NOT NULL REFERENCES products(id),
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 reason TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 note TEXT NOT NULL DEFAULT '', actor_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS movement_lines (
 id INTEGER PRIMARY KEY, movement_id INTEGER NOT NULL REFERENCES movements(id),
 stock_id INTEGER NOT NULL REFERENCES stock(id), quantity INTEGER NOT NULL CHECK(quantity>0)
);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_lots_product ON lots(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_location ON stock(location_id);

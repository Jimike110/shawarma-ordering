-- Nullable: a missing pin must never become a fabricated (0,0) location.
ALTER TABLE settings ADD COLUMN latitude double precision;
ALTER TABLE settings ADD COLUMN longitude double precision;
ALTER TABLE settings ADD COLUMN landmark text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN entrance text NOT NULL DEFAULT '';
ALTER TABLE settings ADD CONSTRAINT pickup_coordinates CHECK (
 (latitude IS NULL AND longitude IS NULL) OR
 (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
-- Source: the shop's supplied Yandex organization link (223602659821),
-- poi[point]=30.499839,59.935643. Never apply this pin to another identity/address.
UPDATE settings SET latitude=59.935643,longitude=30.499839
WHERE latitude IS NULL AND longitude IS NULL
 AND map_url ~ '/223602659821/?($|\?)'
 AND address IN ('Белорусская ул., 4','Белорусская улица, 4','Белорусская, 4');

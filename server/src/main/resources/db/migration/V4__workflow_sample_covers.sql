-- Add real procedural sample covers only where no cover has already been configured.
UPDATE products SET cover='/covers/workbench/form-01.png'
WHERE slug='form-01' AND cover IS NULL AND display_status='prototype';
UPDATE products SET cover='/covers/workbench/typewriter-study.png'
WHERE slug='typewriter-study' AND cover IS NULL AND display_status='prototype';
UPDATE products SET cover='/covers/workbench/reventon.png'
WHERE slug='reventon' AND cover IS NULL AND display_status='prototype';

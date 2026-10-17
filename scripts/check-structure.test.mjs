import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectStructure } from './check-structure.mjs';

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'shawarma-structure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['app', 'features', 'shared', 'test'])
    mkdirSync(path.join(root, 'src', directory), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, 'src', file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return inspectStructure(root).errors.join('\n');
}

test('accepts layered imports, colocated tests and type-only references without runtime cycles', (t) => {
  assert.equal(
    fixture(t, {
      'app/main.tsx': "import { Shop } from '@/features/catalog/Shop';",
      'features/catalog/Shop.tsx': "import { api } from '@/shared/api/client';",
      'features/catalog/Shop.test.tsx': "import { Shop } from './Shop';",
      'shared/api/client.ts': "import type { A } from './types'; export const api = () => 1;",
      'shared/api/types.ts': "import type { api } from './client'; export interface A {}",
    }),
    '',
  );
});

test('rejects reversed dependencies, runtime cycles and production imports of tests', (t) => {
  const errors = fixture(t, {
    'app/main.tsx': 'export const root = 1;',
    'features/catalog/Shop.tsx': "import '@/app/main'; import './Shop.test';",
    'features/catalog/Shop.test.tsx': 'export const fixture = 1;',
    'shared/a.ts': "import './b'; import '@/features/catalog/Shop';",
    'shared/b.ts': "import './a';",
  });
  assert.match(errors, /shared code cannot import/);
  assert.match(errors, /compose features in app/);
  assert.match(errors, /production code imports a test/);
  assert.match(errors, /Runtime import cycle/);
});

test('catches obsolete mock paths, case mismatches and misplaced root modules', (t) => {
  const errors = fixture(t, {
    'ui.tsx': 'export const old = 1;',
    'features/catalog/Shop.tsx': "import '@/shared/API/client';",
    'features/catalog/Shop.test.tsx': "vi.mock('./obsolete-client', () => ({}));",
    'shared/api/client.ts': 'export const api = 1;',
  });
  assert.match(errors, /Place source under/);
  assert.match(errors, /incorrectly cased import @\/shared\/API\/client/);
  assert.match(errors, /unresolved.*obsolete-client/);
});

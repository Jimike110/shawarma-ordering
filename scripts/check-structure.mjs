import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function inspectStructure(root) {
  const errors = [];
  const files = new Set();
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = directory + '/' + entry.name;
      if (entry.isDirectory()) walk(file);
      else files.add(file);
    }
  }
  for (const directory of ['app', 'features', 'shared', 'test']) walk('src/' + directory);
  const rootEntries = readdirSync(path.join(root, 'src'), { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || !['app', 'features', 'shared', 'test'].includes(entry.name))
      errors.push('Place source under app/, features/, shared/ or test/: src/' + entry.name);
  }
  const graph = new Map();
  const code = [...files].filter((file) => /\.tsx?$/.test(file));
  const isTest = (file) => /\.test\.tsx?$/.test(file) || file.startsWith('src/test/');
  function resolve(file, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
    const base = specifier.startsWith('@/')
      ? 'src/' + specifier.slice(2)
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    for (const suffix of ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx'])
      if (files.has(base + suffix)) return base + suffix;
    errors.push(file + ': unresolved or incorrectly cased import ' + specifier);
    return null;
  }
  for (const file of code) {
    const ast = ts.createSourceFile(
      file,
      readFileSync(path.join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies = new Set();
    function dependency(specifier, runtime = true) {
      const target = resolve(file, specifier);
      if (!target) return;
      if (file.startsWith('src/shared/') && !target.startsWith('src/shared/'))
        errors.push(file + ': shared code cannot import application/features: ' + target);
      if (file.startsWith('src/features/') && target.startsWith('src/app/'))
        errors.push(file + ': compose features in app/, not inside features: ' + target);
      if (!isTest(file) && isTest(target))
        errors.push(file + ': production code imports a test: ' + target);
      if (runtime && /\.tsx?$/.test(target) && !isTest(target)) dependencies.add(target);
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const onlyTypes =
            node.isTypeOnly ||
            clause?.isTypeOnly ||
            (clause &&
              !clause.name &&
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.every((element) => element.isTypeOnly));
          dependency(node.moduleSpecifier.text, !onlyTypes);
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
          dependency(node.arguments[0].text);
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(ast) === 'vi' &&
          ['mock', 'doMock'].includes(node.expression.name.text)
        )
          dependency(node.arguments[0].text, false);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (!isTest(file)) graph.set(file, dependencies);
  }
  const visited = new Set(),
    active = new Set();
  function visit(file, chain = []) {
    if (active.has(file)) {
      errors.push(
        'Runtime import cycle: ' + [...chain.slice(chain.indexOf(file)), file].join(' -> '),
      );
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...chain, file]);
    active.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return { errors, modules: code.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, modules } = inspectStructure(fileURLToPath(new URL('../', import.meta.url)));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'Structure checked: ' +
        modules +
        ' modules; imports resolve with correct case, shared/feature boundaries hold, and runtime imports are acyclic.',
    );
}

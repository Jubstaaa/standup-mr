// Part of the required CI check: every rule at severity 'error' blocks merging.

// Tests, fixtures and the timezone cases only ever run under `bun test`.
const TEST_ONLY = '[.](?:test|fixtures|cases)[.]ts$'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-orphans',
            severity: 'error',
            from: { orphan: true, pathNot: ['[.]d[.]ts$'] },
            to: {},
        },
        // src/ and mcp/ are the npm package; remote/ is the server that builds on them.
        {
            name: 'package-not-to-server',
            comment:
                'src/ and mcp/ ship to npm and must not pull in the remote server.',
            severity: 'error',
            from: { path: '^(src|mcp)/' },
            to: { path: '^remote/' },
        },
        {
            name: 'core-not-to-mcp',
            comment:
                'src/ is the core library; the MCP surface builds on it, not the reverse.',
            severity: 'error',
            // The CLI entry is the composition root: `standup mcp` starts the
            // stdio server.
            from: { path: '^src/', pathNot: '^src/cli/cli[.]ts$' },
            to: { path: '^mcp/' },
        },
        // builtInModules below treats Bun's modules as core for remote/, which runs
        // under Bun. The published package runs on Node, where they do not exist.
        {
            name: 'no-bun-runtime-in-package',
            comment:
                'src/ and mcp/ run on Node (engines.node); Bun-only modules break npm users.',
            severity: 'error',
            from: { path: '^(src|mcp)/', pathNot: TEST_ONLY },
            to: { path: '^(bun|bun:[a-z]+)$' },
        },
        {
            name: 'not-to-dev-dep',
            severity: 'error',
            from: { path: '^(src|mcp|remote/src)/', pathNot: TEST_ONLY },
            to: {
                dependencyTypes: ['npm-dev'],
                dependencyTypesNot: ['type-only'],
                pathNot: ['node_modules/@types/'],
            },
        },
        {
            name: 'not-to-test',
            severity: 'error',
            from: { pathNot: TEST_ONLY },
            to: { path: TEST_ONLY },
        },
        {
            name: 'no-non-package-json',
            severity: 'error',
            from: {},
            to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
        },
        {
            name: 'not-to-unresolvable',
            severity: 'error',
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: 'not-to-deprecated',
            severity: 'error',
            from: {},
            to: { dependencyTypes: ['deprecated'] },
        },
        {
            name: 'no-duplicate-dep-types',
            severity: 'error',
            from: {},
            to: {
                moreThanOneDependencyType: true,
                dependencyTypesNot: ['type-only'],
            },
        },
    ],
    options: {
        doNotFollow: { path: ['node_modules'] },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        // remote/ is a workspace with its own package.json.
        combinedDependencies: true,
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            extensions: ['.ts'],
            mainFields: ['module', 'main', 'types', 'typings'],
        },
        builtInModules: {
            add: ['bun', 'bun:sqlite', 'bun:test'],
        },
        skipAnalysisNotInRules: true,
    },
}

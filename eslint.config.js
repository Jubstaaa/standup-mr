import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import importPlugin, { createNodeResolver } from 'eslint-plugin-import-x'
import perfectionistPlugin from 'eslint-plugin-perfectionist'
import prettierPlugin from 'eslint-plugin-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
    globalIgnores(['**/dist', '**/node_modules']),
    {
        files: ['src/**/*.ts', 'mcp/**/*.ts', 'remote/src/**/*.ts'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            prettierConfig,
        ],
        plugins: {
            'import-x': importPlugin,
            'perfectionist': perfectionistPlugin,
            'prettier': prettierPlugin,
        },
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.node,
            // Type information for the promise rules below. The full
            // recommendedTypeChecked preset is not adopted yet: most of what
            // it adds flags async test stubs, not unhandled work.
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            'prettier/prettier': 'error',
            'no-console': ['warn', { allow: ['error'] }],
            // The shared config pairs core no-unused-vars with the TS rule off.
            // Core cannot read a TypeScript function type — `(ms: number) => void`
            // reads as an unused `ms` — so the TS-aware rule takes its place here.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            // A promise nobody awaits loses its rejection; `void` marks the
            // ones that are deliberately left running.
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            'import-x/order': [
                'error',
                {
                    'groups': [
                        'builtin',
                        'external',
                        'internal',
                        'parent',
                        'sibling',
                        'index',
                    ],
                    'newlines-between': 'always',
                    'alphabetize': { order: 'asc', caseInsensitive: true },
                },
            ],
            'perfectionist/sort-interfaces': [
                'error',
                {
                    customGroups: [
                        {
                            elementNamePattern: '^(id|uuid)$',
                            groupName: 'identity',
                        },
                        {
                            elementNamePattern: '^on[A-Z]',
                            groupName: 'callbacks',
                        },
                    ],
                    groups: ['identity', 'unknown', 'callbacks'],
                    order: 'asc',
                    type: 'alphabetical',
                },
            ],
            'perfectionist/sort-named-imports': [
                'warn',
                { order: 'asc', type: 'alphabetical' },
            ],
        },
    },
    // The package runs on Node (engines.node); Bun's global only exists in
    // tests and in remote/, which runs under Bun.
    {
        files: ['src/**/*.ts', 'mcp/**/*.ts'],
        ignores: ['**/*.test.ts', '**/*.cases.ts', '**/*.fixtures.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                {
                    name: 'Bun',
                    message:
                        'src/ and mcp/ ship to Node; use a Node API instead.',
                },
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'globalThis',
                    property: 'Bun',
                    message:
                        'src/ and mcp/ ship to Node; use a Node API instead.',
                },
            ],
        },
    },
    {
        // The remote server reaches the package only through these modules.
        // Everything else in src/ (env and gh / glab discovery, the CLI) and
        // all of mcp/ belong to the local stdio process.
        files: ['remote/src/**/*.ts'],
        settings: {
            // Sources import each other without extensions, as Bun and tsup do.
            'import-x/resolver-next': [
                createNodeResolver({ extensions: ['.ts', '.js'] }),
            ],
        },
        rules: {
            'import-x/no-restricted-paths': [
                'error',
                {
                    zones: [
                        {
                            target: './remote/src',
                            from: './mcp',
                            message:
                                'mcp/ is the local stdio server; share code through src/mcp-tools instead.',
                        },
                        {
                            target: './remote/src',
                            from: './src',
                            except: [
                                './mcp-tools',
                                './notify',
                                './providers/base/base.types.ts',
                                './providers/github/github.ts',
                                './providers/gitlab/gitlab.ts',
                                './render/digest.ts',
                                './report/report.ts',
                                './standup.types.ts',
                            ],
                            message:
                                'remote/ may import only the public src/ modules listed in eslint.config.js.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['**/*.types.ts', '**/*.d.ts'],
        rules: { '@typescript-eslint/no-unused-vars': 'off' },
    },
])

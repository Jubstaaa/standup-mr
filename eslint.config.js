import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import'
import perfectionistPlugin from 'eslint-plugin-perfectionist'
import prettierPlugin from 'eslint-plugin-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
    globalIgnores(['**/dist', '**/node_modules']),
    {
        files: ['src/**/*.ts', 'mcp/**/*.ts'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            prettierConfig,
        ],
        plugins: {
            import: importPlugin,
            perfectionist: perfectionistPlugin,
            prettier: prettierPlugin,
        },
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.node,
        },
        rules: {
            'prettier/prettier': 'error',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-console': ['warn', { allow: ['error'] }],
            'no-unused-vars': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            'import/order': [
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
    {
        files: ['**/*.types.ts', '**/*.d.ts'],
        rules: { 'no-unused-vars': 'off' },
    },
])

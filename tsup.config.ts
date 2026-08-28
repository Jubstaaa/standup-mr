import { defineConfig } from 'tsup'

export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
            cli: 'src/cli/cli.ts',
        },
        format: ['esm'],
        target: 'node20',
        dts: true,
        clean: true,
        banner: { js: '#!/usr/bin/env node' },
    },
    {
        entry: {
            'mcp/server': 'mcp/server.ts',
        },
        format: ['esm'],
        target: 'node20',
        dts: false,
        clean: false,
        banner: { js: '#!/usr/bin/env node' },
    },
])

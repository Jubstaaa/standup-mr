import { readFileSync, writeFileSync } from 'node:fs'

// Keep every manifest's version in step with package.json. npm runs this on
// `npm version`, so one bump updates the plugin, marketplace, Gemini and
// MCP-registry manifests the release workflow checks.
const version = JSON.parse(readFileSync('package.json', 'utf8')).version

const manifests = [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'gemini-extension.json',
    'server.json',
]

for (const file of manifests) {
    const before = readFileSync(file, 'utf8')
    const after = before.replace(
        /("version":\s*")\d+\.\d+\.\d+(")/g,
        `$1${version}$2`
    )
    if (after !== before) {
        writeFileSync(file, after)
        console.log(`${file} -> ${version}`)
    }
}

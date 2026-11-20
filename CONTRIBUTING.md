# Contributing to standup-mr

First off, thanks for taking the time to contribute! standup-mr is a
community-driven project, and contributions are welcome - bug reports,
feature requests, documentation, or code.

## Code of Conduct

Be respectful, inclusive, and professional. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Found a bug? Please report it by [opening an issue](https://github.com/Jubstaaa/standup-mr/issues/new?template=bug_report.md).

**Before you report:**

- Check if the bug already exists in [issues](https://github.com/Jubstaaa/standup-mr/issues)
- Try to reproduce it with the latest version
- Include as much detail as possible (steps to reproduce, error messages, environment)

**What to include:**

- OS and Node.js/Bun version
- Which surface is affected: CLI, MCP server, or the Claude Code skill
- Error message and stderr output
- Expected vs actual behavior

### Suggesting Enhancements

Have an idea? Let's discuss it!

- [Open a discussion](https://github.com/Jubstaaa/standup-mr/discussions) for feature ideas
- Describe the use case and why it would be useful
- Provide examples if possible

### Improving Documentation

Documentation improvements are always welcome!

- Fix typos or unclear explanations
- Add examples or clarifications
- Improve the README, `mcp/README.md`, or `skills/standup/SKILL.md`
- Submit a pull request with your improvements

### Contributing Code

#### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/standup-mr.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `bun install`

#### Development Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check, lint, formatting
bun run typecheck
bun run lint
bun run format:check

# Dead code, duplication, module boundaries
bun run knip
bun run duplication
bun run deps:check

# Build (CLI + library + MCP server bundle)
bun run build
```

#### Development Workflow

1. **Create a branch** with a descriptive name:

    ```bash
    git checkout -b feature/add-lang-support
    # or
    git checkout -b fix/dates-timezone-bug
    ```

2. **Make your changes** following the code style:
    - TypeScript, ESM, no `.js` extension on relative imports
    - No comments in source unless logic is genuinely non-obvious
    - `src/` imports no runtime dependencies - the CLI core loads nothing
      but Node built-ins. `mcp/` uses `@modelcontextprotocol/sdk` and `zod`
      (regular dependencies of the package). `remote/` is a separate
      workspace with its own dependencies and never ships to npm
    - Kebab-case file names
    - `bun run deps:check` enforces the boundaries between them: `src/` and
      `mcp/` never import `remote/`, `src/` never imports `mcp/`, shipped code
      uses no Bun-only module or dev dependency, and cycles or orphan modules
      fail the check

3. **Test your changes**:

    ```bash
    bun run lint
    bun run format:check
    bun run typecheck
    bun test
    bun run test:tz
    bun run audit
    bun run knip          # unused files, exports and dependencies
    bun run duplication   # copy-paste above the .jscpd.json threshold
    bun run deps:check    # module boundaries, cycles, orphans
    bun run build
    ```

    That is the list the CI `check` job gates every pull request on. CI also
    runs Trivy (fixable HIGH/CRITICAL vulnerabilities, secrets and
    misconfiguration) and actionlint; locally both are optional:
    `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed --skip-dirs node_modules,dist .`

    If you touch anything in `src/dates/` or anything that computes "today"
    or "the previous day", run the suite under more than one timezone -
    `TZ=America/Chicago bun test` and `TZ=Pacific/Kiritimati bun test` are good
    choices for catching UTC-vs-local bugs.

    **Day-boundary tests belong in a `.cases.ts` file, not `.test.ts`.** Plain
    `bun test` picks up every `.test.ts` file and runs with its internal clock
    pinned to UTC unless `TZ` is set in the environment, so a fixed-timezone
    assertion living in a `.test.ts` file will fail under plain `bun test` (and
    therefore under CI). That's why the tests asserting a specific local-day
    boundary live in `src/dates/dates.tz.istanbul.cases.ts` and
    `src/dates/dates.tz.los-angeles.cases.ts` - named outside the `.test.ts`
    glob on purpose - and run separately via:

    ```bash
    bun run test:tz
    ```

    If you add a new file like this, you must also add it to the `test:tz`
    chain in `package.json`, or it will silently never run - not in `bun test`,
    not in `test:tz`, not in CI. The CI and release workflows invoke
    `bun run test:tz` alongside `bun test`, so a file left out of the chain
    stays uncovered everywhere.

4. **Commit with conventional commits**:

    ```bash
    git commit -m "feat(cli): add --since flag"
    # or
    git commit -m "fix(gitlab): paginate discussions past the first page"
    ```

    Format: `type(scope): description`
    - `feat`: New feature
    - `fix`: Bug fix
    - `docs`: Documentation
    - `style`: Formatting (no logic change)
    - `refactor`: Code restructuring
    - `perf`: Performance improvement
    - `test`: Tests
    - `build`: Build system / packaging
    - `chore`: Everything else

5. **Push and create a Pull Request**:

    ```bash
    git push origin feature/your-feature-name
    ```

    - Describe what your PR does
    - Reference any related issues

#### Project Structure

```
src/
├── cli/                  # Argument parsing and the fetch/post/mcp/instructions commands
├── config/               # Host and token resolution (flags, env, gh/glab)
├── providers/            # Provider selection plus the GitLab and GitHub API clients
│   └── base/             # Provider interface, shared HTTP (retry, timeout, errors)
├── dates/                # Local-day date helpers
├── buckets/              # Merge request state classification (ready/blocked/draft/stale)
├── report/               # Assembles the standup report from a provider
├── render/               # JSON -> markdown digest and chat text
├── notify/               # Slack/Discord/Google Chat webhook posting
├── trace/                # Error-line extraction from pipeline job logs
├── skill/, manifest/     # Bundled skill text and package.json lookup
└── standup.types.ts      # Domain types shared by every module

mcp/
├── tools.ts              # Tool and prompt definitions (shared with remote/)
└── server.ts             # stdio MCP server entrypoint

remote/                   # Hosted MCP server (Express, OAuth, SQLite), deployed as a container
skills/standup/           # Claude Code skill (note-writing playbook)
```

#### Key Concepts

- **Provider**: the interface GitLab and GitHub (and any future host) implement -
  `getIdentity`, `getEvents`, `getMyMrs`, `getReviews`, `getBlockers`
- **Bucket**: the classification of an open merge request - `ready`,
  `blocked`, `draft`, or `stale`
- **Report**: the structured object every surface (CLI JSON, `--markdown`,
  MCP tool) is built from

### Testing

Using `bun test`. Add tests for new features, and prefer testing behavior
through the public function/CLI surface rather than internals. When you add a
test for existing but uncovered behavior, mutate the code to confirm the test
actually fails without the behavior, then restore it - a test that stays green
either way isn't covering anything.

### Documentation

- Update `README.md` for user-facing changes to the CLI
- Update `mcp/README.md` for MCP server changes
- Update `skills/standup/SKILL.md` for changes to what data is returned or how it
  should be written up
- Add JSDoc-style comments only where the "why" genuinely isn't obvious from
  the code

## Pull Request Process

1. Update `README.md` / `mcp/README.md` / `skills/standup/SKILL.md` if needed
2. Run the local check list above; CI's `check` job must be green
3. Changes under `remote/` also build the server image in the `Remote`
   workflow; it deploys from `main` after merge (see "Deploying and rolling
   back the hosted server")
4. Add an entry under `[Unreleased]` in `CHANGELOG.md` for user-facing changes
5. Request review from maintainers
6. Address any feedback
7. Merge once approved!

## Releasing (maintainers)

1. On an up-to-date branch, move the `[Unreleased]` entries in `CHANGELOG.md`
   under a `## [x.y.z] - YYYY-MM-DD` heading. The GitHub release notes are cut
   from that heading, and the release fails without it.
2. `npm version <patch|minor|major> --no-git-tag-version`. The `version` script
   (`scripts/sync-versions.mjs`) also bumps `.claude-plugin/*.json`,
   `gemini-extension.json` and `server.json`; the release refuses a tag whose
   manifests disagree with `package.json`.
3. Merge that through a pull request, then tag the merge commit on `main`:
   `git tag vX.Y.Z <sha>` and `git push origin vX.Y.Z`.

The `Release` workflow then runs four jobs:

- **verify** refuses a tag that is not on `main`, type-checks, tests, builds
  and packs the tarball. It holds no publishing credential.
- **npm** publishes that tarball with npm provenance (`npm audit signatures`
  verifies it). It installs and runs nothing from the repository.
- **mcp-registry** waits for the version on npm, then publishes `server.json`
  with the checksum-pinned `mcp-publisher` through GitHub OIDC.
- **github-release** creates the release from the changelog entry.

Each publishing job skips work already done, so re-running a failed job is safe.
A prerelease tag (`vX.Y.Z-*`) is refused by verify.

### One-time setup

These are what the release trusts; check them before the first release from
a new account or fork.

- **npm trusted publisher** for `standup-mr`: repository `Jubstaaa/standup-mr`,
  workflow `release.yml`, environment `release`. The npm job needs npm 11.5.1
  or newer (it runs Node 24) and checks for it.
- **`release` environment** with a deployment policy that admits only `v*`
  tags.
- **`protect-release-tags` ruleset**: creating, updating or deleting
  `refs/tags/v*` is restricted, with only the admin role allowed to bypass, so
  only an admin can push step 3's tag and a published tag cannot be moved.
- **Retire the old token** after the first release published this way: delete
  the `NPM_TOKEN` repository secret, set the package's publishing access on
  npmjs.com to "require two-factor authentication and disallow tokens", and
  revoke the token there.

### Bad release

An npm version can never be published again, even after an unpublish, so the
fix is always a new version.

1. Publish a fixed `x.y.z+1` through the normal steps.
2. Deprecate the bad one: `npm deprecate standup-mr@x.y.z "<reason>; use x.y.z+1"`.
3. If `latest` must move before the fix is out:
   `npm dist-tag add standup-mr@<good version> latest`.
4. `npm unpublish standup-mr@x.y.z` only within npm's 72-hour window and its
   other unpublish rules; prefer deprecating.

The MCP registry entry cannot be deleted, only superseded by the next version.
The GitHub release can be edited or deleted. The tag stays: the ruleset
blocks retagging by design.

## Deploying and rolling back the hosted server

The `Remote` workflow builds the image on every push to `main` that touches
the server, deploys it through the `production` environment (which admits
only `main`), and keeps the previous image if the new one is unhealthy. A
failed deploy opens or updates a "Production deploy failed" issue labelled
`deploy-failure`; close it by hand once production is healthy.

To roll back to an earlier release, dispatch the workflow from `main` with that
release's full 40-character commit SHA:

    gh workflow run remote.yml --ref main -f image_tag=<sha>

If a schema migration ran since that release, also pass
`-f restore_snapshot=true`. The server then starts on the newest database
snapshot taken while that release ran, and every write since is discarded.
Additive migrations (such as 3 and 4) do not need it: the previous image
ignores the new columns.

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional longer explanation here.

Fixes #123
```

**Examples:**

- `feat(cli): add --since flag for a custom lookback window`
- `fix(dates): treat today as the user's local day`
- `docs(readme): clarify credential resolution order`
- `refactor(gitlab): extract pipeline lookup into its own method`

## Project Roadmap

Check out [GitHub Issues](https://github.com/Jubstaaa/standup-mr/issues) for
planned features and known issues.

## Questions?

- Open a [GitHub Discussion](https://github.com/Jubstaaa/standup-mr/discussions)
- Found an issue? [Report it](https://github.com/Jubstaaa/standup-mr/issues)
- Email: ilkerbalcilartr@gmail.com

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.

---

**Happy Contributing!**

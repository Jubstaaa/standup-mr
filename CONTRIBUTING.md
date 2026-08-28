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
- Improve the README, `mcp/README.md`, or `skill/SKILL.md`
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

# Type check
bun run typecheck

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
   - `src/` stays free of runtime dependencies - the CLI and library ship
     with zero. The only dependency in the whole project is the optional
     `@modelcontextprotocol/sdk` peer dependency used by the MCP server
   - Kebab-case file names

3. **Test your changes**:

   ```bash
   bun test
   bun run typecheck
   bun run build
   ```

   If you touch anything in `src/dates/` or anything that computes "today"
   or "the previous day", run the suite under more than one timezone -
   `TZ=America/Chicago bun test` and `TZ=Pacific/Kiritimati bun test` are good
   choices for catching UTC-vs-local bugs.

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
├── cli/                  # Argument parsing and the fetch/post commands
├── config/               # Host and token resolution (flags, env, glab)
├── providers/            # GitLab API client (Provider interface + implementation)
├── dates/                # Local-day date helpers
├── buckets/              # Merge request state classification (ready/blocked/draft/stale)
├── report/                # Assembles the standup report from a provider
├── render/                # JSON -> markdown digest
├── notify/                # Slack/Discord webhook posting
├── trace/                 # Error-line extraction from pipeline job logs
└── types/                 # Shared TypeScript types

mcp/                       # MCP server wrapper (get_standup_data tool)
skill/                      # Claude Code skill (note-writing playbook)
```

#### Key Concepts

- **Provider**: the interface GitLab (and any future host) implements -
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
- Update `skill/SKILL.md` for changes to what data is returned or how it
  should be written up
- Add JSDoc-style comments only where the "why" genuinely isn't obvious from
  the code

## Pull Request Process

1. Update `README.md` / `mcp/README.md` / `skill/SKILL.md` if needed
2. Ensure all tests pass: `bun test`
3. Ensure typecheck passes: `bun run typecheck`
4. Ensure the build succeeds: `bun run build`
5. Request review from maintainers
6. Address any feedback
7. Merge once approved!

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

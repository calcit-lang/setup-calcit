# setup-calcit

`setup-calcit` installs the Calcit tools declared by the checked-out project. For a normal project, the
only Calcit version source is `deps.cirru`:

```cirru.no-check
{} $ :calcit-version |0.13.27
```

### Normal usage

```yml
- uses: actions/checkout@v4

- uses: calcit-lang/setup-calcit@v2
```

This downloads only `calcit` and `caps` for the version in `deps.cirru`. It also creates a lightweight
`cr -> calcit` link in the Action tool directory, so an unchanged legacy workflow keeps working while it
migrates. New and edited commands should use `calcit`:

```yml
- run: caps --ci
- run: calcit calcit.cirru --check-only
```

The Action only installs tools. It does not install modules, format a Snapshot, run a quality gate, or
run your tests.

### Inputs

- `deps-file`: project-relative path to `deps.cirru`; defaults to the workspace root. If the selected
  file does not exist, it is treated as a task without a project declaration and requires the `version`
  fallback input.
- `tools`: comma-separated tools to install; defaults to `calcit,caps`, and also accepts `cr-wasm`. `cr`
  is accepted as a compatibility alias for `calcit`; requesting both is a duplicate error.
- `cr-wasm`: compatibility input that adds `cr-wasm` to `tools`.
- `version`: fallback only for a task without `deps.cirru`. If both sources exist, values must match.

The Action rejects malformed, duplicate, or conflicting declarations before downloading anything. A
missing selected file or a file without `:calcit-version` can use `version`; without either source it
fails with `E_SETUP_VERSION_MISSING`. It exposes `version`, `version-source`, `deps-file`, `tools`, and
`cache-hit` as outputs.

`bundle_calcit`/`bundler` are no longer supported. The current release assets support Linux x64 runners.
The Action caches each downloaded tool in the runner tool cache, so repeated setup steps in the same job
reuse it. Its `cache-hit` output is `true` only when every requested tool came from that cache.

### Migrating from setup-cr

GitHub Actions does not follow action-repository rename redirects. Therefore
[`calcit-lang/setup-cr`](https://github.com/calcit-lang/setup-cr) remains the
legacy Action and existing workflows do not need to change. New projects should
use `calcit-lang/setup-calcit@v2`; migrating an existing project is an explicit,
one-line replacement after its CI has passed:

```yaml
- uses: calcit-lang/setup-calcit@v2
```

The version outputs remain stable during migration, and v2 accepts the old
`tools: cr,...` spelling as an alias. The `tools` output is intentionally
canonical: both `tools: cr,caps` and `tools: calcit,caps` report `calcit,caps`.
Do not depend on a repository redirect for `uses:` references.

For CI quality, entries, examples, backend tests, and consumer regression, see the Calcit documentation:

```bash
calcit docs search setup-calcit --summary
calcit docs read library-quality.md --full
```

### License

MIT

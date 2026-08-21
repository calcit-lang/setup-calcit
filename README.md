# setup-calcit

`setup-calcit` installs the Calcit tools declared by the checked-out project. For a normal project, the
only Calcit version source is `deps.cirru`:

```cirru.no-check
{} $ :calcit-version |0.13.27
```

### Normal usage

```yml
- uses: actions/checkout@v4

- uses: tiye/setup-calcit@v1
```

This installs `cr` and `caps` for the version in `deps.cirru`. Then run project commands explicitly:

```yml
- run: caps --ci
- run: cr calcit.cirru --check-only
```

The Action only installs tools. It does not install modules, format a Snapshot, run a quality gate, or
run your tests.

### Inputs

- `deps-file`: project-relative path to `deps.cirru`; defaults to the workspace root. If the selected
  file does not exist, it is treated as a task without a project declaration and requires the `version`
  fallback input.
- `tools`: comma-separated tools to install; defaults to `cr,caps`, and also accepts `cr-wasm`.
- `cr-wasm`: compatibility input that adds `cr-wasm` to `tools`.
- `version`: fallback only for a task without `deps.cirru`. If both sources exist, values must match.

The Action rejects malformed, duplicate, or conflicting declarations before downloading anything. A
missing selected file or a file without `:calcit-version` can use `version`; without either source it
fails with `E_SETUP_VERSION_MISSING`. It exposes `version`, `version-source`, `deps-file`, and `tools`
as outputs.

`bundle_calcit`/`bundler` are no longer supported.

### Migrating from setup-cr

GitHub Actions does not follow action-repository rename redirects. Therefore
[`calcit-lang/setup-cr`](https://github.com/calcit-lang/setup-cr) remains the
legacy Action and existing workflows do not need to change. New projects should
use `tiye/setup-calcit@v1`; migrating an existing project is an explicit,
one-line replacement after its CI has passed:

```yaml
- uses: tiye/setup-calcit@v1
```

The two Actions keep the same inputs and outputs during the migration. Do not
depend on a repository redirect for `uses:` references.

For CI quality, entries, examples, backend tests, and consumer regression, see the Calcit documentation:

```bash
cr docs search setup-calcit --summary
cr docs read library-quality.md --full
```

### License

MIT

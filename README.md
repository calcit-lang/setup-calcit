## Action to set up [Calcit](https://calcit-lang.org/)

`setup-cr` installs the Calcit tools declared by the checked-out project. For a normal project, the
only Calcit version source is `deps.cirru`:

```cirru.no-check
{} $ :calcit-version |0.13.27
```

### Normal usage

```yml
- uses: actions/checkout@v4

- uses: calcit-lang/setup-cr@0.0.9
```

This installs `cr` and `caps` for the version in `deps.cirru`. Then run project commands explicitly:

```yml
- run: caps --ci
- run: cr calcit.cirru --check-only
```

The Action only installs tools. It does not install modules, format a Snapshot, run a quality gate, or
run your tests.

### Inputs

- `deps-file`: project-relative path to `deps.cirru`; defaults to the workspace root.
- `tools`: comma-separated tools to install; defaults to `cr,caps`, and also accepts `cr-wasm`.
- `cr-wasm`: compatibility input that adds `cr-wasm` to `tools`.
- `version`: fallback only for a task without `deps.cirru`. If both sources exist, values must match.

The Action rejects a missing, malformed, duplicate, or conflicting version declaration before downloading
anything. It exposes `version`, `version-source`, `deps-file`, and `tools` as outputs.

`bundle_calcit`/`bundler` are no longer supported.

For CI quality, entries, examples, backend tests, and consumer regression, see the Calcit documentation:

```bash
cr docs search setup-cr --summary
cr docs read library-quality.md --full
```

### License

MIT

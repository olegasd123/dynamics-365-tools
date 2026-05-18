# PCF Controls — Feature Plan

A manager for PowerApps Component Framework (PCF) controls inside VS Code.
Scaffolds new controls, builds and watches existing ones, pushes to a Dataverse
environment for fast iteration, and produces a real solution package for
release. Wraps the Power Platform CLI (`pac`) rather than reimplementing its
build pipeline, and re-uses the extension's existing environment, solution, and
publish infrastructure so PCF feels like a sibling of the Plugin Explorer and
Web Resource publisher.

---

## 1. Goals & non-goals

### Goals (v1)

- **Discover** PCF controls in the open workspace: a control is anything whose
  folder contains a `ControlManifest.Input.xml`. Multi-control workspaces are
  first-class (we don't assume one project at root).
- **Scaffold** new controls via `pac pcf init`, with a guided form for
  namespace / name / template (`field` or `dataset`) / language (TS/React).
- **Build** a control (`npm install` if needed, then `npm run build`), with
  output streamed to a dedicated output channel.
- **Watch** mode (`npm start watch`) — long-running test harness with status
  bar indicator.
- **Push for dev** via `pac pcf push --publisher-prefix <p>` against the active
  environment binding — the fast inner loop. No solution authoring required.
- **Package for release**: produce a managed/unmanaged solution `.zip` by
  generating (or reusing) a `.cdsproj` wrapper, adding the `.pcfproj` as a
  reference, and running `dotnet build`. Optionally **deploy that zip** via
  `ImportSolution` against any configured environment, reusing the same
  Dataverse client and import-job polling that the plugin and ribbon flows use.
- **Explore deployed controls**: list `customcontrols` in the bound environment
  (filterable by solution, mirroring the plugin explorer), see which workspace
  project each one corresponds to (matched by `namespace.name`), and trigger
  "Update from local project" or "Open in Power Apps" per row.
- **Tree view** in the activity bar alongside the Plugin Explorer.

### Non-goals (v1)

- A visual designer / property inspector / live preview beyond what
  `npm start watch` (the PCF test harness) already gives. We integrate with
  that, we don't replace it.
- Editing `ControlManifest.Input.xml` through a form. It's hand-edited or
  scaffolded; v1 just opens it.
- Authoring the React component / dataset bindings — VS Code already edits TS
  and CSS, we don't add another editor over the top.
- Pulling a deployed control's source back into the workspace
  (`pac pcf` has no symmetric "pull" — round-tripping is out of scope).
- Managed-solution authoring beyond the standard "managed=true" build flag.
- Auto-upgrading the manifest version on every push (`pac pcf push` bumps it
  by default; we expose this as an opt-out).

---

## 2. Background: what a PCF control actually is

For grounding, a PCF project is a folder with this shape:

```
MyControl/
├── ControlManifest.Input.xml        <-- declarative: name, namespace, properties, resources
├── index.ts                         <-- implements ComponentFramework.StandardControl<…>
├── css/                             <-- referenced from manifest <resources>
├── strings/                         <-- localized resx files
├── generated/                       <-- typings emitted from the manifest, gitignored
├── tsconfig.json
├── package.json                     <-- scripts: build, start, clean, refreshTypes
└── (optional) pcfconfig.json        <-- newer pac versions; output dir etc.
```

The `.pcfproj` (an MSBuild project) and the wrapping `.cdsproj` (CDS solution
project) are produced on demand for release builds — they are *not* required
for `pac pcf push` to work. A control identifies itself in Dataverse by
`<namespace>.<constructor>` from the manifest (e.g. `MyPub.LinearInput`).

Key invariants we rely on:

- A workspace folder is a PCF project iff `ControlManifest.Input.xml` exists
  at its root.
- A `.cdsproj` solution wrapper is independent of the controls inside it;
  one wrapper can reference many `.pcfproj` files.
- `pac pcf push` is publisher-prefix-scoped and creates a Dataverse solution
  named `PowerAppsTools_<Prefix>` under the hood. This is for **dev** use; it
  is not what you ship.

---

## 3. Source-of-controls model

The extension maintains a **PCF workspace map** built by scanning for
`ControlManifest.Input.xml` on activation and watching for file changes. Each
match is a `PcfControlProject` with:

| Field                  | Source                                                 |
| ---------------------- | ------------------------------------------------------ |
| `rootUri`              | Folder containing the manifest                         |
| `namespace`, `name`    | `<control namespace="…" constructor="…">` in manifest  |
| `version`              | `<control version="…">`                                |
| `controlType`          | `standard` \| `virtual` \| `dataset` (heuristic on manifest) |
| `displayName`, `description` | Manifest attributes                              |
| `templateKind`         | TS / React (detected from `package.json` deps)         |
| `lastBuildOutputDir`   | From `pcfconfig.json` if present, else `out/controls/<name>` |

Detection is done by a `PcfProjectLocator` service (mirrors
`RibbonSourceLocator`), one scan on activation plus a `FileSystemWatcher` for
`**/ControlManifest.Input.xml`. Matched projects are cached and exposed to
both the tree view and command handlers.

The set of `.cdsproj` wrappers in the workspace is tracked separately — a
wrapper isn't required to push, only to package for release.

---

## 4. Feature layout

New feature folder, mirroring existing conventions:

```
src/features/pcf/
  models.ts                       // domain types (see §6)
  pacCli.ts                       // thin wrapper around `pac` invocations (detect, version, run)
  npmRunner.ts                    // run `npm install` / `npm run build` / `npm start watch`
  pcfProjectLocator.ts            // scans workspace, parses manifests → PcfControlProject[]
  pcfManifestReader.ts            // parse ControlManifest.Input.xml (read-only in v1)
  pcfBuildService.ts              // ensure-deps + build orchestration (per project)
  pcfPushService.ts               // pac pcf push wrapper, picks publisher prefix, env-binds
  pcfPackageService.ts            // generate/reuse .cdsproj, dotnet build → solution zip
  pcfDeployService.ts             // package → ImportSolution via existing DataverseClient
  pcfEnvironmentService.ts        // list `customcontrols` from a Dataverse env, filter by solution
  pcfExplorer.ts                  // vscode.TreeDataProvider (the activity-bar view)
  pcfStatusBar.ts                 // watch-mode indicators
  commands/
    pcfWorkspaceCommands.ts       // init, openManifest, build, watch, stopWatch, push
    pcfReleaseCommands.ts         // package, deploy, deployLast
    pcfExplorerCommands.ts        // refresh, openInCrm, updateFromLocal, toggleSolutionFilter
  __tests__/
    pcfProjectLocator.test.ts
    pcfManifestReader.test.ts
    pcfPackageService.test.ts     // .cdsproj generation shape
    pacCli.test.ts                // arg construction, JSON output parsing
```

Wiring:

- `createServices.ts` instantiates `PacCli`, `PcfProjectLocator`,
  `PcfBuildService`, `PcfPushService`, `PcfPackageService`,
  `PcfDeployService`, `PcfEnvironmentService`. They depend on the existing
  `EnvironmentConnectionService`, `DataverseClient`, and `SolutionComponentService`.
- `registerCommands.ts` registers all PCF commands + the tree view + the
  watch-mode status bar item.
- `package.json` gets:
  - A new view `dynamics365Tools.pcfExplorer` under the existing
    `dynamics365tools-utility` view container.
  - `onCommand:dynamics365Tools.pcf.*` activation events.
  - `view/item/context` menu entries on PCF tree nodes and on
    `ControlManifest.Input.xml` in the file explorer.

### Dependencies to add

- None new from npm. We invoke `pac` and `npm`/`dotnet` as child processes;
  manifest parsing uses `fast-xml-parser` (already added for the ribbon
  feature plan — share the dependency).
- **External requirements** (detected, not bundled):
  - **Power Platform CLI** (`pac`). Detected via `pac --version`. If missing,
    every PCF command short-circuits to a single notification with a "Install
    pac CLI" action that opens the docs URL.
  - **Node.js** + **npm**. Required for `pac pcf init` and `npm run build`.
    Detected once on first PCF command.
  - **.NET SDK** + **MSBuild**. Required *only* for the release/package path.
    Detected lazily on first package/deploy.

The detection results are cached per session and surfaced as a single
"Environment check" tree node so the user can see status without running a
command.

---

## 5. The `pac` dependency — why and how

We wrap `pac` rather than reimplement because:

- The build/bundle stack (webpack config, manifest validation, type emission)
  changes per pac version and is not contractually stable.
- `pac pcf push` does a lot of work — incremental publisher-prefix solution
  management, manifest version bumping, Dataverse import — that we'd have to
  re-derive from undocumented behavior.
- `dotnet build` of a `.cdsproj` is the *only* officially supported way to
  produce a release-ready solution zip for PCF.

The wrapper (`pacCli.ts`) is intentionally thin:

```ts
class PacCli {
  detect(): Promise<{ available: boolean; version?: string; path?: string }>;
  whoami(): Promise<PacAuthProfile | null>;            // checks active profile
  authCreate(opts: PacAuthCreateOpts): Promise<void>;  // optional v2 sync with env bindings
  pcfInit(opts: PcfInitOpts, cwd: string): Promise<PacRunResult>;
  pcfPush(opts: PcfPushOpts, cwd: string): Promise<PacRunResult>;
  solutionInit(opts: SolutionInitOpts, cwd: string): Promise<PacRunResult>;
  solutionAddReference(opts: { project: string }, cwd: string): Promise<PacRunResult>;
  run(args: string[], cwd: string, onLine?: (l: string) => void): Promise<PacRunResult>;
}
```

`PacRunResult` carries `stdout`, `stderr`, `exitCode`, and a parsed structured
payload when the command supports `--json` (newer `pac` versions do; the wrapper
falls back to line scraping otherwise).

### Auth alignment

`pac` keeps its own auth profile, separate from `EnvironmentConnectionService`.
Two-way sync is out of scope for v1 — users will see `pac` use whichever profile
is currently active. We surface the active `pac` profile in the explorer header
and, when the extension's bound environment URL doesn't match the active `pac`
profile, show a single warning chip with a "Sync `pac` to bound environment"
action that runs `pac auth create --url <bound> --name d365-tools` interactively.

---

## 6. Domain model (TypeScript)

```ts
interface PcfControlProject {
  rootUri: string;                    // workspace folder for this control
  manifestUri: string;                // ControlManifest.Input.xml path
  namespace: string;                  // <control namespace="…">
  constructor: string;                // <control constructor="…"> (logical name half)
  fullName: string;                   // `${namespace}.${constructor}`
  version: string;                    // semver-ish from manifest
  controlType: "field" | "dataset" | "virtual";
  displayName?: string;
  description?: string;
  templateKind: "ts" | "react" | "unknown";
  outputDir: string;                  // resolved from pcfconfig.json or default
  hasNodeModules: boolean;            // gates auto npm install
  cdsProjectUri?: string;             // the .cdsproj that references it, if any
}

interface CdsSolutionProject {
  rootUri: string;
  cdsProjectUri: string;              // .cdsproj path
  referencedPcfProjects: string[];    // resolved .pcfproj paths
  publisherPrefix?: string;           // from Solution.xml inside src/
  solutionUniqueName?: string;
}

interface DeployedPcfControl {
  customControlId: string;            // customcontrolid
  name: string;                       // `${namespace}.${constructor}` per env
  version: string;
  managed: boolean;
  solutionUniqueName?: string;        // resolved via SolutionComponentService
  workspaceMatch?: PcfControlProject; // joined by fullName when present
}

interface PacRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  parsed?: unknown;                   // when --json was used
}
```

The model deliberately stays close to what `pac` and the manifest already
expose — we don't fabricate an abstraction over PCF, we just type the ground
truth.

---

## 7. Tree view (PcfExplorer)

A new view `dynamics365Tools.pcfExplorer`, in the existing
`dynamics365tools-utility` view container. Hierarchy:

```
PCF Controls
├── ⚙ Toolchain               (pac vX.Y.Z · node vN · dotnet vM)
│
├── 📁 Workspace
│   ├── 📄 MyPub.LinearInput          (field control, TS)
│   │   ├── Manifest (ControlManifest.Input.xml)
│   │   ├── Properties: ns=MyPub, version=1.0.7, template=field
│   │   ├── Build status: ✓ built 2m ago / ✗ failed / · never built
│   │   └── Bound env: deployed v1.0.6 (1 version behind)
│   ├── 📄 MyPub.ColourPicker         (dataset control, React)
│   │   └── …
│   └── 📦 Solutions (.cdsproj)
│       └── 🗂  MyControlsSolution
│           ├── Publisher prefix: mypub
│           └── References: MyPub.LinearInput, MyPub.ColourPicker
│
└── ☁ Environment: dev01 (filtered to "Default Solution")
    ├── MyPub.LinearInput   v1.0.6  · unmanaged
    │     ↪ matches workspace project
    ├── MyPub.ColourPicker  v1.0.0  · managed
    └── Marketplace.SuperSlider v2.1.0 · managed
```

Inline actions (mirroring the plugin explorer's menu conventions):

| Node                        | Inline actions                                                |
| --------------------------- | ------------------------------------------------------------- |
| Workspace                   | New Control (`pac pcf init`), Refresh                         |
| Control project             | Open Manifest, Build, Watch, Push to Env, Package, Deploy…    |
| `.cdsproj` solution         | Build Solution (managed), Build Solution (unmanaged), Deploy  |
| Environment                 | Refresh, Toggle Solution Filter, Set Solution Filter…         |
| Deployed control            | Open in Power Apps, Update from Local (if matched), Copy Id   |

Header items:
- **"Toolchain"** node: status of `pac`, node, dotnet detection. Click to
  re-detect.
- **"Watch"** status-bar indicator when `npm start watch` is running, with a
  click action to stop it.

---

## 8. Workspace flows

### 8.1 Create a new control (`New Control`)

1. Multi-step form (QuickPick chain — no webview needed for v1):
   - **Parent folder**: workspace folder picker, defaults to the active root.
   - **Namespace**: e.g. `MyPub`. Validated against `^[A-Za-z][A-Za-z0-9]*$`.
   - **Name**: e.g. `LinearInput`. Same validation.
   - **Template**: `field` | `dataset`.
   - **Framework**: `none` | `react`.
2. Run `pac pcf init --namespace … --name … --template … --framework …` in the
   target folder, streaming stdout to the output channel.
3. On success, run `npm install` automatically (with a "skip" option for users
   who manage installs manually).
4. Refresh the locator; the new project appears under Workspace.
5. Open `index.ts` in an editor.

### 8.2 Build / Watch

- **Build**: ensure `node_modules` (offer install if missing), then
  `npm run build`. Build output streams to a per-project output channel
  (`PCF: <fullName>`). Exit code 0 marks `build status = ✓`, non-zero =
  `✗ failed (<n> errors)`; errors are parsed via the standard TS problem
  matcher and surfaced to VS Code's Problems panel.
- **Watch**: spawn `npm start watch` as a long-running task. Status bar shows
  "⟳ PCF: LinearInput watching". Stopping the watch is one click on the status
  bar. Only one watch per project at a time.

### 8.3 Push to environment (dev inner loop)

1. From a control project node: **Push to Environment**.
2. Resolve target env from the existing `EnvironmentConnectionService`. If
   none is bound or the bound env doesn't match the active `pac` auth profile,
   prompt to sync (§5).
3. Resolve publisher prefix:
   - If the project sits under a `.cdsproj` solution and that solution has a
     prefix in its `Solution.xml`, use it.
   - Otherwise prompt once, persist per-project in `.vscode/d365-tools/pcf.json`.
4. Run `pac pcf push --publisher-prefix <p>`. Stream output, show progress.
5. On success, refresh the **Environment** tree to surface the new version.

### 8.4 Package + Deploy (release path)

This is the path that produces something you actually ship.

1. **Package** on a control project (or a `.cdsproj` node):
   - If a `.cdsproj` wrapper for this control already exists, reuse it.
   - Otherwise prompt: "Create a new solution wrapper at `<workspace>/solution/`?"
     If yes: `pac solution init --publisher-name … --publisher-prefix …` then
     `pac solution add-reference --path <.pcfproj path>`.
   - Run `dotnet build /p:configuration=Release` (or `/p:configuration=Debug`
     for unmanaged). Capture the produced solution zip path from the build
     output.
2. **Deploy** (offered as a follow-up step, or independently from a
   `.cdsproj` node):
   - Pick the target environment from `EnvironmentConnectionService`.
   - Call `DataverseClient.importSolution(zipBytes, { OverwriteUnmanagedCustomizations: true })`.
     The plugin assembly flow already has this exact import-job polling
     pipeline (`ImportJobId` pre-generated, status polled, errors parsed) —
     extract that into a small shared helper if it isn't already shared, and
     reuse it. Do not duplicate the polling logic.
   - On success, run `PublishXml` with `<importexportxml><customcontrols><customcontrol>…</customcontrol></customcontrols></importexportxml>`
     for the published controls.
3. **Deploy Last** mirrors `Publish Last Assembly` from plugins — single-click
   re-deploy of the most recently packaged zip.

---

## 9. Environment explorer

The "Environment" tree node uses `PcfEnvironmentService.list()`, which under
the hood queries `customcontrols` via the existing `DataverseClient`:

```
GET /api/data/v9.2/customcontrols
  ?$select=customcontrolid,name,version,iscustomizable,ismanaged
  ?$orderby=name
```

Solution filtering reuses `SolutionComponentService.listComponentsForSolution`
(componenttype `66` = Custom Control). The filter UX mirrors the plugin
explorer's `enableSolutionFilter` / `disableSolutionFilter` / `toggleSolutionFilter`
commands so users get one mental model.

Workspace-to-deployed matching is a simple inner join on
`PcfControlProject.fullName` vs `DeployedPcfControl.name`. When matched, the
deployed node gets a "↪ matches workspace project" chip and the version
comparison ("1 version behind" / "in sync" / "ahead — env not updated yet").

"Update from Local" on a matched deployed control is a shortcut to the **Push
to Environment** flow targeted at this env, with the publisher prefix
pre-resolved from the deployed solution's publisher when possible.

---

## 10. Validation

Validation is light because `pac` and `tsc` already do the heavy lifting. We
add only what is unique to *our* surface:

- **Manifest readability**: parse failures show a single error on the project
  node ("Manifest unparseable — see XYZ"). The project is otherwise unusable.
- **Namespace.name uniqueness** within the workspace: two projects with the
  same `fullName` would race on push. Flag with a warning.
- **Publisher prefix presence** before `Push to Environment` — block with an
  actionable prompt rather than a failed `pac` invocation.
- **Toolchain availability** before any action that needs it. Pre-flight; do
  not let a `pac not found` failure surface as a generic spawn error.
- **Version drift** (workspace > env, env > workspace) — informational only.

---

## 11. Persistence

Per-workspace settings live in `.vscode/d365-tools/pcf.json`:

```json
{
  "projects": {
    "controls/LinearInput": {
      "publisherPrefix": "mypub",
      "lastDeployedZip": "solution/bin/Release/MyControlsSolution.zip",
      "lastDeployedEnv": "dev01"
    }
  },
  "watchProjects": []
}
```

`lastDeployedZip` powers "Deploy Last"; `watchProjects` is restored on
extension activation so a previously running watch can be offered for
re-launch (but never auto-launched).

---

## 12. Open questions / assumptions

1. **pac as required dependency**: we treat absence of `pac` as "feature
   unavailable" and never auto-install. Confirm; alternative is to bundle
   install instructions / scripted install for macOS via `dotnet tool install`.
2. **One `.cdsproj` per control vs. one shared**: default assumption is
   one shared wrapper under `solution/`, referencing every control in the
   workspace. Per-control wrappers are supported but not the default. Verify
   this matches how you actually ship.
3. **Auth profile sync**: v1 only nudges the user; we don't quietly run
   `pac auth create` on their behalf. Confirm this is the right boundary.
4. **Update existing deployed controls** that don't match a workspace
   project: we surface them read-only. No "pull into workspace" because `pac`
   doesn't support it cleanly. Acceptable for v1?
5. **`pac pcf push` version bump**: by default it bumps the manifest patch
   version on every push. We expose `--no-version-bump` (newer `pac` versions
   only) as an opt-in via setting. If your `pac` is older we silently fall
   back to letting it bump.
6. **Multi-root workspaces**: locator scans every workspace folder. Confirm
   we want that or restrict to the active folder.

---

## 13. Phased rollout

The phasing keeps each step independently shippable.

### Phase 1 — Discovery + toolchain plumbing (≈ 2 days)

- `PacCli` wrapper + detection.
- `PcfProjectLocator` + manifest reader.
- `PcfExplorer` tree (read-only) showing workspace projects + toolchain
  status. No environment node yet.
- "Open Manifest" command.

Exit criteria: open a workspace with PCF projects, see every control and its
manifest properties in the tree. Toolchain node shows accurate pac/node/dotnet
status.

### Phase 2 — Build + Watch + Init (≈ 2–3 days)

- `npmRunner` + `PcfBuildService` (with auto `npm install` prompt).
- Watch mode + status bar.
- "New Control" wizard wrapping `pac pcf init`.
- Per-project output channels; Problems panel integration for TS errors.

Exit criteria: scaffold a new control via the wizard, build it, run watch, see
TS errors in the Problems panel.

### Phase 3 — Push to env (dev loop) + env explorer (≈ 2–3 days)

- `PcfPushService` wrapping `pac pcf push`.
- Publisher prefix resolution + per-project persistence.
- `PcfEnvironmentService` listing `customcontrols`, solution filtering.
- Workspace ↔ deployed matching + version drift chips.

Exit criteria: push a control to the bound env from VS Code; refresh the env
tree and see the new version; matched workspace project shows "in sync".

### Phase 4 — Package + Deploy (release path) (≈ 3 days)

- `PcfPackageService`: detect or scaffold `.cdsproj`, run `dotnet build`.
- `PcfDeployService`: hand the produced zip to the shared `ImportSolution`
  helper extracted from plugin assemblies; reuse import-job polling and error
  parsing.
- `PublishXml` for deployed customcontrols.
- "Deploy Last" command.

Exit criteria: from a clean workspace, scaffold a control, build a managed
solution zip, deploy it to a separate env, and see the control surface in
Power Apps with no manual steps in between.

### Phase 5 — Polish / stretch

- Sync `pac` auth profile to bound env automatically.
- Telemetry events for build/push/deploy success rates.
- Per-control `pcfconfig.json` editor.
- Inline "version drift" actions (one-click "deploy newer / pull-down older").
- Multi-workspace-folder filter toggle.

---

## 14. Testing

- **`pcfProjectLocator.test.ts`**: synthetic workspaces with 0 / 1 / many
  controls, including nested under `.cdsproj` wrappers.
- **`pcfManifestReader.test.ts`**: parse the standard scaffold + a hand-edited
  manifest with additional `<property>` and `<resources>` blocks. Forward-compat
  test for unknown attributes (parse must not throw).
- **`pacCli.test.ts`**: argument construction for `pcf init` / `pcf push` /
  `solution init` / `solution add-reference`. JSON-output parsing when
  available, line scraping as fallback. Mocks `child_process.spawn`.
- **`pcfPackageService.test.ts`**: synthetic workspace → assert the produced
  `.cdsproj` and `Solution.xml` shape against a known-good fixture. We do not
  run `dotnet build` in unit tests; an integration script invokes it on demand.
- **`pcfDeployService.test.ts`**: zip-bytes → `DataverseClient.importSolution`
  is called with the right headers and body; success/failure paths surface to
  the same UI as plugin assembly deploys.
- **Manual checklist** in PR for: init wizard, build, watch start/stop, push
  to env, env tree matching/filtering, package + deploy round trip. Follows
  the project convention of "no automated UI tests for VS Code views".

---

## 15. Risks

1. **`pac` CLI churn**: argument names and JSON output shapes change across
   versions. Mitigated by detecting version and feature-gating
   (`--no-version-bump`, `--json`, etc.). The wrapper is the only place this
   matters.
2. **Long-running child processes**: `npm install`, `npm start watch`,
   `dotnet build` can run for minutes. We must report progress, allow cancel,
   and ensure processes are killed on extension deactivation. The plugin
   feature has prior art for this — we should share a `LongRunningProcess`
   helper rather than copy-paste.
3. **Auth profile mismatch silent failures**: `pac pcf push` will happily
   push to whichever env is in `pac`'s active profile, ignoring the
   extension's bound env. Mitigated by pre-flight check + chip in tree header.
   *This is the most likely "it deployed to the wrong env" incident.*
4. **`.cdsproj` regeneration drift**: if the user hand-edits the wrapper,
   we must not clobber it. We only scaffold when none exists and never
   modify an existing wrapper — adding references is the only mutation, and
   we delegate that to `pac solution add-reference`.
5. **Toolchain availability on first run**: Windows users typically have all
   three (pac, node, dotnet); macOS/Linux developers may not have dotnet.
   The release path is gracefully degraded — push-to-env still works
   without dotnet; package/deploy fails fast with an actionable error.

---

## 16. Effort estimate

Roughly **2–2.5 weeks** of focused implementation for phases 1–4 (the
shippable v1). Phase 5 is open-ended.

Less than the ribbon editor because we delegate the hard parts (build,
manifest validation, version management) to `pac`. The two longest sub-tasks
are (a) getting the `.cdsproj` scaffold + `dotnet build` orchestration right
in phase 4 and (b) the workspace↔environment matching UI in phase 3 — neither
is correctness-critical the way the ribbon parser is, but both are where the
UX lives or dies.

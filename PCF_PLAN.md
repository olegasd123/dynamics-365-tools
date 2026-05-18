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
- **Watch** mode via the project watch script (usually `npm start watch`) —
  long-running test harness with status bar indicator.
- **Push for dev** via
  `pac pcf push --environment <bound-env-url> --publisher-prefix <p>` against
  the active environment binding — the fast inner loop. No solution authoring
  required.
- **Tree view** in the activity bar alongside the Plugin Explorer.

### Follow-up goals (v1.1)

- **Explore deployed controls**: list `customcontrols` in the bound environment
  (filterable by solution, mirroring the plugin explorer), see which workspace
  project each one corresponds to (matched by `namespace.name`), and trigger
  "Update from local project" or "Open in Power Apps" per row.
- **Package for release**: produce a managed/unmanaged solution `.zip` by
  generating (or reusing) a `.cdsproj` wrapper, adding the `.pcfproj` as a
  reference, and running `dotnet build`.
- **Deploy packaged solutions** by importing the produced `.zip` against any
  configured environment through a new shared solution import service.

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
- Automatic manifest version policies. If a future `pac` version supports a
  push-time no-version-bump flag, we feature-gate it after checking
  `pac pcf push --help`.

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
project) are produced on demand for release builds — they are _not_ required
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

| Field                        | Source                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| `rootUri`                    | Folder containing the manifest                               |
| `namespace`, `name`          | `<control namespace="…" constructor="…">` in manifest        |
| `version`                    | `<control version="…">`                                      |
| `controlType`                | `field` \| `dataset` \| `virtual` (heuristic on manifest)    |
| `displayName`, `description` | Manifest attributes                                          |
| `templateKind`               | TS / React (detected from `package.json` deps)               |
| `lastBuildOutputDir`         | From `pcfconfig.json` if present, else `out/controls/<name>` |

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
  processRunner.ts                // cancellable child processes + output streaming
  pacCli.ts                       // thin wrapper around `pac` invocations (detect, version, run)
  npmRunner.ts                    // run detected npm scripts through processRunner
  pcfProjectLocator.ts            // scans workspace, parses manifests → PcfControlProject[]
  pcfManifestReader.ts            // parse ControlManifest.Input.xml (read-only in v1)
  pcfBuildService.ts              // ensure-deps + build orchestration (per project)
  pcfPushService.ts               // pac pcf push wrapper, picks publisher prefix, env-binds
  pcfPackageService.ts            // generate/reuse .cdsproj, dotnet build → solution zip
  solutionImportService.ts        // ImportSolution/ImportSolutionAsync + polling
  pcfDeployService.ts             // package → solution import via DataverseClient
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
  `SolutionImportService`, `PcfDeployService`, `PcfEnvironmentService`. They
  depend on the existing `EnvironmentConnectionService`, `DataverseClient`, and
  `SolutionComponentService`.
- `registerCommands.ts` registers all PCF commands + the tree view + the
  watch-mode status bar item.
- `package.json` gets:
  - A new view `dynamics365Tools.pcfExplorer` under the existing
    `dynamics365tools-utility` view container.
  - `onCommand:dynamics365Tools.pcf.*` activation events.
  - `view/item/context` menu entries on PCF tree nodes and on
    `ControlManifest.Input.xml` in the file explorer.

### Dependencies to add

- **Add `fast-xml-parser`**. We invoke `pac` and `npm`/`dotnet` as child
  processes; manifest and `.cdsproj` parsing uses the XML parser.
- **External requirements** (detected, not bundled):
  - **Power Platform CLI** (`pac`). Detected via `pac --version`. If missing,
    every PCF command short-circuits to a single notification with a "Install
    pac CLI" action that opens the docs URL.
  - **Node.js** + **npm**. Required for `pac pcf init` and `npm run build`.
    Detected once on first PCF command.
  - **.NET SDK** + **MSBuild**. Required _only_ for the release/package path.
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
- `dotnet build` of a `.cdsproj` is the _only_ officially supported way to
  produce a release-ready solution zip for PCF.

The wrapper (`pacCli.ts`) is intentionally thin:

```ts
class PacCli {
  detect(): Promise<{ available: boolean; version?: string; path?: string }>;
  help(args: string[]): Promise<string>; // used for feature gates
  whoami(): Promise<PacAuthProfile | null>; // checks active profile
  authCreate(opts: PacAuthCreateOpts): Promise<void>; // optional v2 sync with env bindings
  pcfInit(opts: PcfInitOpts, cwd: string): Promise<PacRunResult>;
  pcfPush(opts: PcfPushOpts, cwd: string): Promise<PacRunResult>;
  solutionInit(opts: SolutionInitOpts, cwd: string): Promise<PacRunResult>;
  solutionAddReference(opts: { project: string }, cwd: string): Promise<PacRunResult>;
  run(args: string[], cwd: string, onLine?: (l: string) => void): Promise<PacRunResult>;
}
```

`PacRunResult` carries `stdout`, `stderr`, `exitCode`, and a parsed structured
payload when the command supports `--json`. Support for optional flags is not
assumed from the CLI version string alone; the wrapper checks command help and
feature-gates flags such as JSON output or future version-bump controls.

### Auth alignment

`pac` keeps its own auth profile, separate from `EnvironmentConnectionService`.
The VS Code bound environment is still the source of truth for PCF commands.
`PcfPushService` passes `--environment <bound-env-url>` so the active `pac`
profile does not silently send a push to the wrong organization.

Two-way sync is out of scope for v1. We surface the active `pac` profile in the
explorer header and, when the extension's bound environment URL doesn't match
the active `pac` profile, show a warning chip with a "Sync `pac` to bound
environment" action that runs `pac auth create --url <bound> --name d365-tools`
interactively.

---

## 6. Domain model (TypeScript)

```ts
interface PcfControlProject {
  rootUri: string; // workspace folder for this control
  manifestUri: string; // ControlManifest.Input.xml path
  namespace: string; // <control namespace="…">
  constructor: string; // <control constructor="…"> (logical name half)
  fullName: string; // `${namespace}.${constructor}`
  version: string; // semver-ish from manifest
  controlType: "field" | "dataset" | "virtual";
  displayName?: string;
  description?: string;
  templateKind: "ts" | "react" | "unknown";
  outputDir: string; // resolved from pcfconfig.json or default
  hasNodeModules: boolean; // gates auto npm install
  cdsProjectUri?: string; // the .cdsproj that references it, if any
}

interface CdsSolutionProject {
  rootUri: string;
  cdsProjectUri: string; // .cdsproj path
  referencedPcfProjects: string[]; // resolved .pcfproj paths
  publisherPrefix?: string; // from Solution.xml inside src/
  solutionUniqueName?: string;
}

interface DeployedPcfControl {
  customControlId: string; // customcontrolid
  name: string; // `${namespace}.${constructor}` per env
  version: string;
  managed: boolean;
  solutionUniqueName?: string; // resolved via SolutionComponentService
  workspaceMatch?: PcfControlProject; // joined by fullName when present
}

interface PacRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  parsed?: unknown; // when --json was used
}
```

The model deliberately stays close to what `pac` and the manifest already
expose — we don't fabricate an abstraction over PCF, we just type the ground
truth.

---

## 7. Tree view (PcfExplorer)

A new view `dynamics365Tools.pcfExplorer`, in the existing
`dynamics365tools-utility` view container.

Initial v1 hierarchy:

```
PCF Controls
├── ⚙ Toolchain               (pac vX.Y.Z · node vN · dotnet vM)
│
└── 📁 Workspace
    ├── 📄 MyPub.LinearInput          (field control, TS)
    │   ├── Manifest (ControlManifest.Input.xml)
    │   ├── Properties: ns=MyPub, version=1.0.7, template=field
    │   └── Build status: ✓ built 2m ago / ✗ failed / · never built
    └── 📄 MyPub.ColourPicker         (dataset control, React)
```

Full hierarchy after the environment explorer and release phases:

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

| Node                | Inline actions                                               |
| ------------------- | ------------------------------------------------------------ |
| Workspace           | New Control (`pac pcf init`), Refresh                        |
| Control project     | Open Manifest, Build, Watch, Push to Env, Package, Deploy…   |
| `.cdsproj` solution | Build Solution (managed), Build Solution (unmanaged), Deploy |
| Environment         | Refresh, Toggle Solution Filter, Set Solution Filter…        |
| Deployed control    | Open in Power Apps, Update from Local (if matched), Copy Id  |

Header items:

- **"Toolchain"** node: status of `pac`, node, dotnet detection. Click to
  re-detect.
- **"Watch"** status-bar indicator when a watch process is running, with a
  click action to stop it.

---

## 8. Workspace flows

### 8.1 Create a new control (`New Control`)

1. Multi-step form (QuickPick chain — no webview needed for v1):
   - **Parent folder**: workspace folder picker, defaults to the active root.
   - **Namespace**: e.g. `MyPub` or `Contoso.Controls`. Validate with the
     same rules as `pac`: letters, numbers, and dots; no leading/trailing dot;
     no consecutive dots; no number at the start or right after a dot.
   - **Name**: e.g. `LinearInput`. Letters and numbers only; first character
     cannot be a number.
   - **Template**: `field` | `dataset`.
   - **Framework**: `none` | `react`.
2. Run `pac pcf init --namespace … --name … --template … --framework …` in the
   target folder, streaming stdout to the output channel.
3. Offer install behavior before running the command:
   - Use `--run-npm-install` when the user wants the CLI to install.
   - Skip install for users who manage dependencies manually.
4. Refresh the locator; the new project appears under Workspace.
5. Open `index.ts` in an editor.

### 8.2 Build / Watch

- **Build**: ensure `node_modules` (offer install if missing), then read
  `package.json` and run the `build` script. Build output streams to a
  per-project output channel (`PCF: <fullName>`). Exit code 0 marks
  `build status = ✓`, non-zero = `✗ failed (<n> errors)`; errors are parsed via
  the standard TS problem matcher and surfaced to VS Code's Problems panel.
- **Production build**: expose a separate release command that runs
  `npm run build -- --buildMode production` when the project has a `build`
  script.
- **Watch**: read `package.json` and prefer the generated PCF watch command
  (`npm start watch`) when available. If the script shape differs, show an
  actionable error instead of guessing. Status bar shows
  "⟳ PCF: LinearInput watching". Stopping the watch is one click on the status
  bar. Only one watch per project at a time.

### 8.3 Push to environment (dev inner loop)

1. From a control project node: **Push to Environment**.
2. Resolve target env from the existing `EnvironmentConnectionService`. If no
   environment is bound, prompt the user to pick one. If the bound env doesn't
   match the active `pac` auth profile, show the sync warning from §5 but still
   target the bound env explicitly.
3. Resolve publisher prefix:
   - If the project sits under a `.cdsproj` solution and that solution has a
     prefix in its `Solution.xml`, use it.
   - Otherwise prompt once, validate the prefix (`2-8` alphanumeric chars,
     starts with a letter, cannot start with `mscrm`), and persist per-project
     in `.vscode/d365-tools/pcf.json`.
4. Run `pac pcf push --environment <bound-env-url> --publisher-prefix <p>`.
   Stream output, show progress.
5. On success, refresh the workspace node. If the environment explorer feature
   is installed, refresh it too.

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
   - Call a new shared `SolutionImportService.importSolution(zipBytes, opts)`.
     This service owns `ImportSolution`/`ImportSolutionAsync`, pre-generated
     `ImportJobId`, async-operation or import-job polling, timeout handling,
     and import log/error parsing. The current plugin assembly flow updates
     Dataverse plugin tables directly, so this import service is new platform
     plumbing rather than an extraction from plugin publishing.
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
  ?$select=customcontrolid,name,version,ismanaged,solutionid
  ?$orderby=name
```

Solution filtering reuses `SolutionComponentService.listComponentIdsForSolutions`
with `SolutionComponentType.CustomControl = 66`. The filter UX mirrors the
plugin explorer's `enableSolutionFilter` / `disableSolutionFilter` /
`toggleSolutionFilter` commands so users get one mental model.

The `customcontrols` table is treated as a best-effort read model. If a field
is missing in an older or unusual environment, the explorer still shows the
control name and ID.

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
add only what is unique to _our_ surface:

- **Manifest readability**: parse failures show a single error on the project
  node ("Manifest unparseable — see XYZ"). The project is otherwise unusable.
- **Namespace.name uniqueness** within the workspace: two projects with the
  same `fullName` would race on push. Flag with a warning.
- **Namespace and control name validity** before `pac pcf init`, using the
  documented CLI rules instead of a looser local rule.
- **Publisher prefix presence** before `Push to Environment` — block with an
  actionable prompt rather than a failed `pac` invocation. Validate `2-8`
  alphanumeric chars, starts with a letter, and does not start with `mscrm`.
- **Toolchain availability** before any action that needs it. Pre-flight; do
  not let a `pac not found` failure surface as a generic spawn error.
- **Optional CLI flags** are checked with command help before use. Do not assume
  flags like `--json` or no-version-bump support from the installed version
  string alone.
- **Version drift** (workspace > env, env > workspace) — informational only.

---

## 11. Persistence

Per-workspace settings live in `.vscode/d365-tools/pcf.json`:

```json
{
  "projects": {
    "controls/LinearInput": {
      "publisherPrefix": "mypub",
      "lastPackagedZip": "solution/bin/Release/MyControlsSolution.zip",
      "lastDeployedEnv": "dev01"
    }
  },
  "watchProjects": []
}
```

`lastPackagedZip` powers deploy follow-ups and "Deploy Last"; `watchProjects`
is restored on extension activation so a previously running watch can be
offered for re-launch (but never auto-launched).

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
   `pac auth create` on their behalf. Push still passes `--environment`, so the
   sync action is for user clarity and token setup, not environment selection.
4. **Update existing deployed controls** that don't match a workspace
   project: we surface them read-only. No "pull into workspace" because `pac`
   doesn't support it cleanly. Acceptable for v1?
5. **`pac pcf push` version bump**: current documented `pac pcf push` options
   do not include a no-version-bump flag. If a user's installed CLI exposes one
   in `pac pcf push --help`, we can add an opt-in setting later. Otherwise we
   let `pac` own version behavior.
6. **Multi-root workspaces**: locator scans every workspace folder. Confirm
   we want that or restrict to the active folder.

---

## 13. Phased rollout

The phasing keeps each step independently shippable.

### Phase 1 — Discovery + toolchain/process plumbing (≈ 2 days)

- `PacCli` wrapper + detection.
- `ProcessRunner` for cancellable child processes, output streaming, exit-code
  capture, and extension deactivation cleanup.
- Add `fast-xml-parser`.
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

### Phase 3 — Push to env (dev loop) (≈ 1–2 days)

- `PcfPushService` wrapping
  `pac pcf push --environment <bound-env-url> --publisher-prefix <prefix>`.
- Publisher prefix resolution + per-project persistence.
- Auth mismatch warning and optional sync action.

Exit criteria: push a control to the bound env from VS Code and confirm from
`pac` output that the target environment is the selected bound environment.

### Phase 4 — Environment explorer (≈ 2 days)

- `PcfEnvironmentService` listing `customcontrols`, with best-effort field
  handling.
- `SolutionComponentType.CustomControl = 66` and solution filtering through
  `SolutionComponentService.listComponentIdsForSolutions`.
- Workspace ↔ deployed matching + version drift chips.
- "Update from Local" shortcut to the Phase 3 push flow.

Exit criteria: refresh the env tree and see deployed controls; matched
workspace projects show version drift or "in sync".

### Phase 5 — Package (release path) (≈ 2–3 days)

- `PcfPackageService`: detect or scaffold `.cdsproj`, run `dotnet build`.
- Capture the produced managed/unmanaged solution zip path from build output.
- Persist `lastPackagedZip` per project or solution wrapper.

Exit criteria: from a clean workspace, scaffold a control and build a managed
or unmanaged solution zip with no manual command-line steps.

### Phase 6 — Deploy packaged solution (release path) (≈ 3–4 days)

- `SolutionImportService`: implement `ImportSolution`/`ImportSolutionAsync`,
  import-job polling, timeout handling, and import log/error parsing.
- `PcfDeployService`: hand the produced zip to `SolutionImportService`.
- `PublishXml` for deployed customcontrols.
- "Deploy Last" command.

Exit criteria: deploy a packaged solution zip to a separate env and see the
control surface in Power Apps with no manual steps after selecting the target
environment.

### Phase 7 — Polish / stretch

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
  `solution init` / `solution add-reference`. Assert that push includes
  `--environment`. JSON-output parsing when available, line scraping as
  fallback. Mocks `child_process.spawn`.
- **`processRunner.test.ts`**: output streaming, cancellation, non-zero exits,
  and deactivation cleanup for long-running child processes.
- **`pcfPackageService.test.ts`**: synthetic workspace → assert the produced
  `.cdsproj` and `Solution.xml` shape against a known-good fixture. We do not
  run `dotnet build` in unit tests; an integration script invokes it on demand.
- **`solutionImportService.test.ts`**: zip bytes → `ImportSolution` or
  `ImportSolutionAsync` is called with the right body, polling handles success,
  timeout, and failed import logs.
- **`pcfDeployService.test.ts`**: produced zip → `SolutionImportService` is
  called with the right target environment and import options; success/failure
  paths surface to the same UI style as other Dataverse commands.
- **Manual checklist** in PR for: init wizard, build, watch start/stop, push
  to env, env tree matching/filtering, package + deploy round trip. Follows
  the project convention of "no automated UI tests for VS Code views".

---

## 15. Risks

1. **`pac` CLI churn**: argument names and JSON output shapes change across
   versions. Mitigated by detecting availability and feature-gating optional
   flags through command help (`--json`, future version-bump flags, etc.). The
   wrapper is the only place this matters.
2. **Long-running child processes**: `npm install`, `npm start watch`,
   `dotnet build` can run for minutes. We must report progress, allow cancel,
   and ensure processes are killed on extension deactivation. Build this once
   as `ProcessRunner` and use it for `pac`, `npm`, and `dotnet`.
3. **Auth profile mismatch silent failures**: if `--environment` is omitted,
   `pac pcf push` can push to whichever env is in `pac`'s active profile. We
   always pass the bound environment URL and keep the mismatch warning as
   extra user context.
4. **`.cdsproj` regeneration drift**: if the user hand-edits the wrapper,
   we must not clobber it. We only scaffold when none exists and never
   modify an existing wrapper — adding references is the only mutation, and
   we delegate that to `pac solution add-reference`.
5. **Toolchain availability on first run**: Windows users typically have all
   three (pac, node, dotnet); macOS/Linux developers may not have dotnet.
   The release path is gracefully degraded — push-to-env still works
   without dotnet; package/deploy fails fast with an actionable error.
6. **Solution import complexity**: this repo does not currently have a shared
   solution import pipeline. `SolutionImportService` is a real feature, with
   async polling, log parsing, and timeout handling, so deploy is later than
   package in the rollout.

---

## 16. Effort estimate

Roughly **1–1.5 weeks** of focused implementation for phases 1–3 (the
shippable v1). Environment explorer and release packaging/deploy add another
**1–1.5 weeks** depending on how much polish goes into the import log UX.

Less than the ribbon editor because we delegate the hard parts (build,
manifest validation, version management) to `pac`. The two longest follow-up
sub-tasks are (a) the new solution import service and (b) the workspace ↔
environment matching UI — neither blocks the first useful PCF workflow, but
both are where the release-path UX lives or dies.

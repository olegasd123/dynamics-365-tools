# Ribbon Editor — Feature Plan

A structural editor for Dynamics 365 ribbons inside VS Code. Operates on solution
XML files in the workspace (no live environment edits required), supports all
ribbon scopes, and follows the "take control of OOB buttons" workflow popularized
by Ribbon Workbench: hide built-in buttons, then re-add them with our own
EnableRules, DisplayRules, and Actions.

The editor treats the original XML text as the source of truth. Parsed models are
used for navigation, validation, and forms; saving is done by applying small text
patches to known XML ranges. This keeps no-op saves stable and avoids dropping
unknown ribbon data.

---

## 1. Goals & non-goals

### Goals (first useful release)

- Edit `RibbonDiffXml` for all five ribbon scopes:
  - **Application ribbon** (global)
  - **Entity ribbon** in scopes `Form`, `HomepageGrid`, `SubGrid`
- Auto-detect two workspace layouts:
  - **Unpacked** (SolutionPackager / pp-cli): `Entities/<entity>/RibbonDiffXml.xml`,
    `Other/Customizations.xml` for the application ribbon, plus
    `AppRibbon/RibbonDiffXml.xml` if present.
  - **Flat**: a single `customizations.xml` with `RibbonDiffXml` nodes embedded
    under each `<Entity>` and at the root for the application ribbon.
- Save by patching only changed XML ranges; no-op saves must not rewrite files.
- Add / edit / reorder / remove **custom** buttons in tabs and groups.
- **Hide OOB buttons** (`<HideCustomAction>`).
- Manage `CommandDefinitions`, `EnableRules`, `DisplayRules`, and `LocLabels`.
- **JS action picker integrated with workspace web resources**: when defining
  a `JavaScriptFunction` action or rule, the library is picked from web
  resources already bound in this workspace (via the existing `BindingService`),
  not free-typed.
- Tree view in the activity bar, alongside the Plugin Explorer.

### Follow-up goals

- **Load ribbons from a solution `.zip` file** (Ribbon Workbench-style):
  open a zip from disk, extract ribbon-relevant files to extension storage or a
  temp folder, edit there, and save back into the zip by replace-original or
  save-as.
- **Publish changes directly to a Dataverse environment**: pick a configured
  environment, pack the edited ribbon files into an unmanaged solution zip,
  import it via the existing `SolutionImportService`, and run `PublishXml` for
  touched entities and the application ribbon when applicable.
- **Override OOB commands** by id so built-in buttons (`Mscrm.SavePrimary`,
  `Mscrm.AddNewRecordFromForm`, …) run our EnableRule / DisplayRule / Action
  chain instead of the platform's. This is advanced because it can replace
  default platform behavior.

### Non-goals (first useful release)

- Visual canvas / drag-and-drop preview of the rendered ribbon.
- Editing the OOB ribbon itself (we always diff against it, never modify it).
- Multi-language `LocLabels` UI (the data model supports it; UI is single-language
  with a raw "add language" escape hatch — full localization deferred).
- Editing `<Templates>` (we read/preserve them; authoring is deferred).
- Editing managed solutions.
- Environment pull/sync. The workspace XML remains the source of truth.

---

## 2. Background: what RibbonDiffXml actually contains

For grounding, each `RibbonDiffXml` has up to five blocks:

```xml
<RibbonDiffXml>
  <CustomActions>           <!-- Where do my changes attach to the OOB ribbon? -->
    <CustomAction Id="..." Location="..." Sequence="...">
      <CommandUIDefinition>
        <Button Id="..." Command="..." LabelText="..." Image16by16="..." />
      </CommandUIDefinition>
    </CustomAction>
    <HideCustomAction HideActionId="..." Location="..." />
  </CustomActions>
  <Templates />             <!-- Layout templates (we preserve, do not author) -->
  <CommandDefinitions>      <!-- What does the button DO? -->
    <CommandDefinition Id="...">
      <EnableRules>  <EnableRule Id="..." />  </EnableRules>
      <DisplayRules> <DisplayRule Id="..." /> </DisplayRules>
      <Actions>      <JavaScriptFunction Library="$webresource:..." FunctionName="..." />
                     <Url Address="..." /> ... </Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>         <!-- The rule library referenced above -->
    <TabDisplayRules />
    <DisplayRules> <DisplayRule Id="..."> ...rule steps... </DisplayRule> </DisplayRules>
    <EnableRules>  <EnableRule  Id="..."> ...rule steps... </EnableRule>  </EnableRules>
  </RuleDefinitions>
  <LocLabels>               <!-- Localized strings -->
    <LocLabel Id="..."> <Titles> <Title languagecode="1033" description="..." /> </Titles> </LocLabel>
  </LocLabels>
</RibbonDiffXml>
```

Key invariant: `RibbonDiffXml` is a _diff_ against the OOB ribbon — it only
contains the user's customizations. Everything else (the actual ribbon
structure, OOB tabs/groups/buttons) is implicit. Our tree view therefore shows
two distinct things:

- **Customizations in this file** (authoritative, editable).
- **OOB attach points** (a fixed catalog of well-known Locations and OOB
  CommandIds we ship as static data) — read-only references the user picks
  from when targeting an OOB button or location.

---

## 3. Source-of-ribbons model

The editor maintains a **working set** of ribbon documents independent of where
they came from. A source is one of:

| Source                    | Detection                                                                | Save behavior                                                                     |
| ------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Unpacked workspace        | `Entities/*/RibbonDiffXml.xml` or `Other/Customizations.xml` exists      | Patch changed XML ranges in place.                                                |
| Flat `customizations.xml` | Single `customizations.xml` at workspace root or in a `solution/` folder | Patch `RibbonDiffXml` blocks in-place.                                            |
| Imported solution `.zip`  | User-triggered "Open ribbons from solution…" command                     | Extract to extension storage or temp; save back with replace-original or save-as. |

Detection is done by a `RibbonSourceLocator` service that scans the workspace
once on activation and watches for relevant file changes. The `.zip` flow is
added after workspace editing is stable; it produces a synthetic source rooted
outside the workspace unless the user chooses a save-as location.

---

## 4. Feature layout

New feature folder, mirroring existing conventions:

```
src/features/ribbons/
  models.ts                       // domain types (see §5)
  ribbonDocument.ts               // parsed document + XML ranges
  ribbonXmlReader.ts              // lenient XML scanner/parser for ribbons
  ribbonPatchWriter.ts            // applies text patches to original XML
  ribbonSourceLocator.ts          // scans workspace, classifies layout, emits RibbonSource[]
  ribbonRepository.ts             // load/save a single RibbonSource (read file → parse → patch)
  oobCatalog.ts                   // static catalog of well-known Locations + OOB CommandIds
  solutionZipService.ts           // phase 3: open/save .zip solution sources (JSZip)
  ribbonPublishService.ts         // phase 4: minimal zip + SolutionImportService + PublishXml
  ribbonEditorState.ts            // in-memory working set + dirty tracking + undo stack
  ribbonExplorer.ts               // vscode.TreeDataProvider (the activity-bar view)
  webview/
    ribbonFormPanel.ts            // single webview panel hosting the property form per selected node
    media/                        // panel HTML/CSS/JS (no framework — vanilla, like the rest of the ext)
  commands/
    ribbonExplorerCommands.ts     // refresh, openFile, openSolutionZip, etc.
    ribbonEditCommands.ts         // addCustomAction, hideOOB, addCommand, addRule, reorder, etc.
  __tests__/
    ribbonXmlReader.test.ts       // parse representative XML fixtures
    ribbonPatchWriter.test.ts     // no-op stability + surgical patch tests
    ribbonRepository.test.ts
    ribbonSourceLocator.test.ts
```

Wiring:

- `src/app/createServices.ts` instantiates `RibbonSourceLocator`, `RibbonRepository`,
  `RibbonEditorState`, `SolutionZipService`.
- `src/app/registerCommands.ts` registers ribbon commands + the tree view +
  `ribbonFormPanel`.
- `package.json` gets a new `views` entry under the existing
  `dynamics365tools-utility` viewsContainer, plus the new commands & context
  menus.

### Dependencies to add

- `fast-xml-parser` — already present. Use it only as a helper for reading
  import logs or simple XML checks, not as the source-of-truth writer for
  ribbon saves.
- `jszip` — add in phase 3 only, to read/write the `.zip` solution source.

Both libraries are widely used, MIT-licensed, no native deps.

---

## 5. Domain model (TypeScript)

The model is a faithful, typed projection of `RibbonDiffXml`, but it is not the
save format. The save format is the original XML plus a list of text patches.
This is the main safety rule for real ribbon files.

Entity ribbons are loaded as one `RibbonDocument`. `Form`, `HomepageGrid`, and
`SubGrid` are views inferred from locations and command ids inside the same
document. Application ribbons are separate documents.

```ts
type RibbonScope = "Application" | "Form" | "HomepageGrid" | "SubGrid";

interface RibbonDocument {
  id: string;
  sourceId: string;
  kind: "Application" | "Entity";
  entityLogicalName?: string; // undefined for Application
  fileUri: string;
  sourceText: string;
  ribbonRange: TextRange;
  sections: RibbonSectionRanges;
  views: RibbonView[];
}

interface RibbonView {
  scope: RibbonScope;
  customActions: CustomAction[];
  hideActions: HideAction[];
  commandDefinitions: CommandDefinition[];
  enableRules: EnableRule[];
  displayRules: DisplayRule[];
  locLabels: LocLabel[];
  templatesRange?: TextRange; // preserved, not modeled in the first release
  unknownNodeRanges: TextRange[]; // forward-compat: preserved by not touching them
}

interface TextRange {
  start: number;
  end: number;
}

interface RibbonSectionRanges {
  customActions?: TextRange;
  templates?: TextRange;
  commandDefinitions?: TextRange;
  ruleDefinitions?: TextRange;
  locLabels?: TextRange;
}

interface CustomAction {
  id: string; // e.g. "new.account.MainTab.NewGroup.MyButton.CustomAction"
  location: string; // OOB attach point Id (picked from catalog or typed)
  sequence: number;
  commandUI: ButtonNode | GroupNode | TabNode | MenuSectionNode;
  range: TextRange;
}

interface ButtonNode {
  kind: "Button";
  id: string;
  command: string; // CommandDefinition Id
  labelLocId?: string; // -> LocLabel.id
  labelText?: string; // inline fallback
  toolTipTitleLocId?: string;
  toolTipDescriptionLocId?: string;
  image16x16?: ImageRef;
  image32x32?: ImageRef;
  templateAlias?: string;
  sequence?: number;
}

interface ImageRef {
  webResourceUniqueName: string; // resolves to $webresource:<name>
}

interface HideAction {
  hideActionId: string; // OOB CustomAction Id to hide
  location: string;
  range: TextRange;
}

interface CommandDefinition {
  id: string;
  enableRuleRefs: string[];
  displayRuleRefs: string[];
  actions: CommandAction[];
}

type CommandAction =
  | {
      kind: "JavaScriptFunction";
      library: WebResourceRef;
      functionName: string;
      parameters: ActionParameter[];
    }
  | { kind: "Url"; address: string }
  | { kind: "Unknown"; raw: string }; // forward-compat

interface WebResourceRef {
  uniqueName: string; // schema name in Dataverse, e.g. "new_/scripts/account.js"
  workspaceUri?: string; // resolved from BindingService when possible
}

interface ActionParameter {
  kind: "Crm" | "Bool" | "Int" | "Float" | "String" | "Decimal";
  value: string;
}

interface EnableRule {
  id: string;
  steps: RuleStep[]; // CustomRule (JsFunction), CommandClientTypeRule, FormStateRule, etc.
}

interface DisplayRule {
  id: string;
  steps: RuleStep[]; // EntityPrivilegeRule, FormEntityContextRule, ValueRule, etc.
}

type RuleStep =
  | {
      kind: "CustomRule";
      library: WebResourceRef;
      functionName: string;
      default?: boolean;
      invertResult?: boolean;
      parameters: ActionParameter[];
    }
  | {
      kind: "EntityPrivilegeRule";
      entityName?: string;
      privilegeType: PrivilegeType;
      privilegeDepth?: PrivilegeDepth;
      invertResult?: boolean;
    }
  | { kind: "ValueRule"; field: string; value: string; invertResult?: boolean }
  | { kind: "FormStateRule"; state: FormState; invertResult?: boolean }
  | { kind: "CommandClientTypeRule"; type: "Modern" | "Refresh" }
  | { kind: "Unknown"; raw: string };

interface LocLabel {
  id: string;
  titles: { languageCode: number; description: string }[];
  range: TextRange;
}
```

Unknown nodes and unknown attributes are preserved because the writer only
touches ranges affected by the requested edit. **This is the contract that
makes the editor safe to use on real ribbons.**

---

## 6. XML reader & patch writer

`ribbonXmlReader.ts` and `ribbonPatchWriter.ts` are pure functions over strings
(no I/O). They sit behind `RibbonRepository`, which handles file/zip access.

Requirements:

1. **No-op saves write nothing.** If the user does not make an edit, the
   repository does not rewrite the file.
2. **Patch-based saves.** Each edit produces one or more `RibbonPatch` values:
   insert a generated XML node, replace a known node range, delete a known node
   range, or replace a known attribute range.
3. **Attribute order is preserved by default.** Existing attributes stay in
   their original order. New generated nodes use a stable order.
4. **Unknown nodes/attributes/comments/CDATA are preserved verbatim.** We never
   silently drop data we do not understand.
5. **Reader can be lenient.** The reader may use `fast-xml-parser` for simple
   structure checks, but it must also keep source ranges from the original text.
   The writer must not serialize the whole parsed object back to XML.
6. Embedded vs. standalone variants:
   - Unpacked: file is just `<RibbonDiffXml>…</RibbonDiffXml>`.
   - Flat: parser locates the right `<RibbonDiffXml>` inside `customizations.xml`
     and edits surgically — the rest of `customizations.xml` is untouched.

Core patch types:

```ts
type RibbonPatch =
  | { kind: "insert"; offset: number; text: string }
  | { kind: "replace"; range: TextRange; text: string }
  | { kind: "delete"; range: TextRange };
```

The repository applies patches from the end of the file toward the beginning so
earlier offsets stay valid.

Both reader and writer are exercised in `__tests__/ribbonXmlReader.test.ts` and
`__tests__/ribbonPatchWriter.test.ts` against fixtures from real-world entities
(account, contact, plus a hand-crafted application ribbon).

---

## 7. Tree view (RibbonExplorer)

A new view `dynamics365Tools.ribbonExplorer`, in the existing
`dynamics365tools-utility` view container. Hierarchy:

```
Ribbons
├── 📁 Sources                                        (one per RibbonSource)
│   ├── 🗂  Workspace solution (unpacked)
│   │   ├── 🌐 Application Ribbon
│   │   ├── 📄 account
│   │   │   ├── Form
│   │   │   ├── HomepageGrid
│   │   │   └── SubGrid
│   │   └── 📄 contact
│   │       └── …
│   └── 🗂  my-solution.zip (loaded from file, phase 3)
│       └── … (same shape)
│
└── (per ribbon node, when expanded):
    ├── 🔧 Custom Actions
    │   └── <CustomAction id> @ <Location>
    │       └── Button: <button id> → <commandId>
    ├── 🚫 Hide Actions
    │   └── <hideActionId> @ <Location>
    ├── ⚙ Command Definitions
    │   └── <commandId>
    │       ├── EnableRules: <id>, <id>
    │       ├── DisplayRules: <id>, <id>
    │       └── Actions: JsFn(<lib>.<fn>), Url(<address>)
    ├── ✅ Enable Rules
    │   └── <id>: [CustomRule(<fn>), CommandClientTypeRule(Modern), …]
    ├── 👁 Display Rules
    │   └── <id>: [EntityPrivilegeRule(Write), ValueRule(<field>=<val>), …]
    └── 🌐 Loc Labels
        └── <id> (<n> languages)
```

Entity nodes group one physical ribbon document; `Form`, `HomepageGrid`, and
`SubGrid` below it are filtered views of that same document. Selection drives
the form panel (§8). Inline actions on each node level (the
`view/item/context` menus already used for the plugin explorer):

| Node                  | Inline actions                                                 |
| --------------------- | -------------------------------------------------------------- |
| Source                | Refresh, Save, Reload from disk                                |
| Ribbon (scope/entity) | Add Custom Action, Add Command Def, Add Rule, Hide OOB Button… |
| Custom Action         | Edit, Delete, Move up/down                                     |
| Button                | Edit, Delete, Replace icon, Change command                     |
| Hide Action           | Delete                                                         |
| Command Definition    | Edit, Delete, Add Action, Add Rule ref                         |
| Enable/Display Rule   | Edit, Delete, Add step                                         |
| Rule step             | Edit, Delete, Move up/down                                     |
| LocLabel              | Edit, Delete, Add language                                     |

A toolbar-level command **"Open Ribbons from Solution…"** is added in phase 3.
It first uses the selected environment from `EnvironmentConnectionService`.
Then it lists solutions from that environment, preferably unmanaged solutions
only (`IsManaged eq false`), lets the user pick one, downloads the solution
zip, and adds it as a source. A local `.zip` picker can stay as a secondary
"open from disk" path.

---

## 8. Form panel (single webview)

One `RibbonFormPanel` webview, opened beside the editor. Selecting any tree
node sends a message to the webview with the node's id; the webview renders
the appropriate form. No drag-and-drop, no rendered ribbon canvas — this is
the "structural editor" you chose.

Why a webview instead of chained `QuickPick`/`InputBox`:

- Rule and command definitions have nested lists (rule steps, action
  parameters) that don't fit a linear quick-pick flow.
- The web-resource picker (§9) is much more usable as an in-form combobox
  with a search field than as a separate quick-pick.
- A single webview with one form per node type is small in scope — vanilla
  HTML/JS, no framework, consistent with the rest of this extension.

The webview is **synchronous with the tree**: it only edits; the canonical
state lives in `RibbonEditorState`. Edits post messages back to the extension
host, which mutates the model, records pending `RibbonPatch` values, marks the
source dirty, and broadcasts a refresh so the tree updates. `RibbonRepository`
writes to disk only when the user runs Save.

---

## 9. Web resource integration for JS actions/rules

When the user is editing a `JavaScriptFunction` action or a `CustomRule` step,
the **Library** field is a combobox populated from `BindingService.listBindings()`:

1. List all bound web resources of kind `file` with `.js` extension.
2. Display: `remotePath` plus `relativeLocalPath` as secondary text. In the
   existing binding model, `remotePath` is the Dataverse web resource name and
   `relativeLocalPath` is the workspace file path.
3. On selection, the model stores
   `WebResourceRef { uniqueName: <remotePath>, workspaceUri: <resolved local path> }`.
4. **Function name** field gets a lightweight autocomplete: if the workspace
   file is resolvable and small enough, we grep top-level `function foo(…)`,
   `foo = function`, and `<namespace>.foo = function` declarations and suggest
   them. Pure best-effort; user can always type free-form.
5. Unbound or external libraries are still editable via a "Type schema name
   manually" escape hatch because not every JS reference will be a workspace
   file (e.g. ClientCommon).

This is the layer that makes this editor genuinely better than alternatives:
no copy-pasting of `$webresource:` paths, no typos, suggestions match what is
actually deployable from this workspace.

---

## 10. OOB button handling — the "take control" workflow

This is the operation that drove the design, so it gets its own section.

### Hide an OOB button

1. User picks **Hide OOB Button** on a ribbon node.
2. Form shows two combos:
   - **Button** — from `oobCatalog.ts` (curated list, searchable: `Mscrm.SavePrimary`,
     `Mscrm.AddNewRecordFromForm`, `Mscrm.HomePageGrid.<entity>.AddNewRecord`, …).
     Also accepts a free-text Id for unknown buttons.
   - **Location** — auto-suggested from the catalog based on the chosen
     button's typical placement; editable.
3. Editor appends a `<HideCustomAction>` with a generated `HideActionId`
   (`<prefix>.<entity>.<scope>.Hide.<oobId>`).

### Override an OOB command (advanced follow-up)

The "take control" pattern. The user wants `Mscrm.SavePrimary` to call their
own JS first (e.g., custom validation), and only fall through to default
behavior on success — or replace it entirely.

This is not part of the first useful release. It can break expected platform
behavior if the replacement command does not recreate the default action chain.
Ship it after basic hide + custom button editing is stable.

1. User picks **Override OOB Command** on a ribbon node.
2. Form shows a combo of OOB command Ids (`Mscrm.SavePrimary`, …) from the
   catalog.
3. Editor creates a `CommandDefinition` **with the same Id as the OOB
   command** — this overrides it. Pre-populates with empty
   EnableRules/DisplayRules/Actions arrays the user then fills in.
4. UI clearly labels these nodes as "OVERRIDE: Mscrm.SavePrimary" so they're
   visually distinct from custom commands.

### "Always hide built-ins, then re-add" (follow-up)

A composite action available from the ribbon node:
**Hide all OOB buttons in this group → Add custom buttons mimicking them**.
The wizard takes a location, lists all OOB buttons at that location from
`oobCatalog.ts`, generates `<HideCustomAction>` entries for the selected
ones, and offers to stub out replacement `<CustomAction>` + `Button` +
`CommandDefinition` entries pre-filled with the OOB's labels and icons. The
user then attaches their own rules/actions.

### OOB catalog

`oobCatalog.ts` is a static data file we curate. Initial scope:

- Locations: top ~50 well-known ribbon locations per scope (Form, HomepageGrid,
  SubGrid) — `Mscrm.Form.<entity>.MainTab.Save.Controls._children`,
  `Mscrm.HomepageGrid.<entity>.MainTab.Management.Controls._children`, etc.
- Commands: top ~30 well-known commands — `Mscrm.SavePrimary`,
  `Mscrm.SaveAndClosePrimary`, `Mscrm.AddNewRecordFromForm`, `Mscrm.DeletePrimary`,
  `Mscrm.RefreshGrid`, etc.
- Entity name is parameterized; for entity-specific Ids we substitute the
  current entity logical name.

This is enough to cover ~95% of real-world ribbon edits without making it a
research project. The catalog is plain data, easily extensible, and the editor
always allows free-text override.

---

## 11. Persistence

Save is **explicit** (Cmd/Ctrl+S in the form panel + a `Save` action on each
Source node) — not on every keystroke. Saving an unpacked source applies
pending patches to the individual `RibbonDiffXml.xml` files; saving a flat
source patches only the relevant ribbon blocks inside `customizations.xml`;
saving a zip source updates the extracted copy and **does not** automatically
repack the zip — that's a separate `Save Solution Zip…` action so the user is
in control of whether to overwrite the original.

A dirty-tracking layer in `RibbonEditorState` marks sources with unsaved
changes; the tree decorates them (matching the `vscode.SourceControl` dirty
indicator look).

---

## 12. Publish to environment

Direct publish is an explicit, opt-in action — never automatic on save.
Surfaced as **"Publish to Environment…"** on each Source node in the tree
and on each individual ribbon node (publish just this one).

Publish is a later phase. It should reuse the existing `DataverseClient`,
`EnvironmentConnectionService`, `SolutionPicker`, and `SolutionImportService`
instead of creating a second import/polling stack.

### Flow

1. User triggers publish on a ribbon node or a whole source.
2. Pick target environment from the existing
   `EnvironmentConnectionService` (same UX as plugin assembly publish).
3. Pick target solution. Two modes:
   - **Use an existing unmanaged solution** in the env (list filtered to
     `IsManaged eq false`, default-solution shown but discouraged with a
     warning).
   - **Create a throwaway solution** named
     `d365tools_ribbon_<scope>_<timestamp>` under the user's configured
     publisher — used when the user just wants to push a one-off change
     without polluting a real solution. Cleaned up by a follow-up
     `DeleteSolution` only when the user opts in.
4. `RibbonPublishService` builds a minimal solution zip in memory:
   - `solution.xml` — references only the entities whose ribbons are being
     published (plus the application ribbon component if included).
   - `customizations.xml` — contains only those entities' `RibbonDiffXml`
     blocks (and `RibbonDiffXml` at root for app ribbon). Other entity
     metadata (attributes, forms, …) is intentionally omitted so we
     never accidentally overwrite unrelated customizations.
   - `[Content_Types].xml` — standard boilerplate.
5. `ImportSolution` through the existing `SolutionImportService`, with
   `OverwriteUnmanagedCustomizations: true`, `PublishWorkflows: false`, and an
   import job id generated up-front.
6. Reuse the import job polling and error parsing already present in
   `SolutionImportService`. Surface progress via `vscode.window.withProgress`.
7. On success: extend the Dataverse import/publish layer with `PublishXml`
   support for ribbons. The `ParameterXml` contains
   `<entities><entity>account</entity>…</entities>` plus `<ribbon />` when the
   application ribbon is included.
8. On failure: parse import job XML to extract the error and show it in a
   dismissible error view with a "Copy error XML" action.

### What it does NOT do

- It does not modify the source files (workspace XML or imported `.zip`
  source). Publish operates on a packed-in-memory copy. The user's
  workspace is the source of truth; publish is one direction.
- It does not solve "two people editing the same ribbon in parallel" —
  `OverwriteUnmanagedCustomizations: true` is last-write-wins by design.
  We surface this as a confirmation dialog the first time per session.
- It does not pull ribbons from the environment back into the workspace.
  Out of scope for the first publish release; the existing "Open Ribbons from Solution…" flow
  covers the inbound path when paired with the user manually exporting
  the solution.

### Risks specific to publish

- **`ImportSolution` zip shape**: small mistakes in `solution.xml` /
  `[Content_Types].xml` fail import with cryptic errors. Mitigation: ship
  fixture-tested templates; offline-validate the zip we build against a
  known-good shape before each import.
- **Component scoping**: omitting attribute/form definitions means the
  imported solution must _only_ reference components the env already has.
  We pre-flight `RetrieveEntity` for each target entity and fail fast with
  a clear error if any is missing in the env.
- **Publisher prefix**: a thrown-away solution needs a publisher. We use
  whichever publisher is associated with the user's currently configured
  solution; if none can be determined, the publish action is disabled
  with an actionable error.

## 13. Validation

Validations run on every edit and produce diagnostics shown in the form panel
and a per-source `vscode.DiagnosticCollection`:

- **Unique Ids** within a ribbon for: CustomAction, CommandDefinition,
  EnableRule, DisplayRule, LocLabel.
- **Reference integrity**: every `Command` attribute on a Button resolves
  either to an OOB Id or to a `CommandDefinition` in this file; every
  EnableRule/DisplayRule reference resolves to a definition; every
  `labelLocId` resolves to a `LocLabel`.
- **Schema sanity**: required attributes present, enums valid (PrivilegeType,
  PrivilegeDepth, FormState).
- **Web resource resolution**: `WebResourceRef.uniqueName` exists as a binding
  in the workspace — warning (not error) if not, since not every reference is
  a workspace file.
- **Naming convention**: `CustomAction.Id` matches the recommended
  `<publisher>.<entity>.<location-fragment>.<button>.CustomAction` pattern —
  warning only.

---

## 14. Open questions / assumptions

1. **AppRibbon location in unpacked layouts**: pp-cli historically uses
   `Other/Customizations.xml`; recent versions sometimes split it out. The
   locator handles both, but if your workspaces have a custom layout, we'll
   need a config knob (`dynamics365Tools.ribbons.appRibbonPath`).
2. **Solution zip merging**: when re-saving a zip, do we keep non-ribbon
   files (forms, sitemap, …) byte-identical? Assumption: yes — JSZip
   round-trip with original entries untouched. Tested via fixture.
3. **Templates editing**: out of scope for the first useful release (preserved verbatim).
   Confirm this is acceptable or it becomes phase 4.
4. **Reorder of OOB buttons**: not explicitly checked in the OOB question.
   Assumption: out of scope for the first useful release — users achieve effective reordering by
   hiding the OOB and re-adding with a different `Sequence`. Easy to revisit.
5. **Throwaway publish solutions**: do we delete them automatically after a
   successful publish, prompt the user, or leave them? Default assumption:
   leave them and surface a "Clean up generated ribbon solutions" command —
   so a failed publish leaves diagnostic state behind.

---

## 15. Phased rollout

The phasing keeps each step independently shippable. Mark each phase as [Done] when it's completed.

### Phase 0 — XML spike (≈ 1–2 days) [Done]

- Collect 5–6 real ribbon fixtures.
- Build `ribbonXmlReader` enough to locate `RibbonDiffXml`, major sections,
  known nodes, attributes, and text ranges.
- Build `ribbonPatchWriter` and prove:
  - no-op saves write nothing;
  - insert/replace/delete patches touch only expected ranges;
  - unknown nodes, comments, CDATA, and whitespace survive.

Exit criteria: fixture tests prove the patch-based approach before UI work
starts.

### Phase 1 — Read-only foundation (≈ 3–4 days) [Done]

- `RibbonSourceLocator` + workspace scan.
- `ribbonXmlReader.ts` + `ribbonPatchWriter.ts` with fixture tests.
- `RibbonRepository` for unpacked + flat sources.
- `oobCatalog.ts` with the initial well-known list.
- `RibbonExplorer` tree view rendering everything (no editing yet).
- `RibbonFormPanel` rendering forms in **read-only** mode.

Exit criteria: open an unpacked solution in the workspace, see every ribbon
and its full structure in the tree, drill into any node and see all its
properties.

### Phase 2 — First useful editing release (≈ 5–7 days) [Done]

- Add/edit/delete for: CustomAction (Button only), HideAction,
  CommandDefinition, Action (JsFn + Url), simple EnableRule, simple
  DisplayRule, and LocLabel (single language).
- **Hide-OOB** flow.
- Web-resource-picker (`BindingService`-backed) for JsFn libraries.
- Validation diagnostics.
- Save-on-demand for unpacked + flat sources.

Exit criteria: build the "validate before save with custom JS, then save" use
case end-to-end against a real entity ribbon in an unpacked solution. Hide
OOB Save, re-add a custom button with the same icon, and call workspace JS.

### Phase 3 — Solution `.zip` source + reorder + multi-language (≈ 3–4 days) [Done]

- `SolutionZipService` (JSZip) + zip source type.
- "Open Ribbons from Solution…" command:
  - Reuse the selected environment from `EnvironmentConnectionService`.
  - List solutions from that environment before download, filtered to
    unmanaged solutions when possible (`IsManaged eq false`).
  - Download the selected solution zip and open it as an editable ribbon source.
- "Save Solution Zip…" action.
- Reorder for custom buttons & rule steps (move up/down via Sequence).
- Multi-language UI for LocLabels.

Exit criteria: pick an unmanaged solution from the selected environment,
download its `solution.zip`, edit ribbons, save back to zip, import zip into
an env — ribbon behaves as edited.

### Phase 4 — Publish to environment (≈ 4–5 days) [Done]

- `RibbonPublishService` + minimal-zip builder (fixture-tested shape).
- Env + solution picker reusing `EnvironmentConnectionService` UX.
- `ImportSolution` invocation reusing `SolutionImportService`.
- `PublishXml` per touched entity / app ribbon.
- Pre-flight checks (entity exists in env, publisher available).
- Error surfacing from the import job XML.
- "Clean up generated ribbon solutions" maintenance command.

Exit criteria: edit a ribbon in the workspace, hit Publish, pick env +
solution, see progress, see the change take effect in the env without
opening Power Apps.

### Phase 5 — Polish / stretch

- OOB command override. [Done]
- "Hide all and stub replacements" wizard. [Done]
- Templates editor (or at minimum a "raw XML" escape hatch for unknown nodes). [Done: raw XML escape hatch]
- Expanded `oobCatalog.ts` with common command/control ids. [Done: app global location + shared command-id resolution + legacy/modern catalog variants]
- Reorder of OOB buttons (synthesized hide+re-add). [Done]
- Undo/redo across the working set. [Done]
- Pull-from-env flow (the inverse of publish). [Done]

---

## 16. Testing

- **`ribbonXmlReader.test.ts`**: read 5–6 fixture files covering: empty diff,
  full diff with all section types, embedded inside `customizations.xml`,
  unknown attributes & nodes, comments, and CDATA in LocLabel titles.
- **`ribbonPatchWriter.test.ts`**: no-op writes nothing; insert/replace/delete
  patches touch only expected ranges; unknown data stays byte-identical.
- **`ribbonRepository.test.ts`**: unpacked source load/save, flat source
  surgical patch (assert other entities in `customizations.xml` are
  byte-identical after a save that touched only one).
- **`ribbonSourceLocator.test.ts`**: layout detection on synthetic
  workspaces; AppRibbon path resolution variants.
- **`ribbonPublishService.test.ts`**: minimal-zip builder produces the exact
  `solution.xml` / `customizations.xml` / `[Content_Types].xml` shape
  expected by `ImportSolution`, asserted against a known-good fixture. Plus
  unit tests for the import-job error parser.
- **Manual UI tests**: documented checklist in PR for tree rendering, form
  flows, hide OOB, web-resource picker, validation diagnostics, and later
  OOB override / hide+restub flows when those phases land. (Followed the
  project convention of "no automated UI tests for VS Code views.")

---

## 17. Risks

1. **XML write stability** is the single biggest correctness risk. We mitigate
   by never serializing the whole ribbon from a parsed object, by applying
   small text patches, and by fixture tests that assert byte-equivalence outside
   changed ranges.
2. **OOB catalog drift**: well-known Ids change rarely but do change across
   D365 versions. The catalog is plain data and free-text override is always
   available; we accept this as low risk for the first useful release.
3. **Flat `customizations.xml` surgical edits**: we must edit only the
   `RibbonDiffXml` blocks and leave the rest byte-identical. The writer applies
   patches to known ranges rather than rewriting the document. Covered by tests.
4. **Web-resource picker accuracy**: bindings can be stale relative to the
   solution's actual web resources. We always allow free-text and surface
   "unresolved" warnings, never block save.
5. **Publish blast radius**: `OverwriteUnmanagedCustomizations: true` plus
   the wrong target solution can clobber someone else's in-flight ribbon
   changes. Mitigated by (a) scoping the import zip to _only_ ribbon
   components — no attributes/forms/sitemap — and (b) a confirmation
   dialog the first time per session showing target env, target solution,
   and the list of entities being touched.

---

## 18. Effort estimate

Roughly **1.5–2 weeks** for phases 0–2, which is the first useful release.
Phases 3–4 add zip and publish support and are likely another **1.5–2 weeks**
after the XML writer is proven. Phase 5 is open-ended.

The two longest sub-tasks are (a) the XML reader / patch writer work in phases
0–1 and (b) getting the `ImportSolution` zip shape right in phase 4. Both are
correctness-critical and are not safe places to cut scope.

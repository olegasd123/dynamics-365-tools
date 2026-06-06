# VS Code Port Refactor Plan

## Goal

Move logic-heavy VS Code dependencies behind small capability ports while leaving UI-first extension code free to use the VS Code API directly. The target is not zero `vscode` imports; the target is that services with parsing, persistence, publish decisions, retries, and stateful behavior can be unit-tested with plain fakes instead of the global `tests/shims/vscode.js` module stub.

## Principles

- Add ports only for capabilities with meaningful business logic behind them.
- Keep adapters under `src/platform/vscode`.
- Keep ports small and capability-oriented; do not create a generic `VsCodePort`.
- Convert tests as each area is migrated, then shrink the shim incrementally.
- Preserve direct `vscode` usage in tree views, webviews, status bars, command registration, and prompt-only modules unless they block useful unit testing.

Important: Mark a milestone as `[Done]` when it's completed.

## Milestone 1: Publish File System Isolation [Done]

Refactor `src/features/webResources/webResourcePublisher.ts` to stop using `vscode.workspace.fs` and workspace folders directly.

Deliverables:

- Reuse or extend `WorkspaceFilesPort` for `stat`, file type checks, and reading publish content.
- Move workspace-root resolution through the existing configuration/files ports.
- Update publisher tests to use plain fakes for file stats and reads.
- Remove publisher-specific file behavior from `tests/shims/vscode.js` where no longer needed.

Validation:

- `npm run check-types`
- `npm run lint`
- `npm test`

## Milestone 2: Output And Clipboard Ports

Introduce small ports for output channels and clipboard operations where services have real behavior tied to output or copy actions.

Deliverables:

- Add `OutputPort` for append/show/dispose behavior needed by publisher and PCF services.
- Add `ClipboardPort` for copy-details flows.
- Add VS Code adapters in `src/platform/vscode`.
- Convert `WebResourcePublisher` error-details copy behavior and PCF service output usage where it improves tests.

Validation:

- Tests should assert emitted output/copy behavior through fakes, not `vscode.window.__messages` or shim output internals.
- Full validation with `npm run check-types`, `npm run lint`, and `npm test`.

## Milestone 3: Command Workflow File Access

Refactor command workflows that perform file reads/stats while also orchestrating publish/register behavior.

Primary candidates:

- `src/features/webResources/commands/publishCommands.ts`
- `src/features/webResources/commands/bindingCommands.ts`
- `src/features/webResources/commands/openCommands.ts`
- `src/features/plugins/commands/pluginCommands.ts`
- `src/features/plugins/commands/pluginAssemblyUpdateWorkflow.ts`

Deliverables:

- Use file/workbench ports for stat/read/open/reload actions where command logic branches on those results.
- Keep prompt-only behavior on direct VS Code APIs unless tests benefit from isolation.
- Update tests to use `src/testSupport/fakes.ts`.

Validation:

- Existing command tests should no longer monkey-patch `vscode.workspace.fs` for migrated paths.
- Full validation suite passes.

## Milestone 4: PCF Service Isolation

Port the PCF services that combine long-running process orchestration with VS Code output, prompts, and external links.

Primary candidates:

- `src/features/pcf/pcfPackageService.ts`
- `src/features/pcf/pcfDeployService.ts`
- `src/features/pcf/pcfPushService.ts`
- `src/features/pcf/pcfBuildService.ts`

Deliverables:

- Use output/workbench ports for output channels, prompts that affect service decisions, and external links.
- Keep process execution abstractions as-is unless a test need appears.
- Ensure PCF tests use fakes for migrated VS Code surfaces.

Validation:

- PCF tests continue to cover packaging, deploy, push, build, and settings behavior.
- Full validation suite passes.

## Milestone 5: Ribbon And Plugin Prompt Boundaries

Review ribbon/plugin prompt modules and split pure decision logic from UI collection where useful.

Primary candidates:

- `src/features/ribbons/commands/ribbonSourceCommands.ts`
- `src/features/ribbons/commands/ribbonResourcePrompts.ts`
- `src/features/plugins/commands/pluginRegistrationPrompts.ts`
- `src/features/plugins/commands/pluginStepCommands.ts`
- `src/features/plugins/commands/pluginImageCommands.ts`

Deliverables:

- Extract pure mapping/normalization functions when currently buried inside prompt code.
- Add ports only where prompt results drive non-trivial branching or persisted state.
- Avoid wrapping every quick pick/input box by default.

Validation:

- Tests should target extracted pure functions or command orchestration through focused fakes.
- Full validation suite passes.

## Milestone 6: Shim Reduction

Shrink `tests/shims/vscode.js` after the high-value areas are migrated.

Deliverables:

- Remove shim APIs no migrated tests use anymore.
- Keep only APIs still required by true VS Code UI adapter tests: tree views, webviews, status bars, command registration, quick pick/input prompt tests, output channel adapter tests, and extension activation wiring.
- Document any remaining shim responsibilities in the shim file or adjacent test support.

Validation:

- `npm test` should pass with the smaller shim.
- If a removed shim API is still needed, either restore it with a narrow purpose or migrate that test to a fake port.

## Suggested Order

1. Milestone 1: `WebResourcePublisher` file system isolation.
2. Milestone 2: output and clipboard ports.
3. Milestone 3: web resource and plugin command workflow file access.
4. Milestone 4: PCF services.
5. Milestone 5: ribbon/plugin prompt boundaries.
6. Milestone 6: shim reduction.

This order keeps each step reviewable and lets tests prove value before broadening the port surface.

# Ribbon Buttons Implementation Plan

## Goal

Add support for the ribbon controls shown in the toolbox:

- Button
- Split Button
- Flyout
- Menu Section
- Group

Also add Smart Button templates:

- Run Report
- Run Workflow
- Run Webhook
- Quick JS
- Open Dialog

Important: Mark a milestone as `[Dome]` when it's completed.

## Milestone 1: Define Scope

- Confirm supported ribbon targets: Form, HomepageGrid, SubGrid, and Application.
- Define valid XML output for Button, Split Button, Flyout, Menu Section, and Group.
- Define the first version of each Smart Button template.
- Decide which controls can contain child controls.

Acceptance:

- We have examples of valid XML for each control.
- We know which controls are in the first release.

## Milestone 2: Extend Ribbon Models [Dome]

- Update `src/features/ribbons/models.ts`.
- Add real models for Split Button, Flyout, and nested menu items.
- Keep existing Button, Group, Tab, and MenuSection behavior stable.
- Add tests for reading these nodes from XML.

Acceptance:

- TypeScript models represent all supported controls.
- Existing ribbon tests still pass.

## Milestone 3: XML Reader And Writer [Dome]

- Update `src/features/ribbons/ribbonXmlReader.ts` to parse the new controls.
- Update `src/features/ribbons/ribbonEditPatches.ts` to render valid ribbon XML.
- Keep unknown XML safe when possible.
- Add tests for parse and write round trips.

Acceptance:

- Generated XML can be opened again without losing structure.
- Existing custom button XML is unchanged.

## Milestone 4: Basic Controls UI [Dome]

- Add commands or wizard steps for:
  - Add Button
  - Add Group
  - Add Menu Section
- Reuse existing prompts for label, command, image, sequence, location, and action.
- Add edit, delete, and move support where needed.

Acceptance:

- A user can add basic controls from the ribbon tree.
- The controls appear in the explorer and preview.

## Milestone 5: Dropdown Controls

- Add Add Flyout support.
- Add Add Split Button support.
- Support child items inside them, such as buttons and menu sections.
- Validate required child controls and command references.

Acceptance:

- A user can create a dropdown-style control.
- A user can add actions inside the dropdown.
- Invalid empty dropdowns show validation warnings.

## Milestone 6: Smart Buttons

- Add Quick JS template.
- Add Open Dialog template.
- Add Run Webhook template.
- Add Run Report template.
- Add Run Workflow template.
- Keep the first version simple: generate ribbon XML and required command actions.
- Add web resource scaffolding later if needed.

Acceptance:

- Each Smart Button creates complete ribbon XML with minimal prompts.
- Each template can be edited after creation.

## Milestone 7: Preview And Explorer

- Update `src/features/ribbons/ribbonExplorer.ts`.
- Update `src/features/ribbons/ribbonPreview.ts`.
- Update ribbon webviews to show the new control types.
- Show nested controls under flyouts and split buttons.

Acceptance:

- The preview matches the logical ribbon structure.
- Nested controls are clear in the explorer.

## Milestone 8: Validation And Publish Safety

- Extend `src/features/ribbons/ribbonValidator.ts`.
- Check missing commands.
- Check missing labels.
- Check empty flyouts.
- Check invalid locations.
- Check broken JavaScript references where possible.
- Ensure publish does not change unrelated XML.

Acceptance:

- Validation catches common broken ribbon XML.
- Publish flow stays stable.

## Milestone 9: Tests And Documentation

- Add parser tests.
- Add patch writer tests.
- Add command tests.
- Add preview tests.
- Add validation tests.
- Update the README ribbon section with short examples.
- Run project checks:

```bash
npm run format
npm run lint
npm test
```

Acceptance:

- All project checks pass.
- README explains the new controls in simple English.

## Recommended Order

1. Button, Group, and Menu Section.
2. Flyout and Split Button.
3. Smart Buttons.
4. Preview, validation, and documentation polish.

The current code already supports normal custom buttons well. Use that path as the base and extend it step by step.

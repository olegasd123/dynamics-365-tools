# Ribbon Display Rules Implementation Plan

## Goal

Add more display rule types to the ribbon editor.

The first release should focus on flat XML rules. These rules are simple to add, easy to test, and fit the current rule editor flow.

## Current State

The ribbon editor can create these display rule steps now:

- `EntityPrivilegeRule`
- `CustomRule`
- `FormStateRule`
- `CommandClientTypeRule`
- `ValueRule`
- `EntityRule`

The model, XML reader, XML writer, validator, and command prompts already use one shared rule step flow for enable and display rules.

Important:

- Create a list of possible values and possibility to write a custom one, when it's possible, instead of just text value when user has to write a value themselves on creation / modifying rules. List of values will help user to create / edit rules faster.
- Mark a milestone as `[Done]` when it's completed.

## Milestone 1: Add Core Flat Display Rules [Done]

Add these display rule types first:

- `FormTypeRule`
- `EntityPropertyRule`
- `MiscellaneousPrivilegeRule`
- `OrganizationSettingRule`
- `HideForTabletExperienceRule`

### Code Tasks

1. Add new rule step types in `src/features/ribbons/models.ts`.
2. Add matching `NewRuleStepInput` types in `src/features/ribbons/ribbonEditPatches.ts`.
3. Parse the new XML nodes in `src/features/ribbons/ribbonXmlReader.ts`.
4. Render the new XML nodes in `src/features/ribbons/ribbonEditPatches.ts`.
5. Add prompt functions in `src/features/ribbons/commands/ribbonExplorerCommands.ts`.
6. Add the new rules to the display rule quick pick.
7. Add validation for required fields in `src/features/ribbons/ribbonValidator.ts`.
8. Update tests for read, write, prompt, and validation paths.
9. Update `README.md` with the new display rule support.

### Expected XML Examples

```xml
<FormTypeRule Type="Main" />
<EntityPropertyRule PropertyName="HasNotes" PropertyValue="true" />
<MiscellaneousPrivilegeRule PrivilegeName="ExportToExcel" />
<OrganizationSettingRule Setting="IsSharePointIntegrationEnabled" />
<HideForTabletExperienceRule />
```

### Test Coverage

Add or update tests in:

- `src/features/ribbons/__tests__/ribbonXmlReader.test.ts`
- `src/features/ribbons/__tests__/ribbonEditPatches.test.ts`
- `src/features/ribbons/__tests__/ribbonExplorerCommands.test.ts`
- `src/features/ribbons/__tests__/ribbonValidator.test.ts`

## Milestone 2: Add Relationship Display Rules

Add rules that are useful for grid and subgrid commands:

- `RelationshipTypeRule`
- `ReferencingAttributeRequiredRule`

### Code Tasks

1. Add model and input types.
2. Add XML parse and render support.
3. Add prompts for relationship type and required attribute checks.
4. Add validation for required fields.
5. Add read, write, prompt, and validation tests.

### Expected XML Examples

```xml
<RelationshipTypeRule Type="OneToMany" />
<ReferencingAttributeRequiredRule />
```

## Milestone 3: Add Page Rule

Add `PageRule` after the main flat rules are stable.

This rule can be useful for application ribbon commands and page context checks.

### Code Tasks

1. Add model and input types.
2. Parse and render `PageRule`.
3. Add prompts for page data.
4. Add validation.
5. Add tests.

## Milestone 4: Add Nested Rule Support

Add `OrRule` as a separate step.

`OrRule` is more complex because it contains child rule nodes. It should not be mixed with the first flat rule release.

### Code Tasks

1. Extend the rule model to allow nested rule steps.
2. Parse nested rule XML.
3. Render nested rule XML.
4. Add UI flow to add child rule steps.
5. Add edit and delete support for nested child steps.
6. Add tests for nested parse, render, move, edit, and delete behavior.

### Expected XML Example

```xml
<OrRule>
  <FormStateRule State="Create" />
  <FormStateRule State="Existing" />
</OrRule>
```

## Milestone 5: Add Legacy Display Rules

Add these only if users need them:

- `CrmClientTypeRule`
- `CrmOfflineAccessStateRule`
- `CrmOutlookClientTypeRule`
- `CrmOutlookClientVersionRule`
- `OutlookRenderTypeRule`
- `OutlookVersionRule`
- `SkuRule`

These rules are older and less useful for modern model-driven apps.

## Validation Commands

Run these commands before the work is complete:

```bash
npm run format
npm run lint
npm test
```

## Done Criteria

The work is done when:

- New display rules can be created from the ribbon editor.
- Existing XML with the new rules is parsed and shown.
- New rules are written with valid XML.
- Missing required fields create diagnostics.
- Tests cover parse, write, prompt, and validation behavior.
- Documentation lists the supported display rule types.

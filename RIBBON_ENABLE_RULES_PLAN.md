# Ribbon Enable Rules Implementation Plan

## Goal

Add full support for common ribbon enable rules and useful built-in enable rule references.

The work should make the "Add Enable Rule Reference" action useful even when the current file has no custom enable rules yet. It should also let users create and inspect the most common custom enable rule types.

## Scope

Implement these rule types:

- `CustomRule`
- `FormStateRule`
- `ValueRule`
- `SelectionCountRule`
- `RecordPrivilegeRule`
- `EntityRule`
- `CommandClientTypeRule` with `Legacy`

Also add common built-in references:

- `Mscrm.SelectionCountExactlyOne`
- `Mscrm.ShowOnQuickAction`
- `Mscrm.ShowOnGrid`
- `Mscrm.ShowOnGridAndQuickAction`

Important: Mark the milestone `[Done]` when it's completed.

## Milestone 1: Built-In Enable Rule References

Purpose: Make "Add Enable Rule Reference" useful when no local enable rule exists.

Tasks:

- Add a small catalog for built-in enable rule IDs.
- Show built-in enable rule IDs in the enable rule reference picker.
- Mark built-in items as built-in in the picker description.
- Keep the manual ID option.
- Do not validate built-in references as missing local rules.

Tests:

- Add a built-in enable rule reference to a command.
- Do not show a missing-rule diagnostic for the built-in reference.
- Do not offer a built-in reference that the command already has.

## Milestone 2: Rule Model And XML Reader

Purpose: Parse all target rule types into typed models.

Tasks:

- Add model types for `SelectionCountRule`, `RecordPrivilegeRule`, and `EntityRule`.
- Add `Legacy` to `CommandClientTypeRule`.
- Read XML attributes for the new rule types.
- Keep unknown rule XML support for rule types not yet modeled.
- Confirm exact XML attributes from Microsoft schema before editing.

Expected attributes to confirm:

- `SelectionCountRule`: selected record count checks.
- `RecordPrivilegeRule`: privilege checks for the current record.
- `EntityRule`: entity/context checks.

Tests:

- Parse each new rule type from `customizations.xml`.
- Parse `CommandClientTypeRule Type="Legacy"`.
- Keep unknown rule parsing unchanged.

## Milestone 3: XML Patch Renderer

Purpose: Create valid XML for all target rule types.

Tasks:

- Extend `NewRuleStepInput` for `SelectionCountRule`.
- Extend `NewRuleStepInput` for `RecordPrivilegeRule`.
- Extend `NewRuleStepInput` for `EntityRule`.
- Render XML for the new rule types.
- Render `CommandClientTypeRule Type="Legacy"`.
- Keep existing output format stable for current rules.

Tests:

- Create an enable rule with each new step type.
- Re-read the XML and assert the rule step kind and attributes.
- Confirm existing rule patch tests still pass.

## Milestone 4: Create Rule UI Prompts

Purpose: Let users create these rule types from the ribbon explorer.

Tasks:

- Show all target rule types for enable rules.
- Allow `ValueRule` for enable rules.
- Add `BulkEdit` to `FormStateRule`.
- Add `Legacy` to `CommandClientTypeRule`.
- Add prompts for `SelectionCountRule`.
- Add prompts for `RecordPrivilegeRule`.
- Add prompts for `EntityRule`.
- Use short labels and clear descriptions in quick picks.

Tests:

- Mock user input for each new rule type.
- Assert the created XML contains the expected rule.
- Assert cancel paths do not queue patches.

## Milestone 5: Explorer Details And Validation

Purpose: Show good rule details and avoid false errors.

Tasks:

- Show clear details for each new rule type in the ribbon explorer.
- Add validation for required attributes on typed rule steps.
- Do not warn for known built-in enable rule references.
- Keep warnings for truly missing custom rule IDs.

Tests:

- Explorer nodes show the correct label and detail values.
- Validator catches missing required attributes.
- Validator accepts built-in enable rule references.

## Milestone 6: Edit Existing Rule Steps

Purpose: Keep edit behavior complete after new rule types are added.

Tasks:

- Support replacing an existing rule step with any target type.
- Preserve delete behavior for rule steps.
- Preserve delete behavior for command rule references.
- Keep custom rule parameter behavior unchanged.

Tests:

- Replace an existing step with each new rule type.
- Delete a new rule step.
- Delete a built-in enable rule reference.

## Milestone 7: Documentation And Final Checks

Purpose: Make the feature easy to use and safe to ship.

Tasks:

- Add a short README section or command description update.
- Explain custom rules and built-in references in simple English.
- Run validation commands.

Commands:

```bash
npm run format
npm run lint
npm test
```

## Suggested Order

1. Built-in references first, because they fix the empty picker problem.
2. Parser and model changes next, because all UI and validation code depends on them.
3. Renderer and creation prompts next, because users can then create valid rules.
4. Explorer details and validation next, because the UI must explain what was created.
5. Edit support and docs last.

## Notes

- Existing `CustomRule`, `FormStateRule`, `CommandClientTypeRule`, and part of `ValueRule` support should be reused.
- Keep XML output small and stable.
- Prefer typed support only for common rules. Keep unknown XML support for rare or old rules.
- Built-in `Mscrm.*` rule IDs are references. They should not create local `<EnableRule>` nodes.

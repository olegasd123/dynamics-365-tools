import { CommandContext } from "@app/commandContext";
import { BUILT_IN_ENABLE_RULES } from "../enableRuleCatalog";
import {
  createCommandRuleRefPatch,
  createDisplayRulePatches,
  createEnableRulePatches,
} from "../ribbonEditPatches";
import { RibbonExplorerNode } from "../ribbonExplorer";
import { DisplayRule, EnableRule, RibbonDocument, RibbonPatch, RibbonView } from "../models";
import {
  collectRibbonIds,
  nextBatchId,
  resolveCommandTarget,
  resolveRibbonTarget,
  validateUniqueId,
} from "./ribbonCommandSupport";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";
import { promptRuleStep } from "./ribbonRulePrompts";

export async function addRibbonCommandEnableRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "EnableRule");
}

export async function addRibbonCommandDisplayRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "DisplayRule");
}

export async function addRibbonEnableRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Enable");
}

export async function addRibbonDisplayRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Display");
}

async function addRibbonRule(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "Enable" | "Display",
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const suggestedId = nextBatchId(
    collectRibbonIds(target.document),
    `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.${kind}Rule`,
  );
  const id = await showRibbonInputBox({
    prompt: `${kind} rule id`,
    value: suggestedId,
    validateInput: (value) => validateUniqueId(target.document, value, "Rule id is required."),
  });
  if (!id) {
    return;
  }

  const step = await promptRuleStep(ctx, kind);
  if (step === undefined) {
    return;
  }

  const createPatches = kind === "Enable" ? createEnableRulePatches : createDisplayRulePatches;
  ctx.ribbon.editorState.queuePatches(
    target.document,
    createPatches(target.document, {
      id: id.trim(),
      step: step ?? undefined,
    }),
  );
  ctx.ribbon.explorer.refresh();
}

async function addRibbonCommandRuleRef(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "EnableRule" | "DisplayRule",
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a command definition first.");
    return;
  }

  const selection =
    kind === "EnableRule"
      ? await pickRuleRef(
          "Enable rule",
          target.document,
          target.command.enableRuleRefs,
          suggestedCommandRuleRefId(target.command.id, kind),
          (view) => view.enableRules,
          () =>
            promptNewEnableRuleRef(
              ctx,
              target.document,
              target.command.enableRuleRefs,
              suggestedCommandRuleRefId(target.command.id, kind),
            ),
        )
      : await pickRuleRef(
          "Display rule",
          target.document,
          target.command.displayRuleRefs,
          suggestedCommandRuleRefId(target.command.id, kind),
          (view) => view.displayRules,
        );
  if (!selection) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(target.document, [
    ...selection.patches,
    createCommandRuleRefPatch(target.document, target.command, kind, selection.id),
  ]);
  ctx.ribbon.explorer.refresh();
}

interface RuleRefSelection {
  id: string;
  patches: RibbonPatch[];
}

async function pickRuleRef<T extends EnableRule | DisplayRule>(
  label: string,
  document: RibbonDocument,
  currentRefs: string[],
  suggestedId: string,
  selectRules: (view: RibbonView) => T[],
  createNewRule?: () => Promise<RuleRefSelection | undefined>,
): Promise<RuleRefSelection | undefined> {
  const used = new Set(currentRefs);
  const rules = uniqueById(document.views.flatMap(selectRules)).filter(
    (rule) => !used.has(rule.id),
  );
  const builtInRules =
    label === "Enable rule"
      ? BUILT_IN_ENABLE_RULES.filter((rule) => !used.has(rule.id)).map((rule) => ({
          label: rule.id,
          description: "Built-in",
          detail: rule.description,
        }))
      : [];
  const manual = `Type ${label.toLowerCase()} id`;
  const createNew = `Add new ${label.toLowerCase()}`;
  const pick = await showRibbonQuickPick(
    [
      ...(createNewRule
        ? [{ label: createNew, description: "Create a rule and add its reference" }]
        : []),
      ...rules.map((rule) => ({ label: rule.id })),
      { label: manual, description: "Use an id that is not in this view yet" },
      ...builtInRules,
    ],
    { placeHolder: label },
  );
  if (!pick) {
    return undefined;
  }

  if (pick.label === createNew && createNewRule) {
    return createNewRule();
  }

  if (pick.label !== manual) {
    return { id: pick.label, patches: [] };
  }

  const id = await showRibbonInputBox({
    prompt: `${label} id`,
    value: suggestedId,
    validateInput: (value) => {
      const id = value.trim();
      if (!id) {
        return `${label} id is required.`;
      }
      return currentRefs.includes(id) ? "This command already references this rule." : undefined;
    },
  });
  return id ? { id: id.trim(), patches: [] } : undefined;
}

async function promptNewEnableRuleRef(
  ctx: CommandContext,
  document: RibbonDocument,
  currentRefs: string[],
  suggestedId: string,
): Promise<RuleRefSelection | undefined> {
  const usedIds = new Set([...collectRibbonIds(document), ...currentRefs]);
  const id = await showRibbonInputBox({
    prompt: "Enable rule id",
    value: nextBatchId(usedIds, suggestedId),
    validateInput: (value) => {
      const trimmed = value.trim();
      if (currentRefs.includes(trimmed)) {
        return "This command already references this rule.";
      }

      return validateUniqueId(document, trimmed, "Rule id is required.");
    },
  });
  if (!id) {
    return undefined;
  }

  const step = await promptRuleStep(ctx, "Enable");
  if (step === undefined) {
    return undefined;
  }

  const trimmedId = id.trim();
  return {
    id: trimmedId,
    patches: createEnableRulePatches(document, {
      id: trimmedId,
      step: step ?? undefined,
    }),
  };
}

function suggestedCommandRuleRefId(commandId: string, kind: "EnableRule" | "DisplayRule"): string {
  return commandId.endsWith(".Command")
    ? `${commandId.slice(0, -".Command".length)}.${kind}`
    : `${commandId}.${kind}`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

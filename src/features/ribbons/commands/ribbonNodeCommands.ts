import { CommandContext } from "@app/commandContext";
import {
  createCommandActionReplacePatch,
  createCustomButtonReplacePatch,
  createDeleteNodePatch,
  createHideActionReplacePatch,
  createLocLabelTitleReplacePatch,
  createNodeAttributeValuePatch,
  createRuleChildStepPatch,
  createRuleStepReplacePatch,
  createSwapNodePatches,
  NewCustomButtonInput,
} from "../ribbonEditPatches";
import { RibbonExplorerNode, RibbonItemNode } from "../ribbonExplorer";
import {
  ActionParameter,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  HideAction,
  LocLabel,
  LocLabelTitle,
  RibbonDocument,
  RuleStep,
  TextRange,
} from "../models";
import {
  createRibbonCascadeDeletePlan,
  formatRibbonCascadeDeleteItem,
  RibbonCascadeDeleteItem,
} from "../ribbonCascadeDelete";
import {
  promptCommandAction,
  promptOptional,
  promptRequired,
  validateOptionalNumber,
} from "./ribbonActionPrompts";
import { sameRange, validateUniqueId } from "./ribbonCommandSupport";
import { promptRibbonLanguageCode } from "./ribbonLanguagePrompts";
import { showRibbonInputBox } from "./ribbonPromptUi";
import { pickImageWebResource } from "./ribbonResourcePrompts";
import { promptRuleStep } from "./ribbonRulePrompts";
import { resolveSource } from "./ribbonSourceCommands";

const DELETE_RELATED_ITEMS = "Delete Related Items";
const DELETE_SELECTED_ONLY = "Delete Selected Only";
const DELETE_PARAMETER = "Delete Parameter";
const DELETE_HIDE_ACTION = "Delete Hide Action";
const DELETE_LOC_LABEL_LANGUAGE = "Delete Language";
export async function deleteRibbonNode(ctx: CommandContext, node?: RibbonItemNode): Promise<void> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    await ctx.core.notifications.warning("Select a ribbon item that can be deleted.");
    return;
  }

  const { document, range } = node.editTarget;
  if (node.contextValue === "d365RibbonParameter") {
    const choice = await ctx.core.notifications.askWarning(
      `Delete parameter ${node.label}?`,
      [DELETE_PARAMETER],
      {
        modal: true,
        detail: "This removes the parameter XML from the ribbon action.",
      },
    );
    if (choice !== DELETE_PARAMETER) {
      return;
    }
  }
  if (node.contextValue === "d365RibbonHideAction") {
    const choice = await ctx.core.notifications.askWarning(
      `Delete hide action ${node.label}?`,
      [DELETE_HIDE_ACTION],
      {
        modal: true,
        detail: "This removes the HideCustomAction XML from the ribbon.",
      },
    );
    if (choice !== DELETE_HIDE_ACTION) {
      return;
    }
  }
  if (node.contextValue === "d365RibbonLocLabelTitle") {
    const target = findLocLabelTitleDeleteTarget(document, range);
    const labelText = target
      ? `Loc label language ${target.title.languageCode} from ${target.label.id}`
      : `Loc label language ${node.label}`;
    const choice = await ctx.core.notifications.askWarning(
      `Delete ${labelText}?`,
      [DELETE_LOC_LABEL_LANGUAGE],
      {
        modal: true,
        detail: "This removes this language title from the LocLabel.",
      },
    );
    if (choice !== DELETE_LOC_LABEL_LANGUAGE) {
      return;
    }
  }

  const plan = createRibbonCascadeDeletePlan(document, node.contextValue, range);
  if (!plan?.related.length) {
    ctx.ribbon.editorState.queuePatches(document, [
      createDeleteNodePatch(document.sourceText, range),
    ]);
    ctx.ribbon.explorer.refresh();
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Delete ${plan.related.length} related ribbon item${plan.related.length === 1 ? "" : "s"}?`,
    [DELETE_RELATED_ITEMS, DELETE_SELECTED_ONLY],
    {
      modal: true,
      detail: relatedDeleteMessage(plan.related),
    },
  );
  if (!choice) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    document,
    choice === DELETE_RELATED_ITEMS
      ? plan.patches
      : [createDeleteNodePatch(document.sourceText, range)],
  );
  ctx.ribbon.explorer.refresh();
}

function findLocLabelTitleDeleteTarget(
  document: RibbonDocument,
  range: TextRange,
): { label: LocLabel; title: LocLabelTitle } | undefined {
  for (const view of document.views) {
    for (const label of view.locLabels) {
      const title = label.titles.find((item) => sameRange(item.range, range));
      if (title) {
        return { label, title };
      }
    }
  }

  return undefined;
}

function relatedDeleteMessage(related: RibbonCascadeDeleteItem[]): string {
  return [
    "These items have only one reference, and it is linked to the item you are deleting:",
    "",
    ...related.map((item) => {
      const reason = item.reason ? ` ${item.reason}` : "";
      return `- ${formatRibbonCascadeDeleteItem(item)}.${reason}`;
    }),
    "",
    "Use Undo Ribbon Edit to restore them.",
  ].join("\n");
}

export async function editRibbonNode(ctx: CommandContext, node?: RibbonItemNode): Promise<void> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    await ctx.core.notifications.warning("Select a ribbon item that can be edited.");
    return;
  }

  const target = resolveEditableTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("This ribbon item cannot be edited yet.");
    return;
  }

  switch (target.kind) {
    case "CustomAction":
      await editCustomAction(ctx, target.document, target.action);
      return;
    case "HideAction":
      await editHideAction(ctx, target.document, target.action);
      return;
    case "CommandDefinition":
      await editNodeId(
        ctx,
        target.document,
        target.command.range,
        "CommandDefinition id",
        target.command.id,
      );
      return;
    case "EnableRule":
      await editNodeId(ctx, target.document, target.rule.range, "Enable rule id", target.rule.id);
      return;
    case "DisplayRule":
      await editNodeId(ctx, target.document, target.rule.range, "Display rule id", target.rule.id);
      return;
    case "LocLabel":
      await editNodeId(ctx, target.document, target.label.range, "Loc label id", target.label.id);
      return;
    case "CommandAction":
      await editCommandAction(ctx, target.document, target.action);
      return;
    case "RuleStep":
      await editRuleStep(ctx, target.document, target.ruleKind, target.step);
      return;
    case "LocLabelTitle":
      await editLocLabelTitle(ctx, target.document, target.title);
      return;
  }
}
export async function addRibbonRuleChildStep(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRuleStepTarget(node);
  if (!target || target.step.kind !== "OrRule") {
    await ctx.core.notifications.warning("Select an OrRule first.");
    return;
  }

  const step = await promptRuleStep(ctx, target.ruleKind);
  if (!step) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(target.document, [
    createRuleChildStepPatch(target.document.sourceText, target.step, step),
  ]);
  ctx.ribbon.explorer.refresh();
}

export async function moveRibbonNodeUp(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, -1);
}

export async function moveRibbonNodeDown(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, 1);
}

type EditableTarget =
  | { kind: "CustomAction"; document: RibbonDocument; action: CustomAction }
  | { kind: "HideAction"; document: RibbonDocument; action: HideAction }
  | { kind: "CommandDefinition"; document: RibbonDocument; command: CommandDefinition }
  | { kind: "EnableRule"; document: RibbonDocument; rule: EnableRule }
  | { kind: "DisplayRule"; document: RibbonDocument; rule: DisplayRule }
  | { kind: "LocLabel"; document: RibbonDocument; label: LocLabel }
  | { kind: "CommandAction"; document: RibbonDocument; action: CommandAction }
  | {
      kind: "RuleStep";
      document: RibbonDocument;
      ruleKind: "Enable" | "Display";
      step: RuleStep;
    }
  | { kind: "LocLabelTitle"; document: RibbonDocument; title: LocLabelTitle };

type ReorderTarget = {
  document: RibbonDocument;
  ranges: Array<{ start: number; end: number }>;
  index: number;
};

type ReorderIdentity =
  | { kind: "CustomAction"; id: string }
  | { kind: "HideAction"; id: string }
  | { kind: "CommandDefinition"; id: string }
  | { kind: "EnableRule"; id: string }
  | { kind: "DisplayRule"; id: string }
  | { kind: "LocLabel"; id: string }
  | { kind: "LocLabelTitle"; labelId: string; languageCode: number }
  | {
      kind: "ActionParameter";
      parent: ParameterParentIdentity;
      parameterKind: ActionParameter["kind"];
      value: string;
      occurrence: number;
    };

type ParameterParentIdentity =
  | { kind: "CommandAction"; commandId: string; actionIndex: number }
  | {
      kind: "RuleStep";
      ruleKind: "EnableRule" | "DisplayRule";
      ruleId: string;
      stepIndex: number;
    };

async function moveRibbonNode(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  direction: -1 | 1,
): Promise<void> {
  const target = await resolveReorderTarget(ctx, node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon item that can be moved.");
    return;
  }

  const nextIndex = target.index + direction;
  if (nextIndex < 0 || nextIndex >= target.ranges.length) {
    await ctx.core.notifications.warning(
      direction < 0 ? "Item is already first." : "Item is already last.",
    );
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createSwapNodePatches(
      target.document.sourceText,
      target.ranges[target.index],
      target.ranges[nextIndex],
    ),
  );
  ctx.ribbon.explorer.refresh();
}

async function resolveReorderTarget(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<ReorderTarget | undefined> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  const target = node.editTarget;
  const identity = resolveReorderIdentity(node, target.document, target.range);
  const currentDocument = await resolveCurrentRibbonDocument(ctx, node, target.document);
  return resolveReorderTargetInDocument(
    node.contextValue,
    currentDocument ?? target.document,
    target.range,
    identity,
  );
}

async function resolveCurrentRibbonDocument(
  ctx: CommandContext,
  node: RibbonExplorerNode,
  document: RibbonDocument,
): Promise<RibbonDocument | undefined> {
  const source = await resolveSource(ctx, node);
  if (!source) {
    return undefined;
  }

  const documents = await ctx.ribbon.editorState.loadSource(source);
  return (
    documents.find((item) => item.id === document.id) ??
    documents.find(
      (item) =>
        item.fileUri === document.fileUri &&
        item.kind === document.kind &&
        item.entityLogicalName === document.entityLogicalName,
    )
  );
}

function resolveReorderTargetInDocument(
  contextValue: string,
  document: RibbonDocument,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): ReorderTarget | undefined {
  for (const view of document.views) {
    const customAction =
      identity?.kind === "CustomAction"
        ? view.customActions.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.customActions, range);
    if (contextValue === "d365RibbonCustomAction" && customAction >= 0) {
      return {
        document,
        ranges: view.customActions.map((item) => item.range),
        index: customAction,
      };
    }

    const hideAction =
      identity?.kind === "HideAction"
        ? view.hideActions.findIndex((item) => item.hideActionId === identity.id)
        : findRangeIndex(view.hideActions, range);
    if (contextValue === "d365RibbonHideAction" && hideAction >= 0) {
      return {
        document,
        ranges: view.hideActions.map((item) => item.range),
        index: hideAction,
      };
    }

    const commandDefinition =
      identity?.kind === "CommandDefinition"
        ? view.commandDefinitions.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.commandDefinitions, range);
    if (contextValue === "d365RibbonCommandDefinition" && commandDefinition >= 0) {
      return {
        document,
        ranges: view.commandDefinitions.map((item) => item.range),
        index: commandDefinition,
      };
    }

    const enableRule =
      identity?.kind === "EnableRule"
        ? view.enableRules.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.enableRules, range);
    if (contextValue === "d365RibbonEnableRule" && enableRule >= 0) {
      return {
        document,
        ranges: view.enableRules.map((item) => item.range),
        index: enableRule,
      };
    }

    const displayRule =
      identity?.kind === "DisplayRule"
        ? view.displayRules.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.displayRules, range);
    if (contextValue === "d365RibbonDisplayRule" && displayRule >= 0) {
      return {
        document,
        ranges: view.displayRules.map((item) => item.range),
        index: displayRule,
      };
    }

    const locLabel =
      identity?.kind === "LocLabel"
        ? view.locLabels.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.locLabels, range);
    if (contextValue === "d365RibbonLocLabel" && locLabel >= 0) {
      return {
        document,
        ranges: view.locLabels.map((item) => item.range),
        index: locLabel,
      };
    }

    for (const command of view.commandDefinitions) {
      const action = findCommandActionIndex(command, range, identity);
      if (
        (contextValue === "d365RibbonJavaScriptAction" || contextValue === "d365RibbonUrlAction") &&
        action >= 0
      ) {
        return {
          document,
          ranges: command.actions.map((item) => item.range),
          index: action,
        };
      }

      const commandParameter = findCommandActionParameterTarget(command, range, identity);
      if (contextValue === "d365RibbonParameter" && commandParameter) {
        return {
          document,
          ranges: commandParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: commandParameter.index,
        };
      }
    }

    for (const rule of view.enableRules) {
      const step = findRangeIndex(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && step >= 0) {
        return {
          document,
          ranges: rule.steps.map((item) => item.range),
          index: step,
        };
      }

      const childStep = findRuleStepSiblingTarget(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && childStep) {
        return {
          document,
          ranges: childStep.steps.map((item) => item.range),
          index: childStep.index,
        };
      }

      const ruleParameter = findRuleStepParameterTarget(rule, "EnableRule", range, identity);
      if (contextValue === "d365RibbonParameter" && ruleParameter) {
        return {
          document,
          ranges: ruleParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: ruleParameter.index,
        };
      }
    }

    for (const rule of view.displayRules) {
      const step = findRangeIndex(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && step >= 0) {
        return {
          document,
          ranges: rule.steps.map((item) => item.range),
          index: step,
        };
      }

      const childStep = findRuleStepSiblingTarget(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && childStep) {
        return {
          document,
          ranges: childStep.steps.map((item) => item.range),
          index: childStep.index,
        };
      }

      const ruleParameter = findRuleStepParameterTarget(rule, "DisplayRule", range, identity);
      if (contextValue === "d365RibbonParameter" && ruleParameter) {
        return {
          document,
          ranges: ruleParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: ruleParameter.index,
        };
      }
    }

    for (const label of view.locLabels) {
      const title =
        identity?.kind === "LocLabelTitle"
          ? label.id === identity.labelId
            ? label.titles.findIndex((item) => item.languageCode === identity.languageCode)
            : -1
          : findRangeIndex(label.titles, range);
      if (contextValue === "d365RibbonLocLabelTitle" && title >= 0) {
        return {
          document,
          ranges: label.titles.map((item) => item.range),
          index: title,
        };
      }
    }
  }

  return undefined;
}

function resolveReorderIdentity(
  node: RibbonItemNode,
  document: RibbonDocument,
  range: TextRange,
): ReorderIdentity | undefined {
  for (const view of document.views) {
    const customAction = view.customActions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonCustomAction" && customAction) {
      return { kind: "CustomAction", id: customAction.id };
    }

    const hideAction = view.hideActions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonHideAction" && hideAction) {
      return { kind: "HideAction", id: hideAction.hideActionId };
    }

    const commandDefinition = view.commandDefinitions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonCommandDefinition" && commandDefinition) {
      return { kind: "CommandDefinition", id: commandDefinition.id };
    }

    for (const command of view.commandDefinitions) {
      const actionIndex = command.actions.findIndex((action) =>
        commandActionParameters(action).some(
          (parameter) => parameter.range && sameRange(parameter.range, range),
        ),
      );
      const action = command.actions[actionIndex];
      const parameters = action ? commandActionParameters(action) : [];
      if (node.contextValue === "d365RibbonParameter" && parameters.length) {
        const parameterIndex = parameters.findIndex(
          (parameter) => parameter.range && sameRange(parameter.range, range),
        );
        const parameter = parameters[parameterIndex];
        if (parameter) {
          return {
            kind: "ActionParameter",
            parent: { kind: "CommandAction", commandId: command.id, actionIndex },
            parameterKind: parameter.kind,
            value: parameter.value,
            occurrence: parameterOccurrence(parameters, parameterIndex),
          };
        }
      }
    }

    const enableRule = view.enableRules.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonEnableRule" && enableRule) {
      return { kind: "EnableRule", id: enableRule.id };
    }

    for (const rule of view.enableRules) {
      const identity = ruleStepParameterIdentity(rule, "EnableRule", range);
      if (node.contextValue === "d365RibbonParameter" && identity) {
        return identity;
      }
    }

    const displayRule = view.displayRules.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonDisplayRule" && displayRule) {
      return { kind: "DisplayRule", id: displayRule.id };
    }

    for (const rule of view.displayRules) {
      const identity = ruleStepParameterIdentity(rule, "DisplayRule", range);
      if (node.contextValue === "d365RibbonParameter" && identity) {
        return identity;
      }
    }

    for (const label of view.locLabels) {
      if (node.contextValue === "d365RibbonLocLabel" && sameRange(label.range, range)) {
        return { kind: "LocLabel", id: label.id };
      }

      const title = label.titles.find((item) => sameRange(item.range, range));
      if (node.contextValue === "d365RibbonLocLabelTitle" && title) {
        return { kind: "LocLabelTitle", labelId: label.id, languageCode: title.languageCode };
      }
    }
  }

  return undefined;
}

function findCommandActionIndex(
  command: CommandDefinition,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): number {
  if (
    identity?.kind === "ActionParameter" &&
    identity.parent.kind === "CommandAction" &&
    identity.parent.commandId === command.id
  ) {
    return identity.parent.actionIndex;
  }

  return findRangeIndex(command.actions, range);
}

function findCommandActionParameterTarget(
  command: CommandDefinition,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): { parameters: ActionParameter[]; index: number } | undefined {
  for (const [actionIndex, action] of command.actions.entries()) {
    const parameters = commandActionParameters(action);
    if (!parameters.length) {
      continue;
    }

    if (
      identity?.kind === "ActionParameter" &&
      identity.parent.kind === "CommandAction" &&
      identity.parent.commandId === command.id &&
      identity.parent.actionIndex === actionIndex
    ) {
      const index = findParameterByIdentity(parameters, identity);
      return index >= 0 ? { parameters, index } : undefined;
    }

    const index = findParameterRangeIndex(parameters, range);
    if (index >= 0) {
      return { parameters, index };
    }
  }

  return undefined;
}

function commandActionParameters(action: CommandAction): ActionParameter[] {
  if (action.kind === "JavaScriptFunction" || action.kind === "Url") {
    return action.parameters;
  }

  return [];
}

function findRuleStepParameterTarget(
  rule: EnableRule | DisplayRule,
  ruleKind: "EnableRule" | "DisplayRule",
  range: TextRange,
  identity: ReorderIdentity | undefined,
): { parameters: ActionParameter[]; index: number } | undefined {
  for (const [stepIndex, step] of rule.steps.entries()) {
    if (step.kind !== "CustomRule") {
      continue;
    }

    if (
      identity?.kind === "ActionParameter" &&
      identity.parent.kind === "RuleStep" &&
      identity.parent.ruleKind === ruleKind &&
      identity.parent.ruleId === rule.id &&
      identity.parent.stepIndex === stepIndex
    ) {
      const index = findParameterByIdentity(step.parameters, identity);
      return index >= 0 ? { parameters: step.parameters, index } : undefined;
    }

    const index = findParameterRangeIndex(step.parameters, range);
    if (index >= 0) {
      return { parameters: step.parameters, index };
    }
  }

  return undefined;
}

function findRuleStepSiblingTarget(
  steps: RuleStep[],
  range: TextRange,
): { steps: RuleStep[]; index: number } | undefined {
  for (const step of steps) {
    if (step.kind !== "OrRule") {
      continue;
    }

    const index = findRangeIndex(step.children, range);
    if (index >= 0) {
      return { steps: step.children, index };
    }

    const child = findRuleStepSiblingTarget(step.children, range);
    if (child) {
      return child;
    }
  }

  return undefined;
}

function ruleStepParameterIdentity(
  rule: EnableRule | DisplayRule,
  ruleKind: "EnableRule" | "DisplayRule",
  range: TextRange,
): ReorderIdentity | undefined {
  for (const [stepIndex, step] of rule.steps.entries()) {
    if (step.kind !== "CustomRule") {
      continue;
    }

    const parameterIndex = findParameterRangeIndex(step.parameters, range);
    const parameter = step.parameters[parameterIndex];
    if (!parameter) {
      continue;
    }

    return {
      kind: "ActionParameter",
      parent: { kind: "RuleStep", ruleKind, ruleId: rule.id, stepIndex },
      parameterKind: parameter.kind,
      value: parameter.value,
      occurrence: parameterOccurrence(step.parameters, parameterIndex),
    };
  }

  return undefined;
}

function findParameterByIdentity(
  parameters: ActionParameter[],
  identity: Extract<ReorderIdentity, { kind: "ActionParameter" }>,
): number {
  let occurrence = 0;

  return parameters.findIndex((parameter) => {
    if (parameter.kind !== identity.parameterKind || parameter.value !== identity.value) {
      return false;
    }

    const matches = occurrence === identity.occurrence;
    occurrence += 1;
    return matches;
  });
}

function parameterOccurrence(parameters: ActionParameter[], index: number): number {
  const target = parameters[index];
  if (!target) {
    return -1;
  }

  return parameters
    .slice(0, index)
    .filter((parameter) => parameter.kind === target.kind && parameter.value === target.value)
    .length;
}

function findParameterRangeIndex(parameters: ActionParameter[], range: TextRange): number {
  return parameters.findIndex((parameter) => parameter.range && sameRange(parameter.range, range));
}

function findRangeIndex<T extends { range: { start: number; end: number } }>(
  items: T[],
  range: { start: number; end: number },
): number {
  return items.findIndex((item) => sameRange(item.range, range));
}

function resolveEditableTarget(node: RibbonItemNode): EditableTarget | undefined {
  const target = node.editTarget;
  if (!target) {
    return undefined;
  }

  for (const view of target.document.views) {
    const customAction = view.customActions.find((item) => sameRange(item.range, target.range));
    if (customAction && node.contextValue === "d365RibbonCustomAction") {
      return { kind: "CustomAction", document: target.document, action: customAction };
    }

    const hideAction = view.hideActions.find((item) => sameRange(item.range, target.range));
    if (hideAction) {
      return { kind: "HideAction", document: target.document, action: hideAction };
    }

    for (const command of view.commandDefinitions) {
      if (
        sameRange(command.range, target.range) &&
        node.contextValue === "d365RibbonCommandDefinition"
      ) {
        return { kind: "CommandDefinition", document: target.document, command };
      }

      const action = command.actions.find((item) => sameRange(item.range, target.range));
      if (action && action.kind !== "Unknown") {
        return { kind: "CommandAction", document: target.document, action };
      }
    }

    for (const rule of view.enableRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonEnableRule") {
        return { kind: "EnableRule", document: target.document, rule };
      }

      const step = findRuleStepByRange(rule.steps, target.range);
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Enable", step };
      }
    }

    for (const rule of view.displayRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonDisplayRule") {
        return { kind: "DisplayRule", document: target.document, rule };
      }

      const step = findRuleStepByRange(rule.steps, target.range);
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Display", step };
      }
    }

    for (const label of view.locLabels) {
      if (sameRange(label.range, target.range) && node.contextValue === "d365RibbonLocLabel") {
        return { kind: "LocLabel", document: target.document, label };
      }

      const title = label.titles.find((item) => sameRange(item.range, target.range));
      if (title) {
        return { kind: "LocLabelTitle", document: target.document, title };
      }
    }
  }

  return undefined;
}

function resolveRuleStepTarget(
  node: RibbonExplorerNode | undefined,
): Extract<EditableTarget, { kind: "RuleStep" }> | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  const target = resolveEditableTarget(node);
  return target?.kind === "RuleStep" ? target : undefined;
}

function findRuleStepByRange(steps: RuleStep[], range: TextRange): RuleStep | undefined {
  for (const step of steps) {
    if (sameRange(step.range, range)) {
      return step;
    }

    if (step.kind === "OrRule") {
      const child = findRuleStepByRange(step.children, range);
      if (child) {
        return child;
      }
    }
  }

  return undefined;
}

async function editCustomAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CustomAction,
): Promise<void> {
  if (action.commandUI?.kind !== "Button") {
    await ctx.core.notifications.warning("Only Button custom actions can be edited.");
    return;
  }

  const customActionId = await promptRequired("Custom action id", action.id);
  if (customActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  const buttonId = await promptRequired("Button id", action.commandUI.id);
  if (buttonId === undefined) {
    return;
  }

  const commandId = await promptRequired("Command id", action.commandUI.command);
  if (commandId === undefined) {
    return;
  }

  const labelLocId = await promptOptional("Button label Id", action.commandUI.labelLocId);
  if (labelLocId === undefined) {
    return;
  }

  const labelText = await promptOptional(
    "Button label",
    action.commandUI.labelText ?? getButtonLabelDefault(document, labelLocId, ""),
  );
  if (labelText === undefined) {
    return;
  }
  const labelDefault = getButtonLabelDefault(document, labelLocId, labelText);
  const inlineLabelText = getEditedInlineButtonLabelText(
    document,
    labelLocId,
    labelText,
    action.commandUI.labelText,
  );

  const alt = await promptOptional("Alt", action.commandUI.alt || labelDefault);
  if (alt === undefined) {
    return;
  }

  const toolTipTitle = await promptOptional(
    "Tool tip title",
    action.commandUI.toolTipTitle || labelDefault,
  );
  if (toolTipTitle === undefined) {
    return;
  }

  const toolTipDescription = await promptOptional(
    "Tool tip description",
    action.commandUI.toolTipDescription || labelDefault,
  );
  if (toolTipDescription === undefined) {
    return;
  }

  const image16x16 = await pickImageWebResource(
    ctx,
    "image16x16",
    action.commandUI.image16x16?.webResourceUniqueName,
  );
  if (image16x16 === undefined) {
    return;
  }

  const image32x32 = await pickImageWebResource(
    ctx,
    "image32x32",
    action.commandUI.image32x32?.webResourceUniqueName,
  );
  if (image32x32 === undefined) {
    return;
  }

  const modernImage = await pickImageWebResource(
    ctx,
    "modernImage",
    action.commandUI.modernImage?.webResourceUniqueName,
  );
  if (modernImage === undefined) {
    return;
  }

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: action.sequence === undefined ? "" : String(action.sequence),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const templateAlias = await promptOptional("Template alias", action.commandUI.templateAlias);
  if (templateAlias === undefined) {
    return;
  }

  const input: NewCustomButtonInput = {
    customActionId: customActionId.trim(),
    location: location.trim(),
    sequence: sequenceText.trim() ? Number(sequenceText.trim()) : undefined,
    buttonId: buttonId.trim(),
    commandId: commandId.trim(),
    action: { kind: "Url", address: "" },
    labelLocId: labelLocId.trim() || undefined,
    labelText: inlineLabelText,
    alt: alt.trim() || undefined,
    toolTipTitle: toolTipTitle.trim() || undefined,
    toolTipDescription: toolTipDescription.trim() || undefined,
    image16x16: image16x16.trim() || undefined,
    image32x32: image32x32.trim() || undefined,
    modernImage: modernImage.trim() || undefined,
    templateAlias: templateAlias.trim() || undefined,
  };

  ctx.ribbon.editorState.queuePatches(document, [
    createCustomButtonReplacePatch(document.sourceText, action.range, input),
  ]);
  ctx.ribbon.explorer.refresh();
}

function getButtonLabelDefault(
  document: RibbonDocument,
  labelLocId: string,
  labelText: string,
): string | undefined {
  const inlineLabel = labelText.trim();
  if (inlineLabel) {
    return inlineLabel;
  }

  const locLabelId = labelLocId.trim();
  if (!locLabelId) {
    return undefined;
  }

  for (const view of document.views) {
    const title = view.locLabels
      .find((label) => label.id === locLabelId)
      ?.titles.find((item) => item.description.trim());
    if (title) {
      return title.description;
    }
  }

  return undefined;
}

function getEditedInlineButtonLabelText(
  document: RibbonDocument,
  labelLocId: string,
  labelText: string,
  existingInlineLabelText: string | undefined,
): string | undefined {
  const inlineLabel = labelText.trim();
  if (!inlineLabel) {
    return undefined;
  }

  if (existingInlineLabelText !== undefined) {
    return inlineLabel;
  }

  const locLabelDefault = getButtonLabelDefault(document, labelLocId, "")?.trim();
  return locLabelDefault === inlineLabel ? undefined : inlineLabel;
}

async function editHideAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: HideAction,
): Promise<void> {
  const hideActionId = await promptRequired("Hide action id", action.hideActionId);
  if (hideActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(document, [
    createHideActionReplacePatch(document.sourceText, action.range, {
      hideActionId: hideActionId.trim(),
      location: location.trim(),
    }),
  ]);
  ctx.ribbon.explorer.refresh();
}

async function editNodeId(
  ctx: CommandContext,
  document: RibbonDocument,
  range: { start: number; end: number },
  prompt: string,
  currentId: string,
): Promise<void> {
  const id = await showRibbonInputBox({
    prompt,
    value: currentId,
    validateInput: (value) =>
      validateUniqueId(document, value, `${prompt} is required.`, currentId),
  });
  if (id === undefined) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(document, [
    createNodeAttributeValuePatch(document.sourceText, range, "Id", id.trim()),
  ]);
  ctx.ribbon.explorer.refresh();
}

async function editCommandAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CommandAction,
): Promise<void> {
  const input = await promptCommandAction(ctx, action);
  if (!input) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(document, [
    createCommandActionReplacePatch(document.sourceText, action, input),
  ]);
  ctx.ribbon.explorer.refresh();
}

async function editRuleStep(
  ctx: CommandContext,
  document: RibbonDocument,
  ruleKind: "Enable" | "Display",
  step: RuleStep,
): Promise<void> {
  const input = await promptRuleStep(ctx, ruleKind);
  if (!input) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(document, [
    createRuleStepReplacePatch(document.sourceText, step, input),
  ]);
  ctx.ribbon.explorer.refresh();
}

async function editLocLabelTitle(
  ctx: CommandContext,
  document: RibbonDocument,
  title: LocLabelTitle,
): Promise<void> {
  const languageCode = await promptRibbonLanguageCode({
    currentLanguageCode: title.languageCode,
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await promptRequired("Text", title.description);
  if (description === undefined) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(document, [
    createLocLabelTitleReplacePatch(document.sourceText, title, {
      languageCode,
      description: description.trim(),
    }),
  ]);
  ctx.ribbon.explorer.refresh();
}

import { HideAction, RibbonDocument, RibbonPatch, TextRange, XmlElementRange } from "./models";
import { scanXmlElements } from "./ribbonXmlReader";

export interface NewHideActionInput {
  hideActionId: string;
  location: string;
}

export type NewCommandActionInput =
  | {
      kind: "JavaScriptFunction";
      library: string;
      functionName: string;
    }
  | {
      kind: "Url";
      address: string;
    };

export interface NewLocLabelInput {
  id: string;
  languageCode: number;
  description: string;
}

export interface NewCommandDefinitionInput {
  id: string;
  action?: NewCommandActionInput;
  enableRuleIds?: string[];
  displayRuleIds?: string[];
}

export type NewRuleStepInput =
  | {
      kind: "CustomRule";
      library: string;
      functionName: string;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "EntityPrivilegeRule";
      entityName?: string;
      privilegeType: string;
      privilegeDepth?: string;
      invertResult?: boolean;
    }
  | {
      kind: "ValueRule";
      field: string;
      value: string;
      invertResult?: boolean;
    }
  | {
      kind: "FormStateRule";
      state: string;
      invertResult?: boolean;
    }
  | {
      kind: "CommandClientTypeRule";
      type: "Modern" | "Refresh";
    };

export interface NewRuleInput {
  id: string;
  step?: NewRuleStepInput;
}

export interface NewCustomButtonInput {
  customActionId: string;
  location: string;
  buttonId: string;
  commandId: string;
  action: NewCommandActionInput;
  sequence?: number;
  labelLocId?: string;
  labelText?: string;
  image16x16?: string;
  image32x32?: string;
  templateAlias?: string;
  enableRuleIds?: string[];
  displayRuleIds?: string[];
  locLabel?: NewLocLabelInput;
}

const RIBBON_SECTION_ORDER = [
  "CustomActions",
  "Templates",
  "CommandDefinitions",
  "RuleDefinitions",
  "LocLabels",
] as const;

export function createDeleteNodePatch(sourceText: string, range: TextRange): RibbonPatch {
  return { kind: "delete", range: expandToLineRange(sourceText, range) };
}

export function createCustomButtonPatches(
  document: RibbonDocument,
  input: NewCustomButtonInput,
): RibbonPatch[] {
  const sectionEdits: RibbonSectionChildEdit[] = [
    {
      sectionName: "CustomActions",
      childText: renderCustomButtonAction(input),
    },
    {
      sectionName: "CommandDefinitions",
      childText: renderCommandDefinition(input),
    },
  ];

  if (input.locLabel) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: renderLocLabel(input.locLabel),
    });
  }

  return createSectionChildPatches(document, sectionEdits);
}

export function createCommandDefinitionPatches(
  document: RibbonDocument,
  input: NewCommandDefinitionInput,
): RibbonPatch[] {
  return createSectionChildPatches(document, [
    {
      sectionName: "CommandDefinitions",
      childText: renderStandaloneCommandDefinition(input),
    },
  ]);
}

export function createHideActionPatches(
  document: RibbonDocument,
  input: NewHideActionInput,
): RibbonPatch[] {
  return createSectionChildPatches(document, [
    {
      sectionName: "CustomActions",
      childText: renderHideAction(input),
    },
  ]);
}

export function createEnableRulePatches(
  document: RibbonDocument,
  input: NewRuleInput,
): RibbonPatch[] {
  return createRulePatches(document, "EnableRules", "EnableRule", input);
}

export function createDisplayRulePatches(
  document: RibbonDocument,
  input: NewRuleInput,
): RibbonPatch[] {
  return createRulePatches(document, "DisplayRules", "DisplayRule", input);
}

export function createLocLabelPatches(
  document: RibbonDocument,
  input: NewLocLabelInput,
): RibbonPatch[] {
  return createSectionChildPatches(document, [
    {
      sectionName: "LocLabels",
      childText: renderLocLabel(input),
    },
  ]);
}

export function nextHideActionId(
  document: RibbonDocument,
  hideAction: Pick<HideAction, "hideActionId">,
): string {
  const used = new Set(
    document.views.flatMap((view) => view.hideActions.map((item) => item.hideActionId)),
  );
  if (!used.has(hideAction.hideActionId)) {
    return hideAction.hideActionId;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${hideAction.hideActionId}.${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function makeHideActionId(
  document: RibbonDocument,
  scope: string,
  commandId: string,
): string {
  const owner = document.entityLogicalName ?? "application";
  return `d365tools.${sanitizeIdPart(owner)}.${sanitizeIdPart(scope)}.Hide.${sanitizeIdPart(commandId)}`;
}

export function makeCustomButtonIds(
  document: RibbonDocument,
  scope: string,
  label: string,
): Pick<NewCustomButtonInput, "customActionId" | "buttonId" | "commandId" | "labelLocId"> {
  const owner = document.entityLogicalName ?? "application";
  const base = `d365tools.${sanitizeIdPart(owner)}.${sanitizeIdPart(scope)}.${sanitizeIdPart(label)}`;

  return {
    customActionId: nextRibbonId(document, `${base}.CustomAction`),
    buttonId: nextRibbonId(document, `${base}.Button`),
    commandId: nextRibbonId(document, `${base}.Command`),
    labelLocId: nextRibbonId(document, `${base}.Label`),
  };
}

interface RibbonSectionChildEdit {
  sectionName: (typeof RIBBON_SECTION_ORDER)[number];
  childText: string;
}

function createSectionChildPatches(
  document: RibbonDocument,
  edits: RibbonSectionChildEdit[],
): RibbonPatch[] {
  const ribbon = findDocumentRibbon(document);
  const patches: RibbonPatch[] = [];
  const missingSections = new Map<number, RibbonSectionChildEdit[]>();

  for (const edit of edits) {
    const section = ribbon.children.find((child) => child.name === edit.sectionName);
    if (section) {
      patches.push(createExistingSectionChildPatch(document.sourceText, section, edit.childText));
      continue;
    }

    const offset = findMissingSectionOffset(ribbon, edit.sectionName);
    const current = missingSections.get(offset) ?? [];
    current.push(edit);
    missingSections.set(offset, current);
  }

  for (const [offset, sectionEdits] of missingSections) {
    patches.push({
      kind: "insert",
      offset,
      text: renderMissingSections(document.sourceText, ribbon, sectionEdits),
    });
  }

  return patches.sort((a, b) => patchStart(b) - patchStart(a));
}

function createExistingSectionChildPatch(
  sourceText: string,
  section: XmlElementRange,
  childText: string,
): RibbonPatch {
  const sectionIndent = indentationBefore(sourceText, section.range.start);
  const childIndent = findChildIndent(sourceText, section) ?? `${sectionIndent}  `;

  if (section.selfClosing) {
    return {
      kind: "replace",
      range: section.range,
      text: `<${section.name}>\n${indentBlock(childText, childIndent)}\n${sectionIndent}</${section.name}>`,
    };
  }

  if (!section.children.length) {
    return {
      kind: "replace",
      range: section.innerRange,
      text: `\n${indentBlock(childText, childIndent)}\n${sectionIndent}`,
    };
  }

  const lastChild = section.children[section.children.length - 1];
  return {
    kind: "insert",
    offset: lastChild.range.end,
    text: `\n${indentBlock(childText, childIndent)}`,
  };
}

function findMissingSectionOffset(
  ribbon: XmlElementRange,
  sectionName: RibbonSectionChildEdit["sectionName"],
): number {
  const targetIndex = RIBBON_SECTION_ORDER.indexOf(sectionName);
  const nextSection = ribbon.children
    .filter((child) => RIBBON_SECTION_ORDER.includes(child.name as typeof sectionName))
    .filter((child) => RIBBON_SECTION_ORDER.indexOf(child.name as typeof sectionName) > targetIndex)
    .sort(
      (a, b) =>
        RIBBON_SECTION_ORDER.indexOf(a.name as typeof sectionName) -
        RIBBON_SECTION_ORDER.indexOf(b.name as typeof sectionName),
    )[0];

  if (nextSection) {
    return nextSection.range.start;
  }

  return ribbon.children.length ? ribbon.innerRange.end : ribbon.startTagRange.end;
}

function renderMissingSections(
  sourceText: string,
  ribbon: XmlElementRange,
  edits: RibbonSectionChildEdit[],
): string {
  const ribbonIndent = indentationBefore(sourceText, ribbon.range.start);
  const sectionIndent = `${ribbonIndent}  `;
  const childIndent = `${sectionIndent}  `;
  const orderedEdits = edits.slice().sort((a, b) => sectionOrder(a) - sectionOrder(b));

  return orderedEdits
    .map(
      (edit) =>
        `\n${sectionIndent}<${edit.sectionName}>\n${indentBlock(edit.childText, childIndent)}\n${sectionIndent}</${edit.sectionName}>`,
    )
    .join("");
}

function findDocumentRibbon(document: RibbonDocument): XmlElementRange {
  const roots = scanXmlElements(document.sourceText);
  const ribbons = collectElements(roots, "RibbonDiffXml");
  const ribbon = ribbons.find(
    (node) =>
      node.range.start === document.ribbonRange.start &&
      node.range.end === document.ribbonRange.end,
  );

  if (!ribbon) {
    throw new Error("RibbonDiffXml range was not found in the current document text.");
  }

  return ribbon;
}

function collectElements(nodes: XmlElementRange[], name: string): XmlElementRange[] {
  const matches: XmlElementRange[] = [];

  for (const node of nodes) {
    if (node.name === name) {
      matches.push(node);
    }
    matches.push(...collectElements(node.children, name));
  }

  return matches;
}

function renderHideAction(input: NewHideActionInput): string {
  return `<HideCustomAction HideActionId="${escapeXmlAttribute(input.hideActionId)}" Location="${escapeXmlAttribute(input.location)}" />`;
}

function renderCustomButtonAction(input: NewCustomButtonInput): string {
  const attributes: Array<[string, string | number | undefined]> = [
    ["Id", input.customActionId],
    ["Location", input.location],
    ["Sequence", input.sequence],
  ];
  const buttonAttributes: Array<[string, string | number | undefined]> = [
    ["Id", input.buttonId],
    ["Command", input.commandId],
    ["LabelLocId", input.labelLocId],
    ["LabelText", input.labelText],
    ["Image16by16", webResourceValue(input.image16x16)],
    ["Image32by32", webResourceValue(input.image32x32)],
    ["TemplateAlias", input.templateAlias],
  ];

  return `<CustomAction ${renderAttributes(attributes)}>
  <CommandUIDefinition>
    <Button ${renderAttributes(buttonAttributes)} />
  </CommandUIDefinition>
</CustomAction>`;
}

function renderCommandDefinition(input: NewCustomButtonInput): string {
  return `<CommandDefinition Id="${escapeXmlAttribute(input.commandId)}">
  <EnableRules>${renderRuleRefs("EnableRule", input.enableRuleIds ?? [])}</EnableRules>
  <DisplayRules>${renderRuleRefs("DisplayRule", input.displayRuleIds ?? [])}</DisplayRules>
  <Actions>
    ${renderCommandAction(input.action)}
  </Actions>
</CommandDefinition>`;
}

function renderStandaloneCommandDefinition(input: NewCommandDefinitionInput): string {
  const actions = input.action ? `\n    ${renderCommandAction(input.action)}\n  ` : "";

  return `<CommandDefinition Id="${escapeXmlAttribute(input.id)}">
  <EnableRules>${renderRuleRefs("EnableRule", input.enableRuleIds ?? [])}</EnableRules>
  <DisplayRules>${renderRuleRefs("DisplayRule", input.displayRuleIds ?? [])}</DisplayRules>
  <Actions>${actions}</Actions>
</CommandDefinition>`;
}

function renderRuleRefs(name: "EnableRule" | "DisplayRule", ids: string[]): string {
  return ids.map((id) => `<${name} Id="${escapeXmlAttribute(id)}" />`).join("");
}

function renderCommandAction(action: NewCommandActionInput): string {
  if (action.kind === "JavaScriptFunction") {
    return `<JavaScriptFunction Library="${escapeXmlAttribute(webResourceValue(action.library) ?? "")}" FunctionName="${escapeXmlAttribute(action.functionName)}" />`;
  }

  return `<Url Address="${escapeXmlAttribute(action.address)}" />`;
}

function renderLocLabel(input: NewLocLabelInput): string {
  return `<LocLabel Id="${escapeXmlAttribute(input.id)}">
  <Titles>
    <Title languagecode="${input.languageCode}" description="${escapeXmlAttribute(input.description)}" />
  </Titles>
</LocLabel>`;
}

function createRulePatches(
  document: RibbonDocument,
  containerName: "EnableRules" | "DisplayRules",
  ruleName: "EnableRule" | "DisplayRule",
  input: NewRuleInput,
): RibbonPatch[] {
  const ribbon = findDocumentRibbon(document);
  const ruleDefinitions = ribbon.children.find((child) => child.name === "RuleDefinitions");
  const ruleText = renderRule(ruleName, input);

  if (!ruleDefinitions) {
    return createSectionChildPatches(document, [
      {
        sectionName: "RuleDefinitions",
        childText: renderRuleContainer(containerName, ruleText),
      },
    ]);
  }

  if (ruleDefinitions.selfClosing) {
    const sectionIndent = indentationBefore(document.sourceText, ruleDefinitions.range.start);
    const childIndent = `${sectionIndent}  `;

    return [
      {
        kind: "replace",
        range: ruleDefinitions.range,
        text: `<RuleDefinitions>\n${indentBlock(renderRuleContainer(containerName, ruleText), childIndent)}\n${sectionIndent}</RuleDefinitions>`,
      },
    ];
  }

  const container = ruleDefinitions.children.find((child) => child.name === containerName);
  if (container) {
    return [createExistingSectionChildPatch(document.sourceText, container, ruleText)];
  }

  const offset = findMissingRuleContainerOffset(ruleDefinitions, containerName);
  const ruleDefinitionsIndent = indentationBefore(document.sourceText, ruleDefinitions.range.start);
  const containerIndent =
    findChildIndent(document.sourceText, ruleDefinitions) ?? `${ruleDefinitionsIndent}  `;
  return [
    {
      kind: "insert",
      offset,
      text: `\n${indentBlock(renderRuleContainer(containerName, ruleText), containerIndent)}`,
    },
  ];
}

function renderRuleContainer(
  containerName: "EnableRules" | "DisplayRules",
  ruleText: string,
): string {
  return `<${containerName}>\n  ${indentBlock(ruleText, "  ")}\n</${containerName}>`;
}

function renderRule(ruleName: "EnableRule" | "DisplayRule", input: NewRuleInput): string {
  const stepText = input.step ? `\n  ${indentBlock(renderRuleStep(input.step), "  ")}\n` : "";
  return `<${ruleName} Id="${escapeXmlAttribute(input.id)}">${stepText}</${ruleName}>`;
}

function renderRuleStep(step: NewRuleStepInput): string {
  switch (step.kind) {
    case "CustomRule":
      return `<CustomRule ${renderAttributes([
        ["Library", webResourceValue(step.library)],
        ["FunctionName", step.functionName],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "EntityPrivilegeRule":
      return `<EntityPrivilegeRule ${renderAttributes([
        ["EntityName", step.entityName],
        ["PrivilegeType", step.privilegeType],
        ["PrivilegeDepth", step.privilegeDepth],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "ValueRule":
      return `<ValueRule ${renderAttributes([
        ["Field", step.field],
        ["Value", step.value],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "FormStateRule":
      return `<FormStateRule ${renderAttributes([
        ["State", step.state],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "CommandClientTypeRule":
      return `<CommandClientTypeRule Type="${escapeXmlAttribute(step.type)}" />`;
  }
}

function findMissingRuleContainerOffset(
  ruleDefinitions: XmlElementRange,
  containerName: "EnableRules" | "DisplayRules",
): number {
  const containerOrder = ["TabDisplayRules", "DisplayRules", "EnableRules"];
  const targetIndex = containerOrder.indexOf(containerName);
  const nextContainer = ruleDefinitions.children
    .filter((child) => containerOrder.includes(child.name))
    .filter((child) => containerOrder.indexOf(child.name) > targetIndex)
    .sort((a, b) => containerOrder.indexOf(a.name) - containerOrder.indexOf(b.name))[0];

  if (nextContainer) {
    return nextContainer.range.start;
  }

  return ruleDefinitions.children.length
    ? ruleDefinitions.innerRange.end
    : ruleDefinitions.startTagRange.end;
}

function renderAttributes(attributes: Array<[string, string | number | undefined]>): string {
  return attributes
    .filter((attribute): attribute is [string, string | number] => attribute[1] !== undefined)
    .map(([name, value]) => `${name}="${escapeXmlAttribute(String(value))}"`)
    .join(" ");
}

function optionalBoolean(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function expandToLineRange(sourceText: string, range: TextRange): TextRange {
  let start = range.start;
  let end = range.end;

  while (start > 0 && sourceText[start - 1] !== "\n" && isWhitespace(sourceText[start - 1])) {
    start -= 1;
  }

  while (end < sourceText.length && isWhitespace(sourceText[end])) {
    const char = sourceText[end];
    end += 1;
    if (char === "\n") {
      break;
    }
  }

  return { start, end };
}

function indentationBefore(sourceText: string, offset: number): string {
  const lineStart = sourceText.lastIndexOf("\n", offset - 1) + 1;
  const text = sourceText.slice(lineStart, offset);
  return /^\s*$/.test(text) ? text : "";
}

function findChildIndent(sourceText: string, node: XmlElementRange): string | undefined {
  const child = node.children[0];
  if (!child) {
    return undefined;
  }

  return indentationBefore(sourceText, child.range.start);
}

function isWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function sectionOrder(edit: RibbonSectionChildEdit): number {
  return RIBBON_SECTION_ORDER.indexOf(edit.sectionName);
}

function patchStart(patch: RibbonPatch): number {
  return patch.kind === "insert" ? patch.offset : patch.range.start;
}

function nextRibbonId(document: RibbonDocument, id: string): string {
  const used = new Set<string>();

  for (const view of document.views) {
    for (const customAction of view.customActions) {
      used.add(customAction.id);
      if (customAction.commandUI && customAction.commandUI.kind !== "Unknown") {
        used.add(customAction.commandUI.id);
      }
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  if (!used.has(id)) {
    return id;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${id}.${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function sanitizeIdPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]+/g, ".").replace(/^\.+|\.+$/g, "");
  return sanitized || "item";
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function webResourceValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.toLowerCase().startsWith("$webresource:") ? value : `$webresource:${value}`;
}

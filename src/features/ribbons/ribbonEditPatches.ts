import {
  ActionParameter,
  CommandAction,
  CommandDefinition,
  HideAction,
  LocLabelTitle,
  RibbonEntityPropertyName,
  RibbonCommandClientType,
  RibbonDocument,
  RibbonPatch,
  RibbonOrganizationSetting,
  RibbonPageRuleAddress,
  RibbonRelationshipType,
  RibbonRuleAppliesTo,
  RibbonRuleFormType,
  RibbonRuleFormState,
  RibbonRulePrivilegeDepth,
  RibbonRulePrivilegeType,
  RuleStep,
  TextRange,
  XmlElementRange,
} from "./models";
import { collectRibbonControls, ribbonControlId } from "./ribbonControlTree";
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
      parameters?: ActionParameter[];
    }
  | {
      kind: "Url";
      address: string;
      passParams?: boolean;
      winMode?: number;
      winParams?: string;
      parameters?: ActionParameter[];
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

interface NewLabeledControlInput {
  labelLocId?: string;
  labelText?: string;
  altLocId?: string;
  alt?: string;
  toolTipTitleLocId?: string;
  toolTipTitle?: string;
  toolTipDescriptionLocId?: string;
  toolTipDescription?: string;
  image16x16?: string;
  image32x32?: string;
  modernImage?: string;
  templateAlias?: string;
}

interface NewSequencedControlInput {
  id: string;
  sequence?: number;
}

export interface NewButtonControlInput extends NewSequencedControlInput, NewLabeledControlInput {
  kind: "Button";
  commandId: string;
}

export interface NewSplitButtonControlInput
  extends NewSequencedControlInput,
    NewLabeledControlInput {
  kind: "SplitButton";
  commandId?: string;
  children?: NewRibbonControlInput[];
}

export interface NewFlyoutControlInput extends NewSequencedControlInput, NewLabeledControlInput {
  kind: "Flyout";
  commandId?: string;
  children?: NewRibbonControlInput[];
}

export interface NewGroupControlInput extends NewSequencedControlInput {
  kind: "Group";
  commandId?: string;
  title?: string;
  children?: NewRibbonControlInput[];
}

export interface NewMenuSectionControlInput extends NewSequencedControlInput {
  kind: "MenuSection";
  displayMode?: string;
  children?: NewRibbonControlInput[];
}

export type NewRibbonControlInput =
  | NewButtonControlInput
  | NewSplitButtonControlInput
  | NewFlyoutControlInput
  | NewGroupControlInput
  | NewMenuSectionControlInput;

export type CommandRuleRefKind = "EnableRule" | "DisplayRule";

export type NewRuleStepInput =
  | {
      kind: "CustomRule";
      library: string;
      functionName: string;
      default?: boolean;
      invertResult?: boolean;
      parameters?: ActionParameter[];
    }
  | {
      kind: "EntityPrivilegeRule";
      entityName?: string;
      privilegeType: RibbonRulePrivilegeType;
      privilegeDepth?: RibbonRulePrivilegeDepth;
      appliesTo?: RibbonRuleAppliesTo;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "ValueRule";
      field: string;
      value: string;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "FormStateRule";
      state: RibbonRuleFormState;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "CommandClientTypeRule";
      type: RibbonCommandClientType;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "FormTypeRule";
      type: RibbonRuleFormType;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "EntityPropertyRule";
      propertyName: RibbonEntityPropertyName;
      propertyValue: boolean;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "MiscellaneousPrivilegeRule";
      privilegeName: string;
      privilegeDepth?: RibbonRulePrivilegeDepth;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "OrganizationSettingRule";
      setting: RibbonOrganizationSetting;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "HideForTabletExperienceRule";
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "RelationshipTypeRule";
      type: RibbonRelationshipType;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "ReferencingAttributeRequiredRule";
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "PageRule";
      address: RibbonPageRuleAddress;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "OrRule";
      children?: NewRuleStepInput[];
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "SelectionCountRule";
      appliesTo?: RibbonRuleAppliesTo;
      minimum?: number;
      maximum?: number;
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "RecordPrivilegeRule";
      privilegeType: RibbonRulePrivilegeType;
      appliesTo?: "PrimaryEntity";
      default?: boolean;
      invertResult?: boolean;
    }
  | {
      kind: "EntityRule";
      entityName?: string;
      appliesTo?: RibbonRuleAppliesTo;
      context?: string;
      default?: boolean;
      invertResult?: boolean;
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
  action?: NewCommandActionInput;
  sequence?: number;
  labelLocId?: string;
  labelText?: string;
  altLocId?: string;
  alt?: string;
  toolTipTitleLocId?: string;
  toolTipTitle?: string;
  toolTipDescriptionLocId?: string;
  toolTipDescription?: string;
  image16x16?: string;
  image32x32?: string;
  modernImage?: string;
  templateAlias?: string;
  enableRuleIds?: string[];
  displayRuleIds?: string[];
  locLabel?: NewLocLabelInput;
  locLabels?: NewLocLabelInput[];
}

export interface NewCustomControlInput {
  customActionId: string;
  location: string;
  sequence?: number;
  control: NewRibbonControlInput;
  commandDefinitions?: NewCommandDefinitionInput[];
  locLabels?: NewLocLabelInput[];
}

export interface NewRibbonControlChildInput {
  parentRange: TextRange;
  control: NewRibbonControlInput;
  commandDefinitions?: NewCommandDefinitionInput[];
  locLabels?: NewLocLabelInput[];
}

export interface NewOobStubReplacementInput extends NewCustomButtonInput {
  hideActionId: string;
  hideLocation?: string;
}

export interface NewOobButtonReorderInput extends NewCustomButtonInput {
  hideActionId: string;
  hideLocation?: string;
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

  const locLabels = newLocLabels(input);
  if (locLabels.length) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: locLabels.map((label) => renderLocLabel(label)).join("\n"),
    });
  }

  return createSectionChildPatches(document, sectionEdits);
}

export function createCustomControlPatches(
  document: RibbonDocument,
  input: NewCustomControlInput,
): RibbonPatch[] {
  const sectionEdits: RibbonSectionChildEdit[] = [
    {
      sectionName: "CustomActions",
      childText: renderCustomControlAction(input),
    },
  ];

  if (input.commandDefinitions?.length) {
    sectionEdits.push({
      sectionName: "CommandDefinitions",
      childText: input.commandDefinitions
        .map((definition) => renderStandaloneCommandDefinition(definition))
        .join("\n"),
    });
  }

  if (input.locLabels?.length) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: input.locLabels.map((label) => renderLocLabel(label)).join("\n"),
    });
  }

  return createSectionChildPatches(document, sectionEdits);
}

export function createRibbonControlChildPatches(
  document: RibbonDocument,
  input: NewRibbonControlChildInput,
): RibbonPatch[] {
  const patches: RibbonPatch[] = [
    createRibbonControlChildPatch(document.sourceText, input.parentRange, input.control),
  ];

  const sectionEdits: RibbonSectionChildEdit[] = [];
  if (input.commandDefinitions?.length) {
    sectionEdits.push({
      sectionName: "CommandDefinitions",
      childText: input.commandDefinitions
        .map((definition) => renderStandaloneCommandDefinition(definition))
        .join("\n"),
    });
  }

  if (input.locLabels?.length) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: input.locLabels.map((label) => renderLocLabel(label)).join("\n"),
    });
  }

  return sortPatchesForApply([...patches, ...createSectionChildPatches(document, sectionEdits)]);
}

export function createOobStubReplacementPatches(
  document: RibbonDocument,
  inputs: NewOobStubReplacementInput[],
): RibbonPatch[] {
  if (!inputs.length) {
    return [];
  }

  const sectionEdits: RibbonSectionChildEdit[] = [
    {
      sectionName: "CustomActions",
      childText: inputs
        .flatMap((input) => [
          renderHideAction({
            hideActionId: input.hideActionId,
            location: input.hideLocation ?? input.location,
          }),
          renderCustomButtonAction(input),
        ])
        .join("\n"),
    },
    {
      sectionName: "CommandDefinitions",
      childText: inputs.map((input) => renderCommandDefinition(input)).join("\n"),
    },
  ];

  const locLabels = inputs.flatMap((input) => newLocLabels(input));
  if (locLabels.length) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: locLabels.map((input) => renderLocLabel(input)).join("\n"),
    });
  }

  return createSectionChildPatches(document, sectionEdits);
}

export function createOobButtonReorderPatches(
  document: RibbonDocument,
  inputs: NewOobButtonReorderInput[],
): RibbonPatch[] {
  if (!inputs.length) {
    return [];
  }

  const sectionEdits: RibbonSectionChildEdit[] = [
    {
      sectionName: "CustomActions",
      childText: inputs
        .flatMap((input) => [
          renderHideAction({
            hideActionId: input.hideActionId,
            location: input.hideLocation ?? input.location,
          }),
          renderCustomButtonAction(input),
        ])
        .join("\n"),
    },
  ];

  const locLabels = inputs.flatMap((input) => newLocLabels(input));
  if (locLabels.length) {
    sectionEdits.push({
      sectionName: "LocLabels",
      childText: locLabels.map((input) => renderLocLabel(input)).join("\n"),
    });
  }

  return createSectionChildPatches(document, sectionEdits);
}

export function createCustomButtonReplacePatch(
  sourceText: string,
  range: TextRange,
  input: NewCustomButtonInput,
): RibbonPatch {
  return createReplaceNodePatch(sourceText, range, renderCustomButtonAction(input));
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

export function createCommandActionPatch(
  document: RibbonDocument,
  command: CommandDefinition,
  action: NewCommandActionInput,
): RibbonPatch {
  return createCommandChildPatch(document, command, "Actions", renderCommandAction(action));
}

export function createCommandActionReplacePatch(
  sourceText: string,
  action: CommandAction,
  input: NewCommandActionInput,
): RibbonPatch {
  return createReplaceNodePatch(sourceText, action.range, renderCommandAction(input));
}

export function createCommandRuleRefPatch(
  document: RibbonDocument,
  command: CommandDefinition,
  kind: CommandRuleRefKind,
  ruleId: string,
): RibbonPatch {
  const containerName = kind === "EnableRule" ? "EnableRules" : "DisplayRules";
  return createCommandChildPatch(document, command, containerName, renderRuleRef(kind, ruleId));
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

export function createHideActionReplacePatch(
  sourceText: string,
  range: TextRange,
  input: NewHideActionInput,
): RibbonPatch {
  return createReplaceNodePatch(sourceText, range, renderHideAction(input));
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
  return createLocLabelsPatches(document, [input]);
}

export function createLocLabelsPatches(
  document: RibbonDocument,
  inputs: NewLocLabelInput[],
): RibbonPatch[] {
  if (!inputs.length) {
    return [];
  }

  return createSectionChildPatches(document, [
    {
      sectionName: "LocLabels",
      childText: inputs.map((input) => renderLocLabel(input)).join("\n"),
    },
  ]);
}

export function createLocLabelTitlePatch(
  document: RibbonDocument,
  locLabelRange: TextRange,
  input: Pick<NewLocLabelInput, "languageCode" | "description">,
): RibbonPatch {
  const locLabel = findElementByRange(document.sourceText, locLabelRange);
  if (locLabel.name !== "LocLabel") {
    throw new Error("LocLabel range was not found in the current document text.");
  }

  const titles = locLabel.children.find((child) => child.name === "Titles");
  if (titles) {
    return createExistingSectionChildPatch(document.sourceText, titles, renderLocLabelTitle(input));
  }

  const locLabelIndent = indentationBefore(document.sourceText, locLabel.range.start);
  const titlesIndent = findChildIndent(document.sourceText, locLabel) ?? `${locLabelIndent}  `;
  const titlesText = `<Titles>\n${indentBlock(renderLocLabelTitle(input), "  ")}\n</Titles>`;

  if (locLabel.selfClosing) {
    return {
      kind: "replace",
      range: locLabel.range,
      text: `${openSelfClosingElement(document.sourceText, locLabel)}\n${indentBlock(titlesText, titlesIndent)}\n${locLabelIndent}</${locLabel.name}>`,
    };
  }

  return {
    kind: "insert",
    offset: locLabel.children.length ? locLabel.innerRange.end : locLabel.startTagRange.end,
    text: `\n${indentBlock(titlesText, titlesIndent)}\n${locLabelIndent}`,
  };
}

export function createRuleStepReplacePatch(
  sourceText: string,
  step: RuleStep,
  input: NewRuleStepInput,
): RibbonPatch {
  return createReplaceNodePatch(sourceText, step.range, renderRuleStep(input));
}

export function createRuleChildStepPatch(
  sourceText: string,
  parent: RuleStep,
  input: NewRuleStepInput,
): RibbonPatch {
  if (parent.kind !== "OrRule") {
    throw new Error("Rule child steps can only be added to OrRule.");
  }

  const parentElement = findElementByRange(sourceText, parent.range);
  if (parentElement.name !== "OrRule") {
    throw new Error("OrRule range was not found in the current document text.");
  }

  const parentIndent = indentationBefore(sourceText, parentElement.range.start);
  const childIndent = findChildIndent(sourceText, parentElement) ?? `${parentIndent}  `;
  const stepText = indentBlock(renderRuleStep(input), childIndent);

  if (parentElement.selfClosing) {
    const attributes = renderAttributes([
      ["Default", optionalBoolean(parent.default)],
      ["InvertResult", optionalBoolean(parent.invertResult)],
    ]);
    const name = attributes ? `OrRule ${attributes}` : "OrRule";
    return {
      kind: "replace",
      range: parentElement.range,
      text: `<${name}>\n${stepText}\n${parentIndent}</OrRule>`,
    };
  }

  return {
    kind: "insert",
    offset: parentElement.children.length
      ? parentElement.innerRange.end
      : parentElement.startTagRange.end,
    text: `\n${stepText}\n${parentIndent}`,
  };
}

export function createLocLabelTitleReplacePatch(
  sourceText: string,
  title: LocLabelTitle,
  input: Pick<NewLocLabelInput, "languageCode" | "description">,
): RibbonPatch {
  return createReplaceNodePatch(sourceText, title.range, renderLocLabelTitle(input));
}

export function createSwapNodePatches(
  sourceText: string,
  firstRange: TextRange,
  secondRange: TextRange,
): RibbonPatch[] {
  const first = expandToLineRange(sourceText, firstRange);
  const second = expandToLineRange(sourceText, secondRange);
  if (first.start === second.start && first.end === second.end) {
    return [];
  }

  const earlier = first.start < second.start ? first : second;
  const later = first.start < second.start ? second : first;
  if (earlier.end > later.start) {
    throw new Error("Ribbon nodes cannot be reordered because their XML ranges overlap.");
  }

  return [
    { kind: "replace", range: later, text: sourceText.slice(earlier.start, earlier.end) },
    { kind: "replace", range: earlier, text: sourceText.slice(later.start, later.end) },
  ];
}

export function createNodeAttributeValuePatch(
  sourceText: string,
  range: TextRange,
  attributeName: string,
  value: string,
): RibbonPatch {
  const node = findElementByRange(sourceText, range);
  const attribute = node.attributes.find(
    (item) => item.name.toLowerCase() === attributeName.toLowerCase(),
  );

  if (attribute) {
    return {
      kind: "replace",
      range: attribute.valueRange,
      text: escapeXmlAttribute(value),
    };
  }

  return {
    kind: "insert",
    offset: node.startTagRange.start + 1 + node.name.length,
    text: ` ${attributeName}="${escapeXmlAttribute(value)}"`,
  };
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
): Pick<
  NewCustomButtonInput,
  | "customActionId"
  | "buttonId"
  | "commandId"
  | "labelLocId"
  | "altLocId"
  | "toolTipTitleLocId"
  | "toolTipDescriptionLocId"
> {
  const owner = document.entityLogicalName ?? "application";
  const base = `d365tools.${sanitizeIdPart(owner)}.${sanitizeIdPart(scope)}.${sanitizeIdPart(label)}`;

  return {
    customActionId: nextRibbonId(document, `${base}.CustomAction`),
    buttonId: nextRibbonId(document, `${base}.Button`),
    commandId: nextRibbonId(document, `${base}.Command`),
    labelLocId: nextRibbonId(document, `${base}.Label`),
    altLocId: nextRibbonId(document, `${base}.Alt`),
    toolTipTitleLocId: nextRibbonId(document, `${base}.ToolTipTitle`),
    toolTipDescriptionLocId: nextRibbonId(document, `${base}.ToolTipDescription`),
  };
}

export function makeCustomControlIds(
  document: RibbonDocument,
  scope: string,
  label: string,
  controlKind: "Group" | "MenuSection" | "SplitButton" | "Flyout",
): Pick<NewCustomControlInput, "customActionId"> & { controlId: string } {
  const owner = document.entityLogicalName ?? "application";
  const base = `d365tools.${sanitizeIdPart(owner)}.${sanitizeIdPart(scope)}.${sanitizeIdPart(label)}`;

  return {
    customActionId: nextRibbonId(document, `${base}.CustomAction`),
    controlId: nextRibbonId(document, `${base}.${controlKind}`),
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

function createCommandChildPatch(
  document: RibbonDocument,
  command: CommandDefinition,
  containerName: "EnableRules" | "DisplayRules" | "Actions",
  childText: string,
): RibbonPatch {
  const commandElement = findCommandElement(document, command);
  const container = commandElement.children.find((child) => child.name === containerName);

  if (container) {
    return createExistingSectionChildPatch(document.sourceText, container, childText);
  }

  const commandIndent = indentationBefore(document.sourceText, commandElement.range.start);
  const containerIndent =
    findChildIndent(document.sourceText, commandElement) ?? `${commandIndent}  `;
  const containerText = `<${containerName}>\n${indentBlock(childText, "  ")}\n</${containerName}>`;

  if (commandElement.selfClosing) {
    return {
      kind: "replace",
      range: commandElement.range,
      text: `${openSelfClosingElement(document.sourceText, commandElement)}\n${indentBlock(containerText, containerIndent)}\n${commandIndent}</${commandElement.name}>`,
    };
  }

  const offset = findMissingCommandContainerOffset(commandElement, containerName);

  return {
    kind: "insert",
    offset,
    text: `\n${indentBlock(containerText, containerIndent)}${offset === commandElement.innerRange.end ? `\n${commandIndent}` : ""}`,
  };
}

function createRibbonControlChildPatch(
  sourceText: string,
  parentRange: TextRange,
  control: NewRibbonControlInput,
): RibbonPatch {
  const parent = findElementByRange(sourceText, parentRange);

  if (parent.name === "SplitButton" || parent.name === "FlyoutAnchor" || parent.name === "Flyout") {
    return createDropdownControlChildPatch(sourceText, parent, control);
  }

  if (parent.name === "Group" || parent.name === "MenuSection") {
    return createControlContainerChildPatch(sourceText, parent, control);
  }

  throw new Error(`${parent.name} cannot contain ribbon child controls.`);
}

function createDropdownControlChildPatch(
  sourceText: string,
  parent: XmlElementRange,
  control: NewRibbonControlInput,
): RibbonPatch {
  const menu = parent.children.find((child) => child.name === "Menu");
  if (control.kind === "MenuSection") {
    if (menu) {
      return createExistingSectionChildPatch(sourceText, menu, renderRibbonControl(control));
    }

    return createControlContainerPatch(sourceText, parent, "Menu", renderRibbonControl(control));
  }

  const existingMenuSection = menu?.children.find((child) => child.name === "MenuSection");
  if (existingMenuSection) {
    return createControlContainerChildPatch(sourceText, existingMenuSection, control);
  }

  const parentId = readElementAttribute(parent, "Id") ?? parent.name;
  const section: NewMenuSectionControlInput = {
    kind: "MenuSection",
    id: `${parentId}.MenuSection`,
    displayMode: "Menu16",
    sequence: 10,
    children: [control],
  };
  const childText = renderRibbonControl(section);

  if (menu) {
    return createExistingSectionChildPatch(sourceText, menu, childText);
  }

  return createControlContainerPatch(sourceText, parent, "Menu", childText);
}

function createControlContainerChildPatch(
  sourceText: string,
  parent: XmlElementRange,
  control: NewRibbonControlInput,
): RibbonPatch {
  const controls = parent.children.find((child) => child.name === "Controls");
  if (controls) {
    return createExistingSectionChildPatch(sourceText, controls, renderRibbonControl(control));
  }

  return createControlContainerPatch(sourceText, parent, "Controls", renderRibbonControl(control));
}

function createControlContainerPatch(
  sourceText: string,
  parent: XmlElementRange,
  containerName: "Controls" | "Menu",
  childText: string,
): RibbonPatch {
  const parentIndent = indentationBefore(sourceText, parent.range.start);
  const containerIndent = findChildIndent(sourceText, parent) ?? `${parentIndent}  `;
  const parentId = readElementAttribute(parent, "Id") ?? parent.name;
  const containerText = `<${containerName} Id="${escapeXmlAttribute(`${parentId}.${containerName}`)}">
${indentBlock(childText, "  ")}
</${containerName}>`;

  if (parent.selfClosing) {
    return {
      kind: "replace",
      range: parent.range,
      text: `${openSelfClosingElement(sourceText, parent)}\n${indentBlock(containerText, containerIndent)}\n${parentIndent}</${parent.name}>`,
    };
  }

  return {
    kind: "insert",
    offset: parent.children.length ? parent.innerRange.end : parent.startTagRange.end,
    text: `\n${indentBlock(containerText, containerIndent)}\n${parentIndent}`,
  };
}

function readElementAttribute(element: XmlElementRange, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function findCommandElement(document: RibbonDocument, command: CommandDefinition): XmlElementRange {
  const commandElement = findElementByRange(document.sourceText, command.range);

  if (commandElement.name !== "CommandDefinition") {
    throw new Error(
      `CommandDefinition '${command.id}' was not found in the current document text.`,
    );
  }

  return commandElement;
}

function findMissingCommandContainerOffset(
  command: XmlElementRange,
  containerName: "EnableRules" | "DisplayRules" | "Actions",
): number {
  const containerOrder = ["EnableRules", "DisplayRules", "Actions"];
  const targetIndex = containerOrder.indexOf(containerName);
  const nextContainer = command.children
    .filter((child) => containerOrder.includes(child.name))
    .filter((child) => containerOrder.indexOf(child.name) > targetIndex)
    .sort((a, b) => containerOrder.indexOf(a.name) - containerOrder.indexOf(b.name))[0];

  if (nextContainer) {
    return nextContainer.range.start;
  }

  return command.children.length ? command.innerRange.end : command.startTagRange.end;
}

function openSelfClosingElement(sourceText: string, element: XmlElementRange): string {
  return sourceText.slice(element.range.start, element.range.end).replace(/\s*\/\s*>$/, ">");
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
  const ribbon = findElementByRange(document.sourceText, document.ribbonRange);

  if (ribbon.name !== "RibbonDiffXml") {
    throw new Error("RibbonDiffXml range was not found in the current document text.");
  }

  return ribbon;
}

function findElementByRange(sourceText: string, range: TextRange): XmlElementRange {
  const roots = scanXmlElements(sourceText);
  const element = collectElements(roots).find(
    (node) => node.range.start === range.start && node.range.end === range.end,
  );

  if (!element) {
    throw new Error("XML node range was not found in the current document text.");
  }

  return element;
}

function collectElements(nodes: XmlElementRange[], name?: string): XmlElementRange[] {
  const matches: XmlElementRange[] = [];

  for (const node of nodes) {
    if (!name || node.name === name) {
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
  const labelText = input.labelText ?? locLabelReference(input.labelLocId);
  const alt = input.alt ?? locLabelReference(input.altLocId);
  const toolTipTitle = input.toolTipTitle ?? locLabelReference(input.toolTipTitleLocId);
  const toolTipDescription =
    input.toolTipDescription ?? locLabelReference(input.toolTipDescriptionLocId);
  const buttonAttributes: Array<[string, string | number | undefined]> = [
    ["Id", input.buttonId],
    ["Command", input.commandId],
    ["LabelText", labelText],
    ["Alt", alt],
    ["ToolTipTitle", toolTipTitle],
    ["ToolTipDescription", toolTipDescription],
    ["Image16by16", webResourceValue(input.image16x16)],
    ["Image32by32", webResourceValue(input.image32x32)],
    ["ModernImage", webResourceValue(input.modernImage)],
    ["Sequence", input.sequence],
    ["TemplateAlias", input.templateAlias],
  ];

  return `<CustomAction ${renderAttributes(attributes)}>
  <CommandUIDefinition>
    <Button ${renderAttributes(buttonAttributes)} />
  </CommandUIDefinition>
</CustomAction>`;
}

function renderCustomControlAction(input: NewCustomControlInput): string {
  const attributes: Array<[string, string | number | undefined]> = [
    ["Id", input.customActionId],
    ["Location", input.location],
    ["Sequence", input.sequence],
  ];

  return `<CustomAction ${renderAttributes(attributes)}>
  <CommandUIDefinition>
    ${indentBlock(renderRibbonControl(input.control), "    ").trimStart()}
  </CommandUIDefinition>
</CustomAction>`;
}

function renderRibbonControl(input: NewRibbonControlInput): string {
  switch (input.kind) {
    case "Button":
      return renderButtonControl(input);
    case "SplitButton":
      return renderDropdownControl("SplitButton", input);
    case "Flyout":
      return renderDropdownControl("FlyoutAnchor", input);
    case "Group":
      return renderControlsContainerControl("Group", input, [
        ["Id", input.id],
        ["Command", input.commandId],
        ["Title", input.title],
        ["Sequence", input.sequence],
      ]);
    case "MenuSection":
      return renderControlsContainerControl("MenuSection", input, [
        ["Id", input.id],
        ["DisplayMode", input.displayMode],
        ["Sequence", input.sequence],
      ]);
  }
}

function renderButtonControl(input: NewButtonControlInput): string {
  return `<Button ${renderAttributes([
    ["Id", input.id],
    ["Command", input.commandId],
    ...labeledControlAttributes(input),
  ])} />`;
}

function renderDropdownControl(
  nodeName: "SplitButton" | "FlyoutAnchor",
  input: NewSplitButtonControlInput | NewFlyoutControlInput,
): string {
  const attributes = renderAttributes([
    ["Id", input.id],
    ["Command", input.commandId],
    ...labeledControlAttributes(input),
  ]);
  const children = input.children ?? [];

  if (!children.length) {
    return `<${nodeName} ${attributes} />`;
  }

  const menuSections = normalizeMenuSections(children, `${input.id}.MenuSection`);
  const menu = `<Menu Id="${escapeXmlAttribute(`${input.id}.Menu`)}">
${indentBlock(menuSections.map(renderRibbonControl).join("\n"), "  ")}
</Menu>`;

  return `<${nodeName} ${attributes}>
${indentBlock(menu, "  ")}
</${nodeName}>`;
}

function renderControlsContainerControl(
  nodeName: "Group" | "MenuSection",
  input: NewGroupControlInput | NewMenuSectionControlInput,
  attributes: Array<[string, string | number | undefined]>,
): string {
  const renderedAttributes = renderAttributes(attributes);
  const children = input.children ?? [];

  if (!children.length) {
    return `<${nodeName} ${renderedAttributes} />`;
  }

  const controls = `<Controls Id="${escapeXmlAttribute(`${input.id}.Controls`)}">
${indentBlock(children.map(renderRibbonControl).join("\n"), "  ")}
</Controls>`;

  return `<${nodeName} ${renderedAttributes}>
${indentBlock(controls, "  ")}
</${nodeName}>`;
}

function normalizeMenuSections(
  children: NewRibbonControlInput[],
  defaultSectionId: string,
): NewMenuSectionControlInput[] {
  const sections: NewMenuSectionControlInput[] = [];
  let looseControls: NewRibbonControlInput[] = [];

  const flushLooseControls = () => {
    if (!looseControls.length) {
      return;
    }

    const suffix = sections.length ? `.${sections.length + 1}` : "";
    sections.push({
      kind: "MenuSection",
      id: `${defaultSectionId}${suffix}`,
      displayMode: "Menu16",
      sequence: nextMenuSectionSequence(sections),
      children: looseControls,
    });
    looseControls = [];
  };

  for (const child of children) {
    if (child.kind === "MenuSection") {
      flushLooseControls();
      sections.push(child);
      continue;
    }

    looseControls.push(child);
  }

  flushLooseControls();
  return sections;
}

function nextMenuSectionSequence(sections: NewMenuSectionControlInput[]): number {
  const lastSequence = sections
    .map((section) => section.sequence)
    .filter((sequence): sequence is number => sequence !== undefined)
    .sort((left, right) => right - left)[0];
  return lastSequence === undefined ? 10 : lastSequence + 10;
}

function labeledControlAttributes(
  input: NewLabeledControlInput & { sequence?: number },
): Array<[string, string | number | undefined]> {
  const labelText = input.labelText ?? locLabelReference(input.labelLocId);
  const alt = input.alt ?? locLabelReference(input.altLocId);
  const toolTipTitle = input.toolTipTitle ?? locLabelReference(input.toolTipTitleLocId);
  const toolTipDescription =
    input.toolTipDescription ?? locLabelReference(input.toolTipDescriptionLocId);

  return [
    ["LabelText", labelText],
    ["Alt", alt],
    ["ToolTipTitle", toolTipTitle],
    ["ToolTipDescription", toolTipDescription],
    ["Image16by16", webResourceValue(input.image16x16)],
    ["Image32by32", webResourceValue(input.image32x32)],
    ["ModernImage", webResourceValue(input.modernImage)],
    ["Sequence", input.sequence],
    ["TemplateAlias", input.templateAlias],
  ];
}

function renderCommandDefinition(input: NewCustomButtonInput): string {
  const actions = input.action ? `\n    ${renderCommandAction(input.action)}\n  ` : "";

  return `<CommandDefinition Id="${escapeXmlAttribute(input.commandId)}">
  <EnableRules>${renderRuleRefs("EnableRule", input.enableRuleIds ?? [])}</EnableRules>
  <DisplayRules>${renderRuleRefs("DisplayRule", input.displayRuleIds ?? [])}</DisplayRules>
  <Actions>${actions}</Actions>
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
  return ids.map((id) => renderRuleRef(name, id)).join("");
}

function renderRuleRef(name: "EnableRule" | "DisplayRule", id: string): string {
  return `<${name} Id="${escapeXmlAttribute(id)}" />`;
}

function renderCommandAction(action: NewCommandActionInput): string {
  if (action.kind === "JavaScriptFunction") {
    return renderJavaScriptNode(
      "JavaScriptFunction",
      [
        ["Library", webResourceValue(action.library)],
        ["FunctionName", action.functionName],
      ],
      action.parameters,
    );
  }

  return renderJavaScriptNode(
    "Url",
    [
      ["Address", action.address],
      ["PassParams", action.passParams === undefined ? undefined : String(action.passParams)],
      ["WinMode", action.winMode],
      ["WinParams", action.winParams],
    ],
    action.parameters,
  );
}

function renderLocLabel(input: NewLocLabelInput): string {
  return `<LocLabel Id="${escapeXmlAttribute(input.id)}">
  <Titles>
    ${renderLocLabelTitle(input)}
  </Titles>
</LocLabel>`;
}

function renderLocLabelTitle(
  input: Pick<NewLocLabelInput, "languageCode" | "description">,
): string {
  return `<Title languagecode="${input.languageCode}" description="${escapeXmlAttribute(input.description)}" />`;
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
      return renderJavaScriptNode(
        "CustomRule",
        [
          ["Library", webResourceValue(step.library)],
          ["FunctionName", step.functionName],
          ["Default", optionalBoolean(step.default)],
          ["InvertResult", optionalBoolean(step.invertResult)],
        ],
        step.parameters,
      );
    case "EntityPrivilegeRule":
      return `<EntityPrivilegeRule ${renderAttributes([
        ["EntityName", step.entityName],
        ["PrivilegeType", step.privilegeType],
        ["PrivilegeDepth", step.privilegeDepth],
        ["AppliesTo", step.appliesTo],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "ValueRule":
      return `<ValueRule ${renderAttributes([
        ["Field", step.field],
        ["Value", step.value],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "FormStateRule":
      return `<FormStateRule ${renderAttributes([
        ["State", step.state],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "CommandClientTypeRule":
      return `<CommandClientTypeRule ${renderAttributes([
        ["Type", step.type],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "FormTypeRule":
      return `<FormTypeRule ${renderAttributes([
        ["Type", step.type],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "EntityPropertyRule":
      return `<EntityPropertyRule ${renderAttributes([
        ["PropertyName", step.propertyName],
        ["PropertyValue", optionalBoolean(step.propertyValue)],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "MiscellaneousPrivilegeRule":
      return `<MiscellaneousPrivilegeRule ${renderAttributes([
        ["PrivilegeName", step.privilegeName],
        ["PrivilegeDepth", step.privilegeDepth],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "OrganizationSettingRule":
      return `<OrganizationSettingRule ${renderAttributes([
        ["Setting", step.setting],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "HideForTabletExperienceRule":
      return `<HideForTabletExperienceRule ${renderAttributes([
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "RelationshipTypeRule":
      return `<RelationshipTypeRule ${renderAttributes([
        ["Type", step.type],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "ReferencingAttributeRequiredRule":
      return `<ReferencingAttributeRequiredRule ${renderAttributes([
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "PageRule":
      return `<PageRule ${renderAttributes([
        ["Address", step.address],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "OrRule": {
      const attributes = renderAttributes([
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ]);
      const name = attributes ? `OrRule ${attributes}` : "OrRule";
      if (!step.children?.length) {
        return `<${name} />`;
      }

      return `<${name}>
${indentBlock(step.children.map(renderRuleStep).join("\n"), "  ")}
</OrRule>`;
    }
    case "SelectionCountRule":
      return `<SelectionCountRule ${renderAttributes([
        ["AppliesTo", step.appliesTo],
        ["Minimum", step.minimum],
        ["Maximum", step.maximum],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "RecordPrivilegeRule":
      return `<RecordPrivilegeRule ${renderAttributes([
        ["PrivilegeType", step.privilegeType],
        ["AppliesTo", step.appliesTo],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
    case "EntityRule":
      return `<EntityRule ${renderAttributes([
        ["EntityName", step.entityName],
        ["AppliesTo", step.appliesTo],
        ["Context", step.context],
        ["Default", optionalBoolean(step.default)],
        ["InvertResult", optionalBoolean(step.invertResult)],
      ])} />`;
  }
}

function renderJavaScriptNode(
  name: "JavaScriptFunction" | "CustomRule" | "Url",
  attributes: Array<[string, string | number | undefined]>,
  parameters: ActionParameter[] | undefined,
): string {
  const renderedAttributes = renderAttributes(attributes);
  if (!parameters?.length) {
    return `<${name} ${renderedAttributes} />`;
  }

  return `<${name} ${renderedAttributes}>
${indentBlock(parameters.map(renderActionParameter).join("\n"), "  ")}
</${name}>`;
}

function renderActionParameter(parameter: ActionParameter): string {
  const attributes = renderAttributes([
    ["Name", parameter.name],
    ["Value", parameter.value],
  ]);
  return `<${parameter.kind}Parameter ${attributes} />`;
}

function createReplaceNodePatch(sourceText: string, range: TextRange, text: string): RibbonPatch {
  return {
    kind: "replace",
    range,
    text: indentContinuationLines(text, indentationBefore(sourceText, range.start)),
  };
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

function indentContinuationLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function sectionOrder(edit: RibbonSectionChildEdit): number {
  return RIBBON_SECTION_ORDER.indexOf(edit.sectionName);
}

function sortPatchesForApply(patches: RibbonPatch[]): RibbonPatch[] {
  return [...patches].sort((a, b) => patchStart(b) - patchStart(a));
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
        for (const control of collectRibbonControls(customAction.commandUI)) {
          if (control.kind !== "Unknown") {
            used.add(ribbonControlId(control));
          }
        }
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

function locLabelReference(value: string | undefined): string | undefined {
  return value ? `$LocLabels:${value}` : undefined;
}

function newLocLabels(input: NewCustomButtonInput): NewLocLabelInput[] {
  return [input.locLabel, ...(input.locLabels ?? [])].filter((label): label is NewLocLabelInput =>
    Boolean(label),
  );
}

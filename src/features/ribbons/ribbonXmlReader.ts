import {
  ActionParameter,
  ButtonNode,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  GroupNode,
  HideAction,
  ImageRef,
  LocLabel,
  LocLabelTitle,
  MenuSectionNode,
  RibbonDocument,
  RibbonScope,
  RibbonSectionRanges,
  RibbonView,
  RuleStep,
  TabNode,
  TextRange,
  UnknownCommandUINode,
  WebResourceRef,
  XmlAttributeRange,
  XmlElementRange,
} from "./models";
import { findOobRibbonCommand } from "./oobCatalog";

export interface RibbonReadOptions {
  sourceId?: string;
  fileUri?: string;
  kind?: "Application" | "Entity";
  entityLogicalName?: string;
}

interface OpenElement {
  node: XmlElementRange;
  parent?: OpenElement;
}

interface LocatedRibbon {
  node: XmlElementRange;
  ancestors: XmlElementRange[];
}

const SECTION_NAMES = new Set([
  "CustomActions",
  "Templates",
  "CommandDefinitions",
  "RuleDefinitions",
  "LocLabels",
]);
const ENTITY_SCOPES: RibbonScope[] = ["Form", "HomepageGrid", "SubGrid"];

export function readRibbonDocuments(
  sourceText: string,
  options: RibbonReadOptions = {},
): RibbonDocument[] {
  const roots = scanXmlElements(sourceText);
  const ribbons = findRibbonElements(roots);
  const sourceId = options.sourceId ?? options.fileUri ?? "memory";

  return ribbons.map(({ node: ribbon, ancestors }, index) => {
    const sections = getRibbonSections(ribbon);
    const parentEntityName = findParentEntityName(sourceText, ancestors);
    const kind =
      options.kind ?? (parentEntityName ? "Entity" : ("Application" as "Application" | "Entity"));
    const allView = buildRibbonView(sourceText, ribbon, sections, "Application");

    return {
      id: `${sourceId}:ribbon:${index}`,
      sourceId,
      kind,
      entityLogicalName: options.entityLogicalName ?? parentEntityName,
      fileUri: options.fileUri ?? "",
      sourceText,
      ribbonRange: ribbon.range,
      sections,
      views:
        kind === "Application"
          ? [allView]
          : ENTITY_SCOPES.map((scope) =>
              filterEntityView(allView, scope, options.entityLogicalName ?? parentEntityName),
            ),
    };
  });
}

export function scanXmlElements(sourceText: string): XmlElementRange[] {
  const roots: XmlElementRange[] = [];
  const stack: OpenElement[] = [];
  let offset = 0;

  while (offset < sourceText.length) {
    const start = sourceText.indexOf("<", offset);
    if (start < 0) {
      break;
    }

    if (sourceText.startsWith("<!--", start)) {
      offset = readUntil(sourceText, start + 4, "-->");
      continue;
    }

    if (sourceText.startsWith("<![CDATA[", start)) {
      offset = readUntil(sourceText, start + 9, "]]>");
      continue;
    }

    if (sourceText.startsWith("<?", start)) {
      offset = readUntil(sourceText, start + 2, "?>");
      continue;
    }

    if (sourceText.startsWith("</", start)) {
      const end = readTagEnd(sourceText, start);
      const name = readClosingTagName(sourceText, start + 2, end);
      closeElement(stack, roots, name, { start, end });
      offset = end;
      continue;
    }

    if (sourceText.startsWith("<!", start)) {
      offset = readTagEnd(sourceText, start);
      continue;
    }

    const end = readTagEnd(sourceText, start);
    const tagText = sourceText.slice(start, end);
    const name = readOpeningTagName(tagText);
    if (!name) {
      offset = end;
      continue;
    }

    const selfClosing = isSelfClosingTag(tagText);
    const node: XmlElementRange = {
      name,
      range: { start, end },
      startTagRange: { start, end },
      endTagRange: undefined,
      innerRange: { start: end, end },
      attributes: readAttributes(sourceText, start, end, name),
      children: [],
      selfClosing,
    };

    if (selfClosing) {
      attachNode(stack, roots, node);
    } else {
      stack.push({ node, parent: stack[stack.length - 1] });
    }

    offset = end;
  }

  return roots;
}

function closeElement(
  stack: OpenElement[],
  roots: XmlElementRange[],
  closingName: string,
  endTagRange: TextRange,
): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (open.node.name !== closingName) {
      continue;
    }

    stack.splice(index);
    open.node.endTagRange = endTagRange;
    open.node.innerRange = { start: open.node.startTagRange.end, end: endTagRange.start };
    open.node.range = { start: open.node.startTagRange.start, end: endTagRange.end };
    attachCompletedNode(roots, open);
    return;
  }
}

function attachCompletedNode(roots: XmlElementRange[], open: OpenElement): void {
  if (open.parent) {
    open.parent.node.children.push(open.node);
  } else {
    roots.push(open.node);
  }
}

function attachNode(stack: OpenElement[], roots: XmlElementRange[], node: XmlElementRange): void {
  const parent = stack[stack.length - 1];
  if (parent) {
    parent.node.children.push(node);
  } else {
    roots.push(node);
  }
}

function readUntil(sourceText: string, offset: number, endMarker: string): number {
  const end = sourceText.indexOf(endMarker, offset);
  return end < 0 ? sourceText.length : end + endMarker.length;
}

function readTagEnd(sourceText: string, start: number): number {
  let quote: string | undefined;

  for (let index = start + 1; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === `"` || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return index + 1;
    }
  }

  return sourceText.length;
}

function readOpeningTagName(tagText: string): string | undefined {
  const match = /^<\s*([A-Za-z_][\w:.-]*)/.exec(tagText);
  return match?.[1];
}

function readClosingTagName(sourceText: string, start: number, end: number): string {
  const text = sourceText.slice(start, end);
  const match = /^\s*([A-Za-z_][\w:.-]*)/.exec(text);
  return match?.[1] ?? "";
}

function isSelfClosingTag(tagText: string): boolean {
  let index = tagText.length - 2;
  while (index >= 0 && /\s/.test(tagText[index])) {
    index -= 1;
  }
  return tagText[index] === "/";
}

function readAttributes(
  sourceText: string,
  tagStart: number,
  tagEnd: number,
  elementName: string,
): XmlAttributeRange[] {
  const attributes: XmlAttributeRange[] = [];
  let offset = tagStart + 1 + elementName.length;

  while (offset < tagEnd - 1) {
    while (offset < tagEnd && /\s/.test(sourceText[offset])) {
      offset += 1;
    }

    if (offset >= tagEnd - 1 || sourceText[offset] === "/" || sourceText[offset] === ">") {
      break;
    }

    const nameStart = offset;
    while (offset < tagEnd && /[^\s=/>]/.test(sourceText[offset])) {
      offset += 1;
    }
    const name = sourceText.slice(nameStart, offset);

    while (offset < tagEnd && /\s/.test(sourceText[offset])) {
      offset += 1;
    }

    if (sourceText[offset] !== "=") {
      attributes.push({
        name,
        value: "",
        range: { start: nameStart, end: offset },
        valueRange: { start: offset, end: offset },
      });
      continue;
    }

    offset += 1;
    while (offset < tagEnd && /\s/.test(sourceText[offset])) {
      offset += 1;
    }

    const quote = sourceText[offset];
    if (quote !== `"` && quote !== "'") {
      const valueStart = offset;
      while (offset < tagEnd && /[^\s/>]/.test(sourceText[offset])) {
        offset += 1;
      }
      attributes.push({
        name,
        value: decodeXml(sourceText.slice(valueStart, offset)),
        range: { start: nameStart, end: offset },
        valueRange: { start: valueStart, end: offset },
      });
      continue;
    }

    const valueStart = offset + 1;
    offset = sourceText.indexOf(quote, valueStart);
    if (offset < 0 || offset > tagEnd) {
      offset = tagEnd - 1;
    }
    const valueEnd = offset;
    offset += 1;
    attributes.push({
      name,
      value: decodeXml(sourceText.slice(valueStart, valueEnd)),
      range: { start: nameStart, end: offset },
      valueRange: { start: valueStart, end: valueEnd },
    });
  }

  return attributes;
}

function findRibbonElements(nodes: XmlElementRange[]): LocatedRibbon[] {
  const matches: LocatedRibbon[] = [];
  collectRibbonElements(nodes, [], matches);
  return matches;
}

function collectRibbonElements(
  nodes: XmlElementRange[],
  ancestors: XmlElementRange[],
  matches: LocatedRibbon[],
): void {
  for (const node of nodes) {
    if (node.name === "RibbonDiffXml") {
      matches.push({ node, ancestors });
    }

    collectRibbonElements(node.children, [...ancestors, node], matches);
  }
}

function findParentEntityName(
  sourceText: string,
  ancestors: XmlElementRange[],
): string | undefined {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor.name !== "Entity") {
      continue;
    }

    const name = getDirectChild(ancestor, "Name");
    if (!name) {
      return undefined;
    }

    return decodeXml(sourceText.slice(name.innerRange.start, name.innerRange.end).trim());
  }

  return undefined;
}

function getRibbonSections(ribbon: XmlElementRange): RibbonSectionRanges {
  const sections: RibbonSectionRanges = {};

  for (const child of ribbon.children) {
    switch (child.name) {
      case "CustomActions":
        sections.customActions = child.range;
        break;
      case "Templates":
        sections.templates = child.range;
        break;
      case "CommandDefinitions":
        sections.commandDefinitions = child.range;
        break;
      case "RuleDefinitions":
        sections.ruleDefinitions = child.range;
        break;
      case "LocLabels":
        sections.locLabels = child.range;
        break;
    }
  }

  return sections;
}

function buildRibbonView(
  sourceText: string,
  ribbon: XmlElementRange,
  sections: RibbonSectionRanges,
  scope: RibbonScope,
): RibbonView {
  const customActionsSection = getDirectChild(ribbon, "CustomActions");
  const commandDefinitionsSection = getDirectChild(ribbon, "CommandDefinitions");
  const ruleDefinitionsSection = getDirectChild(ribbon, "RuleDefinitions");
  const locLabelsSection = getDirectChild(ribbon, "LocLabels");

  return {
    scope,
    customActions: customActionsSection ? readCustomActions(sourceText, customActionsSection) : [],
    hideActions: customActionsSection ? readHideActions(customActionsSection) : [],
    commandDefinitions: commandDefinitionsSection
      ? readCommandDefinitions(sourceText, commandDefinitionsSection)
      : [],
    enableRules: ruleDefinitionsSection
      ? readRules(sourceText, ruleDefinitionsSection, "Enable")
      : [],
    displayRules: ruleDefinitionsSection
      ? readRules(sourceText, ruleDefinitionsSection, "Display")
      : [],
    locLabels: locLabelsSection ? readLocLabels(locLabelsSection) : [],
    templatesRange: sections.templates,
    unknownNodeRanges: ribbon.children
      .filter((child) => !SECTION_NAMES.has(child.name))
      .map((child) => child.range),
  };
}

function filterEntityView(
  view: RibbonView,
  scope: RibbonScope,
  entityLogicalName: string | undefined,
): RibbonView {
  const customActions = view.customActions.filter((action) => customActionInScope(action, scope));
  const hideActions = view.hideActions.filter((action) =>
    belongsToScope([action.hideActionId, action.location], scope),
  );
  const commandIds = new Set(
    customActions
      .map((action) => (action.commandUI?.kind === "Button" ? action.commandUI.command : undefined))
      .filter(isDefined),
  );
  const commandDefinitions = view.commandDefinitions.filter(
    (command) =>
      commandIds.has(command.id) || commandDefinitionInScope(command.id, scope, entityLogicalName),
  );
  const enableRuleIds = new Set(commandDefinitions.flatMap((command) => command.enableRuleRefs));
  const displayRuleIds = new Set(commandDefinitions.flatMap((command) => command.displayRuleRefs));
  const enableRules = view.enableRules.filter(
    (rule) => enableRuleIds.has(rule.id) || belongsToScope([rule.id], scope),
  );
  const displayRules = view.displayRules.filter(
    (rule) => displayRuleIds.has(rule.id) || belongsToScope([rule.id], scope),
  );
  const locLabelIds = new Set(
    customActions.flatMap((action) =>
      action.commandUI?.kind === "Button"
        ? [
            action.commandUI.labelLocId,
            action.commandUI.toolTipTitleLocId,
            action.commandUI.toolTipDescriptionLocId,
          ].filter(isDefined)
        : [],
    ),
  );
  const locLabels = view.locLabels.filter(
    (label) => locLabelIds.has(label.id) || belongsToScope([label.id], scope),
  );

  return {
    ...view,
    scope,
    customActions,
    hideActions,
    commandDefinitions,
    enableRules,
    displayRules,
    locLabels,
  };
}

function commandDefinitionInScope(
  commandId: string,
  scope: RibbonScope,
  entityLogicalName: string | undefined,
): boolean {
  const oobCommand = findOobRibbonCommand(commandId, entityLogicalName);
  return oobCommand ? oobCommand.scopes.includes(scope) : belongsToScope([commandId], scope);
}

function customActionInScope(action: CustomAction, scope: RibbonScope): boolean {
  return belongsToScope(
    [
      action.id,
      action.location,
      action.commandUI?.kind === "Unknown" ? action.commandUI.name : action.commandUI?.id,
      action.commandUI?.kind === "Button" ? action.commandUI.command : undefined,
    ],
    scope,
  );
}

function belongsToScope(values: Array<string | undefined>, scope: RibbonScope): boolean {
  return textInScope(values, scope) || !hasAnyScope(values);
}

function textInScope(values: Array<string | undefined>, scope: RibbonScope): boolean {
  const needle = scope.toLowerCase();
  return values.some((value) => {
    if (!value) {
      return false;
    }

    return value.split(/[^A-Za-z0-9]+/).some((part) => part.toLowerCase() === needle);
  });
}

function hasAnyScope(values: Array<string | undefined>): boolean {
  const scopes = new Set(ENTITY_SCOPES.map((scope) => scope.toLowerCase()));
  return values.some((value) => {
    if (!value) {
      return false;
    }

    return value.split(/[^A-Za-z0-9]+/).some((part) => scopes.has(part.toLowerCase()));
  });
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readCustomActions(sourceText: string, section: XmlElementRange): CustomAction[] {
  return section.children
    .filter((child) => child.name === "CustomAction")
    .map((node) => ({
      id: attr(node, "Id"),
      location: attr(node, "Location"),
      sequence: numberAttr(node, "Sequence"),
      commandUI: readCommandUINode(sourceText, node),
      range: node.range,
    }));
}

function readHideActions(section: XmlElementRange): HideAction[] {
  return section.children
    .filter((child) => child.name === "HideCustomAction")
    .map((node) => ({
      hideActionId: attr(node, "HideActionId"),
      location: attr(node, "Location"),
      range: node.range,
    }));
}

function readCommandUINode(
  sourceText: string,
  customAction: XmlElementRange,
): ButtonNode | GroupNode | TabNode | MenuSectionNode | UnknownCommandUINode | undefined {
  const definition = getDirectChild(customAction, "CommandUIDefinition");
  const node = definition?.children[0];
  if (!node) {
    return undefined;
  }

  switch (node.name) {
    case "Button":
      return {
        kind: "Button",
        id: attr(node, "Id"),
        command: attr(node, "Command"),
        labelLocId: optionalAttr(node, "LabelLocId"),
        labelText: optionalAttr(node, "LabelText"),
        toolTipTitleLocId: optionalAttr(node, "ToolTipTitleLocId"),
        toolTipDescriptionLocId: optionalAttr(node, "ToolTipDescriptionLocId"),
        image16x16: readImageRef(node, "Image16by16"),
        image32x32: readImageRef(node, "Image32by32"),
        templateAlias: optionalAttr(node, "TemplateAlias"),
        sequence: numberAttr(node, "Sequence"),
        range: node.range,
      };
    case "Group":
      return {
        kind: "Group",
        id: attr(node, "Id"),
        command: optionalAttr(node, "Command"),
        title: optionalAttr(node, "Title"),
        sequence: numberAttr(node, "Sequence"),
        range: node.range,
      };
    case "Tab":
      return {
        kind: "Tab",
        id: attr(node, "Id"),
        command: optionalAttr(node, "Command"),
        title: optionalAttr(node, "Title"),
        sequence: numberAttr(node, "Sequence"),
        range: node.range,
      };
    case "MenuSection":
      return {
        kind: "MenuSection",
        id: attr(node, "Id"),
        sequence: numberAttr(node, "Sequence"),
        range: node.range,
      };
    default:
      return {
        kind: "Unknown",
        name: node.name,
        raw: sourceText.slice(node.range.start, node.range.end),
        range: node.range,
      };
  }
}

function readCommandDefinitions(sourceText: string, section: XmlElementRange): CommandDefinition[] {
  return section.children
    .filter((child) => child.name === "CommandDefinition")
    .map((node) => ({
      id: attr(node, "Id"),
      enableRuleRefs: readRuleRefs(node, "EnableRules", "EnableRule"),
      displayRuleRefs: readRuleRefs(node, "DisplayRules", "DisplayRule"),
      actions: readActions(sourceText, node),
      range: node.range,
    }));
}

function readRuleRefs(
  commandDefinition: XmlElementRange,
  containerName: string,
  refName: string,
): string[] {
  return (
    getDirectChild(commandDefinition, containerName)
      ?.children.filter((child) => child.name === refName)
      .map((child) => attr(child, "Id")) ?? []
  );
}

function readActions(sourceText: string, commandDefinition: XmlElementRange): CommandAction[] {
  const actions = getDirectChild(commandDefinition, "Actions");
  if (!actions) {
    return [];
  }

  return actions.children.map((node) => {
    if (node.name === "JavaScriptFunction") {
      return {
        kind: "JavaScriptFunction",
        library: webResourceRef(attr(node, "Library")),
        functionName: attr(node, "FunctionName"),
        parameters: readActionParameters(node),
        range: node.range,
      };
    }

    if (node.name === "Url") {
      return {
        kind: "Url",
        address: attr(node, "Address"),
        range: node.range,
      };
    }

    return {
      kind: "Unknown",
      raw: sourceText.slice(node.range.start, node.range.end),
      range: node.range,
    };
  });
}

function readActionParameters(node: XmlElementRange): ActionParameter[] {
  return node.children
    .filter((child) => child.name.endsWith("Parameter"))
    .map((child) => ({
      kind: parameterKind(child.name),
      value: attr(child, "Value"),
    }));
}

function readRules(
  sourceText: string,
  ruleDefinitions: XmlElementRange,
  kind: "Enable" | "Display",
): EnableRule[] | DisplayRule[] {
  const containerName = `${kind}Rules`;
  const ruleName = `${kind}Rule`;
  const container = getDirectChild(ruleDefinitions, containerName);

  return (
    container?.children
      .filter((child) => child.name === ruleName)
      .map((node) => ({
        id: attr(node, "Id"),
        steps: node.children.map((child) => readRuleStep(sourceText, child)),
        range: node.range,
      })) ?? []
  );
}

function readRuleStep(sourceText: string, node: XmlElementRange): RuleStep {
  switch (node.name) {
    case "CustomRule":
      return {
        kind: "CustomRule",
        library: webResourceRef(attr(node, "Library")),
        functionName: attr(node, "FunctionName"),
        default: booleanAttr(node, "Default"),
        invertResult: booleanAttr(node, "InvertResult"),
        parameters: readActionParameters(node),
        range: node.range,
      };
    case "EntityPrivilegeRule":
      return {
        kind: "EntityPrivilegeRule",
        entityName: optionalAttr(node, "EntityName"),
        privilegeType: optionalAttr(node, "PrivilegeType"),
        privilegeDepth: optionalAttr(node, "PrivilegeDepth"),
        invertResult: booleanAttr(node, "InvertResult"),
        range: node.range,
      };
    case "ValueRule":
      return {
        kind: "ValueRule",
        field: optionalAttr(node, "Field"),
        value: optionalAttr(node, "Value"),
        invertResult: booleanAttr(node, "InvertResult"),
        range: node.range,
      };
    case "FormStateRule":
      return {
        kind: "FormStateRule",
        state: optionalAttr(node, "State"),
        invertResult: booleanAttr(node, "InvertResult"),
        range: node.range,
      };
    case "CommandClientTypeRule":
      return {
        kind: "CommandClientTypeRule",
        type: optionalAttr(node, "Type") as "Modern" | "Refresh" | undefined,
        range: node.range,
      };
    default:
      return {
        kind: "Unknown",
        raw: sourceText.slice(node.range.start, node.range.end),
        range: node.range,
      };
  }
}

function readLocLabels(section: XmlElementRange): LocLabel[] {
  return section.children
    .filter((child) => child.name === "LocLabel")
    .map((node) => ({
      id: attr(node, "Id"),
      titles: readLocLabelTitles(node),
      range: node.range,
    }));
}

function readLocLabelTitles(locLabel: XmlElementRange): LocLabelTitle[] {
  return (
    getDirectChild(locLabel, "Titles")
      ?.children.filter((child) => child.name === "Title")
      .map((title) => ({
        languageCode: numberAttr(title, "languagecode") ?? 0,
        description: attr(title, "description"),
        range: title.range,
      })) ?? []
  );
}

function getDirectChild(node: XmlElementRange, name: string): XmlElementRange | undefined {
  return node.children.find((child) => child.name === name);
}

function attr(node: XmlElementRange, name: string): string {
  return optionalAttr(node, name) ?? "";
}

function optionalAttr(node: XmlElementRange, name: string): string | undefined {
  return node.attributes.find((attribute) => attribute.name === name)?.value;
}

function numberAttr(node: XmlElementRange, name: string): number | undefined {
  const value = optionalAttr(node, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanAttr(node: XmlElementRange, name: string): boolean | undefined {
  const value = optionalAttr(node, name);
  if (!value) {
    return undefined;
  }

  return value.toLowerCase() === "true";
}

function readImageRef(node: XmlElementRange, name: string): ImageRef | undefined {
  const value = optionalAttr(node, name);
  if (!value) {
    return undefined;
  }

  return {
    webResourceUniqueName: value.replace(/^\$webresource:/i, ""),
  };
}

function webResourceRef(value: string): WebResourceRef {
  return {
    uniqueName: value.replace(/^\$webresource:/i, ""),
  };
}

function parameterKind(name: string): ActionParameter["kind"] {
  const kind = name.replace(/Parameter$/, "");
  if (
    kind === "Crm" ||
    kind === "Bool" ||
    kind === "Int" ||
    kind === "Float" ||
    kind === "Decimal"
  ) {
    return kind;
  }

  return "String";
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, `"`)
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

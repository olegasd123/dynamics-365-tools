import {
  NewCommandActionInput,
  NewCustomButtonInput,
  makeCustomButtonIds,
} from "./ribbonEditPatches";
import { RibbonDocument, RibbonScope } from "./models";

export interface SmartButtonInput {
  label: string;
  location: string;
  action: NewCommandActionInput;
  sequence?: number;
}

export function buildSmartButtonInput(
  document: RibbonDocument,
  scope: RibbonScope,
  input: SmartButtonInput,
): NewCustomButtonInput {
  const ids = makeCustomButtonIds(document, scope, input.label);
  const labelLocId = ids.labelLocId ?? `${ids.buttonId}.Label`;
  const toolTipTitleLocId = ids.toolTipTitleLocId ?? `${ids.buttonId}.ToolTipTitle`;
  const toolTipDescriptionLocId =
    ids.toolTipDescriptionLocId ?? `${ids.buttonId}.ToolTipDescription`;

  return {
    ...ids,
    location: input.location,
    action: input.action,
    sequence: input.sequence,
    labelLocId,
    toolTipTitleLocId,
    toolTipDescriptionLocId,
    templateAlias: "o1",
    locLabels: [
      newLocLabel(labelLocId, input.label),
      newLocLabel(toolTipTitleLocId, input.label),
      newLocLabel(toolTipDescriptionLocId, `${input.label} action`),
    ],
  };
}

function newLocLabel(id: string, description: string) {
  return {
    id,
    languageCode: 1033,
    description: description.trim(),
  };
}

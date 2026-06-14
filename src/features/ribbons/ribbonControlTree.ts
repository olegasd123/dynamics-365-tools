import { ButtonNode, RibbonCommandUINode } from "./models";

export function ribbonControlId(control: RibbonCommandUINode): string {
  return control.kind === "Unknown" ? control.name : control.id;
}

export function ribbonControlChildren(control: RibbonCommandUINode): RibbonCommandUINode[] {
  return control.kind !== "Unknown" && "children" in control ? (control.children ?? []) : [];
}

export function collectRibbonControls(control: RibbonCommandUINode): RibbonCommandUINode[] {
  return [control, ...ribbonControlChildren(control).flatMap(collectRibbonControls)];
}

export function collectRibbonButtons(control: RibbonCommandUINode): ButtonNode[] {
  return collectRibbonControls(control).filter(
    (item): item is ButtonNode => item.kind === "Button",
  );
}

export function ribbonControlCommand(control: RibbonCommandUINode): string | undefined {
  return control.kind !== "Unknown" && "command" in control ? control.command : undefined;
}

export function collectRibbonCommandIds(control: RibbonCommandUINode): string[] {
  return collectRibbonControls(control)
    .map(ribbonControlCommand)
    .filter((command): command is string => Boolean(command));
}

export function collectRibbonLocLabelIds(control: RibbonCommandUINode): string[] {
  return collectRibbonControls(control)
    .flatMap((item) => {
      if (item.kind !== "Button" && item.kind !== "SplitButton" && item.kind !== "Flyout") {
        return [];
      }

      return [item.labelLocId, item.altLocId, item.toolTipTitleLocId, item.toolTipDescriptionLocId];
    })
    .filter((id): id is string => Boolean(id));
}

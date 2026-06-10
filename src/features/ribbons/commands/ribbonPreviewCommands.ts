import { CommandContext } from "@app/commandContext";
import { RibbonExplorerNode } from "../ribbonExplorer";

export async function previewRibbon(ctx: CommandContext, node?: RibbonExplorerNode): Promise<void> {
  if (node && ctx.ribbon.previewPanel.show(node)) {
    return;
  }

  await ctx.core.notifications.warning("Select a ribbon view or document to preview.");
}

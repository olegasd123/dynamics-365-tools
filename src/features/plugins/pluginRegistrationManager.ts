import { PluginType } from "./models";
import { DiscoveredPluginType, PluginAssemblyIntrospector } from "./pluginAssemblyIntrospector";
import { PluginService, PluginTypeUpdateInput } from "./pluginService";

export interface PluginSyncOptions {
  pluginService: PluginService;
  assemblyId: string;
  assemblyPath: string;
  solutionName?: string;
  allowCreate?: boolean;
}

export interface PluginSyncResult {
  created: PluginType[];
  updated: PluginType[];
  removed: PluginType[];
  skippedCreation: DiscoveredPluginType[];
}

export class PluginRegistrationManager {
  constructor(private readonly introspector: PluginAssemblyIntrospector) {}

  async syncPluginTypes(options: PluginSyncOptions): Promise<PluginSyncResult> {
    const discovered = await this.introspector.discover(options.assemblyPath);
    const existing = await options.pluginService.listPluginTypes(options.assemblyId);

    const existingByType = new Map(
      existing
        .filter((type) => type.typeName)
        .map((type) => [this.normalizeKey(type.typeName!), type]),
    );

    const created: PluginType[] = [];
    const updated: PluginType[] = [];
    const removed: PluginType[] = [];
    const skippedCreation: DiscoveredPluginType[] = [];

    for (const plugin of discovered) {
      const key = this.normalizeKey(plugin.typeName);
      if (!key) {
        continue;
      }

      const targetName = this.resolveTargetName(plugin);
      const match = existingByType.get(key);
      if (!match) {
        if (options.allowCreate === false) {
          skippedCreation.push(plugin);
          continue;
        }

        const friendlyName = this.resolveFriendlyName(plugin);
        const id = await options.pluginService.createPluginType(options.assemblyId, {
          name: targetName,
          friendlyName,
          typeName: plugin.typeName,
          solutionName: options.solutionName,
        });

        created.push({
          id,
          name: targetName,
          friendlyName,
          typeName: plugin.typeName,
        });
        continue;
      }

      const changes: PluginTypeUpdateInput = {};
      if (match.name !== targetName) changes.name = targetName;
      if (match.typeName !== plugin.typeName) changes.typeName = plugin.typeName;

      if (Object.keys(changes).length || options.solutionName) {
        await options.pluginService.updatePluginType(match.id, {
          ...changes,
          solutionName: options.solutionName,
        });
        updated.push({
          ...match,
          ...changes,
          typeName: plugin.typeName,
          name: targetName,
          friendlyName: match.friendlyName ?? this.resolveFriendlyName(plugin),
        });
      }

      existingByType.delete(key);
    }

    for (const orphan of existingByType.values()) {
      try {
        await options.pluginService.deletePluginTypeCascade(orphan.id);
      } catch (error) {
        throw new Error(
          `Failed to delete plugin ${orphan.name ?? orphan.typeName}: ${String(error)}`,
        );
      }
      removed.push(orphan);
    }

    return { created, updated, removed, skippedCreation };
  }

  private resolveTargetName(plugin: DiscoveredPluginType): string {
    return plugin.name ?? plugin.typeName;
  }

  private resolveFriendlyName(plugin: DiscoveredPluginType): string {
    const typeName = plugin.typeName?.trim();
    if (!typeName) {
      return this.resolveTargetName(plugin);
    }

    const lastSeparator = Math.max(typeName.lastIndexOf("."), typeName.lastIndexOf("+"));
    const className = lastSeparator >= 0 ? typeName.slice(lastSeparator + 1) : typeName;
    return className || typeName;
  }

  private normalizeKey(value?: string): string | undefined {
    return value?.trim().toLowerCase();
  }
}

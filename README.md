## Dynamics 365 Tools VS Code Extension

Publish Dynamics 365 web resources straight from VS Code. Bind local files or folders to CRM web resources, then push updates to one or many environments without leaving the editor.

### Why use it

- Publish from Explorer with a couple of clicks, no DevOps pipeline needed.
- Reuse the same bindings across the team via `.vscode/dynamics365tools.bindings.json`.
- Speed up folder publishes with caching, parallel uploads, and cancellation support.
- Keep credentials safe (Secret Storage) while still supporting client secrets.
- See quick status bar shortcuts to republish the last resource or plugin assembly in seconds.

### Main features

- **Multi-environment config** stored in `.vscode/dynamics365tools.config.json` (dev/test/prod, etc.), with optional custom resource/audience and opt-in user agent header.
- **Solution-aware bindings** for files or folders saved in `.vscode/dynamics365tools.bindings.json`; file bindings override folder bindings when both exist.
- **Explorer context menu** `Dynamics 365 Tools` → `Publish Resource` / `Bind Resource`; bound folders publish all supported files inside.
- **Open in Power Apps** directly from the Explorer `Dynamics 365 Tools` menu to jump to the Web Resources list for the bound solution.
- **Publish last resource** from the status bar (file code icon) or via `Dynamics 365 Tools: Publish Last Resource`; remembers the last environment used.
- **Folder publish extras**: up to 4 files publish in parallel, unchanged files are skipped using `.vscode/dynamics365tools.publishCache.json`, and you can cancel from the progress notification.
- **Auth options**: interactive sign-in (default) or client credentials stored securely; per-environment `authType` control.
- **Output channel logging** with clear summaries and a “copy error details” action when something fails.
- **Plugin explorer & assemblies**: browse plugin assemblies, plugin types, steps, and images in VS Code. Register new assemblies or update existing ones directly from the explorer; plugins inside the assembly are auto-discovered and synced.
  - Quick publish plugin assemblies from the status bar (package icon) or via `Dynamics 365 Tools: Publish Last Plugin Assembly`; reuses the last environment and assembly you uploaded.

### Install

- Install the extension from the VS Code Marketplace (search for “Dynamics 365 Tools”) or load the packaged `.vsix`.

### Configure environments and solutions

Edit `.vscode/dynamics365tools.config.json` (or run `Dynamics 365 Tools: Edit Environments & Solutions`). Example:

```jsonc
{
  "environments": [
    {
      "name": "dev",
      "url": "https://your-dev.crm.dynamics.com",
      "authType": "interactive",
      "createMissingComponents": true,
    },
    {
      "name": "prod",
      "url": "https://your-prod.crm.dynamics.com",
      "authType": "clientSecret",
      "resource": "https://your-prod.crm.dynamics.com",
      "createMissingComponents": false,
      "userAgentEnabled": true,
      "userAgent": "Dynamics365Tools-VSCode",
    },
  ],
  "solutions": [
    { "name": "CoreWebResources", "prefix": "publisherPrefix_" },
    { "name": "ComponentWebResources", "prefix": "publisherPrefix_" },
  ],
}
```

Config parameters:

- `environments` (required): list of Dataverse environments you can publish to.
  - `name` (required): short label shown in VS Code pickers (for example `dev`, `test`, `prod`).
  - `url` (required): org base URL (for example `https://contoso.crm.dynamics.com`).
  - `authType` (optional): `interactive` or `clientSecret`. If missing, interactive sign-in is used first.
  - `resource` (optional): custom token audience/scope base. Use this only when your auth setup needs a different audience than `url`.
  - `createMissingComponents` (optional, default `false`): when `true`, publish can create missing web resources and plugin components. When `false`, only existing components are updated.
  - `userAgentEnabled` (optional, default `false`): enables `User-Agent` header on Dataverse and token HTTP calls.
  - `userAgent` (optional): custom `User-Agent` value. If empty and `userAgentEnabled` is `true`, the extension uses `Dynamics365Tools-VSCode/<version>`.
- `solutions` (required): list of Dataverse solutions used during bind/publish/plugin actions.
  - `name` (required): solution unique name in Dataverse (for example `CoreWebResources`).
  - `prefix` (required): web resource prefix for path defaults (for example `new_`, `cmp_`).
  - `solutionName` (legacy optional alias): old key still accepted and mapped to `name`.

Notes:

- Keep `authType: "interactive"` for local developer work. Use `authType: "clientSecret"` for CI or service accounts.
- If `authType` is not `clientSecret`, the extension still can use stored client credentials as a fallback when interactive sign-in is unavailable.
- `createMissingComponents: false` is safer for production: no new web resources or plugin assemblies are created by mistake, while still allowing them to be updated.
- Turn on `userAgentEnabled` only if your proxy, gateway, or audit policy needs a custom client header.

### Authenticate

- **Interactive (default)**: run `Dynamics 365 Tools: Sign In (Interactive)` or publish; tokens are requested with the `/.default` scope for the environment URL (or `resource`).
- **Client credentials**: run `Dynamics 365 Tools: Set Environment Credentials` to store `clientId`, `clientSecret`, and optional `tenantId` in Secret Storage. Set the environment `authType` to `clientSecret` to force this path.
- **Sign out**: run `Dynamics 365 Tools: Sign Out` to clear the interactive session for an environment; you can also choose to remove any stored client credentials for it.

### Bind resources

- From Explorer: right-click a file or folder → `Dynamics 365 Tools` → `Bind Resource`.
- From Command Palette: `Dynamics 365 Tools: Bind Resource` (uses the active file/folder).
- The default remote path uses the publisher prefix from the selected solution when it matches the local path; you can overwrite it.
- For folder bindings, the extension asks for an environment and compares supported local files with CRM web resources under the target `remotePath`. If counts differ, you get a short warning before the binding is saved.
- Bindings are saved to `.vscode/dynamics365tools.bindings.json` for team sharing. Example:

```jsonc
{
  "bindings": [
    {
      "relativeLocalPath": "src/webresources/publisherPrefix_",
      "remotePath": "publisherPrefix_",
      "solutionName": "CoreWebResources",
      "kind": "folder",
    },
    {
      "relativeLocalPath": "src/webresources/publisherPrefix_/contact/form.js",
      "remotePath": "publisherPrefix_/contact/form.js",
      "solutionName": "CoreWebResources",
      "kind": "file",
    },
  ],
}
```

File bindings win over folder bindings when both cover the same file.

### Publish resources

- In Explorer, right-click any bound file/folder → `Dynamics 365 Tools` → `Publish Resource` (or run `Dynamics 365 Tools: Publish Resource` from the Command Palette). Pick an environment when asked.
- For bound folders, supported files inside are published (file bindings are used when present). Up to 4 files publish at once. The progress dialog can be cancelled.
- Unchanged files in a folder publish are skipped using `.vscode/dynamics365tools.publishCache.json` (based on content hash, size, and mtime).
- Quick publish: click the status bar item (cloud upload) or run `Dynamics 365 Tools: Publish Last Resource` to republish the most recent file or folder with the same environment and binding.
- Open a published web resource in classic CRM: right-click the bound file → `Dynamics 365 Tools` → `Open in Power Apps`, choose the environment, and the extension opens the classic web resource editor URL for that solution and resource.

### Resources supported file types

Supported: `.js`, `.css`, `.htm`, `.html`, `.xml`, `.json`, `.resx`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.xsl`, `.xslt`, `.ico`, `.svg`. The Explorer `Dynamics 365 Tools` menu is visible on those types or folder.

### Manage plugins

- Open the **Dynamics 365 Plugins** view in the Explorer to browse assemblies → plugin types → steps → images for any configured environment.
- Use the view title actions (refresh/register) or the Command Palette commands:
  - `Dynamics 365 Tools: Generate Strong Name Key (Public Key Token)` creates a `.snk` using the local `sn` tool and shows the public key token for signing your assemblies.
  - `Dynamics 365 Tools: Register Plugin Assembly` uploads a `.dll` to the selected environment and adds it to your chosen solution.
  - `Dynamics 365 Tools: Update Plugin Assembly` replaces the content of an existing assembly with a new `.dll`.
  - Plugin classes are auto-discovered via `System.Reflection.MetadataLoadContext` when you register or update an assembly. New plugin types are created (respecting `createMissingComponents`), existing ones are updated, and types removed from the assembly are deleted in Dataverse.
  - Use the trash icon next to a plugin type in the Plugins explorer to remove it (steps and images are deleted with the type).
- Step and image commands (context menu or palette):
  - Create/edit/enable/disable/delete plugin steps; creation prompts for message, entity, stage, mode, rank, attributes, and solution. Deleting a step now also deletes all of its images first.
  - Create/edit/delete plugin images for a step; defaults include sensible aliases and message property names.
  - Copy plugin step/image info straight from the Plugins explorer inline actions to get the formatted details on your clipboard.
- Toggle “Show Configured Solutions Only” in the Plugins view title to filter plugin assemblies/types by the solutions listed in your config (skipping the default solution automatically).

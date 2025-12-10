## XRM VS Code Extension

Publish Dynamics 365 (XRM) web resources straight from VS Code. Bind local files or folders to CRM web resources, then push updates to one or many environments without leaving the editor.

### Why use it
- Publish from Explorer with a couple of clicks, no DevOps pipeline needed.
- Reuse the same bindings across the team via `.vscode/xrm.bindings.json`.
- Speed up folder publishes with caching, parallel uploads, and cancellation support.
- Keep credentials safe (Secret Storage) while still supporting client secrets.
- See a quick status bar shortcut to republish the last resource in seconds.

### Main features
- **Multi-environment config** stored in `.vscode/xrm.config.json` (dev/test/prod, etc.), with optional custom resource/audience and opt-in user agent header.
- **Solution-aware bindings** for files or folders saved in `.vscode/xrm.bindings.json`; file bindings override folder bindings when both exist.
- **Explorer context menu** `XRM` → `Publish Resource` / `Bind Resource`; bound folders publish all supported files inside.
- **Publish last resource** from the status bar (cloud icon) or via `XRM: Publish Last Resource`; remembers the last environment used.
- **Folder publish extras**: up to 4 files publish in parallel, unchanged files are skipped using `.vscode/xrm.publishCache.json`, and you can cancel from the progress notification.
- **Auth options**: interactive sign-in (default) or client credentials stored securely; per-environment `authType` control.
- **Default solution helper**: set a global default solution to prefill bindings and remote paths.
- **Output channel logging** with clear summaries and a “copy error details” action when something fails.

### Install
- Install the extension from the VS Code Marketplace (search for “XRM Web Resource Publisher”) or load the packaged `.vsix`.

### Configure environments and solutions
Edit `.vscode/xrm.config.json` (or run `XRM: Edit Environments & Solutions`). Example:

```jsonc
{
  "environments": [
    {
      "name": "dev",
      "url": "https://your-dev.crm.dynamics.com",
      "authType": "interactive",
      "createMissingWebResources": true,
      "userAgentEnabled": true
    },
    {
      "name": "prod",
      "url": "https://your-prod.crm.dynamics.com",
      "authType": "clientSecret",
      "resource": "https://your-prod.crm.dynamics.com",
      "createMissingWebResources": false,
      "userAgent": "XRM-VSCode/prod"
    }
  ],
  "solutions": [
    { "name": "CoreWebResources", "prefix": "new_", "default": true },
    { "name": "ComponentWebResources", "prefix": "cmp_" }
  ],
  "defaultSolution": "CoreWebResources",
  "webResourceSupportedExtensions": [
    ".js",
    ".css",
    ".htm",
    ".html",
    ".xml",
    ".json",
    ".resx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".xap",
    ".xsl",
    ".xslt",
    ".ico",
    ".svg"
  ]
}
```

Notes:
- `defaultSolution` is the solution unique name; it is also used to prefill remote paths with the publisher prefix.
- Set `resource` if the token audience is not the org URL. Turn on `userAgentEnabled` or set `userAgent` to add a custom header to every HTTP call.
- `createMissingWebResources: false` blocks creation; publish will only update existing items for that environment.

### Authenticate
- **Interactive (default)**: run `XRM: Sign In (Interactive)` or publish; tokens are requested with the `/.default` scope for the environment URL (or `resource`).
- **Client credentials**: run `XRM: Set Environment Credentials` to store `clientId`, `clientSecret`, and optional `tenantId` in Secret Storage. Set the environment `authType` to `clientSecret` to force this path.
- The extension remembers the last picked environment so you do not have to choose it every time.

### Bind resources
- From Explorer: right-click a file or folder → `XRM` → `Bind Resource`.
- From Command Palette: `XRM: Bind Resource` (uses the active file/folder).
- The default remote path uses the publisher prefix from the default solution when it matches the local path; you can overwrite it.
- Bindings are saved to `.vscode/xrm.bindings.json` for team sharing. Example:

```jsonc
{
  "bindings": [
    {
      "relativeLocalPath": "src/webresources/new_",
      "remotePath": "new_",
      "solutionName": "CoreWebResources",
      "kind": "folder"
    },
    {
      "relativeLocalPath": "src/webresources/new_/contact/form.js",
      "remotePath": "new_/contact/form.js",
      "solutionName": "CoreWebResources",
      "kind": "file"
    }
  ]
}
```

File bindings win over folder bindings when both cover the same file.

### Publish resources
- In Explorer, right-click any bound file/folder → `XRM` → `Publish Resource` (or run `XRM: Publish Resource` from the Command Palette). Pick an environment when asked.
- For bound folders, supported files inside are published (file bindings are used when present). Up to 4 files publish at once. The progress dialog can be cancelled.
- Unchanged files in a folder publish are skipped using `.vscode/xrm.publishCache.json` (based on content hash, size, and mtime).
- Quick publish: click the status bar item (cloud upload) or run `XRM: Publish Last Resource` to republish the most recent file or folder with the same environment and binding.
- `XRM: Set Default Solution` updates the global default solution and helps prefill new bindings.

### Supported file types
By default: `.js`, `.css`, `.htm`, `.html`, `.xml`, `.json`, `.resx`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.xap`, `.xsl`, `.xslt`, `.ico`, `.svg`. Adjust the list with `webResourceSupportedExtensions` in `xrm.config.json` to change what appears in the `XRM` menu and what folder publishes include.

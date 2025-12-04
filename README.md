## XRM VS Code Extension

Publish Dynamics 365 (XRM) web resources directly from VS Code. Bind folders or files to CRM web resources, then update and publish them to multiple environments from the Explorer.

### Features
- Multi-environment configuration (dev/test/prod) stored in `.vscode/xrm.config.json`.
- Bind files or folders to CRM web resources; bindings saved in `.vscode/xrm.bindings.json` for team sharing.
- Explorer context menu item **XRM** that adds new resources or publishes existing bindings to a selected environment.
- Global default-solution selection; defaults applied when building remote paths.
- Extensible service-based architecture ready for future CRM publish operations (e.g., assemblies).

### Getting Started
1) Install dependencies: `npm install` (not run here).  
2) Build once: `npm run compile` (outputs to `out/`).  
3) Press `F5` in VS Code to launch the extension host.

### Configure environments and solutions
Edit `.vscode/xrm.config.json` (or run `XRM: Edit Environments & Solutions`) and fill in:
```jsonc
{
  "environments": [
    { "name": "dev", "url": "https://your-dev.crm.dynamics.com" },
    { "name": "prod", "url": "https://your-prod.crm.dynamics.com" }
  ],
  "solutions": [
    {
      "solutionName": "CoreWebResources",
      "prefix": "new_",
      "displayName": "Default Solution",
      "default": true
    },
    {
      "solutionName": "ComponentWebResources",
      "prefix": "cmp_",
      "displayName": "Component Solution"
    }
  ],
  "defaultSolution": "CoreWebResources"
}
```
Publisher prefixes are used when generating remote paths. `defaultSolution` refers to the solution unique name (not the prefix) so it stays unique even when multiple solutions share a publisher.

### Store credentials securely
- Run `XRM: Set Environment Credentials` to save `clientId`, `clientSecret`, and optional `tenantId` for a specific environment into VS Code Secret Storage.  
- Credentials are **not** written to `.vscode/xrm.config.json`; only non-sensitive settings live there.
During publish, the extension will pull credentials from Secret Storage if present.

### Bind and publish resources
- In the Explorer, right-click any file or folder → **XRM** → **XRM: Resource Actions**.  
  - If unbound, you'll be prompted for the CRM path and solution.  
  - If already bound, you'll pick an environment and the extension will publish (stubbed).
- Run `XRM: Bind Resource` from the Command Palette to bind the active file/folder.
- Run `XRM: Set Default Solution` to update the global default solution.

Bindings are stored in `.vscode/xrm.bindings.json`:
```jsonc
{
  "bindings": [
    { "localPath": "/abs/path/new_/account/form.js", "remotePath": "new_/account/form.js", "solution": "new_", "kind": "file" },
    { "localPath": "/abs/path/new_/account", "remotePath": "new_/account", "solution": "new_", "kind": "folder" }
  ]
}
```

### Notes and next steps
- Publish logic is stubbed with an output channel; hook CRM SDK calls in `src/services/publisherService.ts`.
- Context menu entries rely on a single **XRM** action that branches based on binding existence for now.
- The service-layer separation (`configurationService`, `bindingService`, `publisherService`) is intended for scaling to assemblies or other asset types later.

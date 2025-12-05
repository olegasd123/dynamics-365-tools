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
      "name": "CoreWebResources",
      "prefix": "new_",
      "displayName": "Default Solution",
      "default": true
    },
    {
      "name": "ComponentWebResources",
      "prefix": "cmp_",
      "displayName": "Component Solution"
    }
  ],
  "defaultSolution": "CoreWebResources"
}
```
Publisher prefixes are used when generating remote paths. `defaultSolution` refers to the solution unique name (not the prefix) so it stays unique even when multiple solutions share a publisher. Optionally add `resource` per environment to override the token audience (defaults to `url` + `/.default`).
To force client-credential auth for an environment, set `"authType": "clientSecret"` in that environment entry.

### Authenticate (interactive by default)
- Run `XRM: Sign In (Interactive)` (or publish to an environment) to sign in using VS Code's Microsoft authentication provider. Tokens are scoped to the environment URL/resource (`https://{org}.crm.dynamics.com/.default` by default).
- If you must use client credentials, run `XRM: Set Environment Credentials` to store `clientId`, `clientSecret`, and optional `tenantId` in Secret Storage (never in `xrm.config.json`).
During publish, the extension prefers interactive tokens; it falls back to stored client credentials when no token is available or when `authType` is set to `clientSecret` for an environment.

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
    { "localPath": "/abs/path/new_/account/form.js", "remotePath": "new_/account/form.js", "solutionName": "CoreWebResources", "kind": "file" },
    { "localPath": "/abs/path/new_/account", "remotePath": "new_/account", "solutionName": "CoreWebResources", "kind": "folder" }
  ]
}
```

### Notes and next steps
- Publish logic is stubbed with an output channel; hook CRM SDK calls in `src/services/publisherService.ts`.
- Context menu entries rely on a single **XRM** action that branches based on binding existence for now.
- The service-layer separation (`configurationService`, `bindingService`, `publisherService`) is intended for scaling to assemblies or other asset types later.

## XRM VS Code Extension

Publish Dynamics 365 (XRM) web resources directly from VS Code. Bind folders or files to CRM web resources, then update and publish them to multiple environments from the Explorer.

### Features
- Multi-environment configuration (dev/test/prod) stored in `.vscode/xrm.config.json`.
- Bind files or folders to CRM web resources; bindings saved in `.vscode/xrm.bindings.json` for team sharing.
- Explorer context menu item **XRM** with separate **Publish Resource** and **Bind Resource** actions; selecting a bound folder publishes all supported files within it.
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
    { "name": "dev", "url": "https://your-dev.crm.dynamics.com", "authType": "interactive", "createMissingWebResources": true },
    { "name": "prod", "url": "https://your-prod.crm.dynamics.com", "authType": "interactive", "createMissingWebResources": false }
  ],
  "solutions": [
    {
      "name": "CoreWebResources",
      "prefix": "new_",
      "default": true
    },
    {
      "name": "ComponentWebResources",
      "prefix": "cmp_"
    }
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
Publisher prefixes are used when generating remote paths. `defaultSolution` refers to the solution unique name (not the prefix) so it stays unique even when multiple solutions share a publisher. Optionally add `resource` per environment to override the token audience (defaults to `url` + `/.default`).
To opt into tagging requests with a user agent, set `"userAgentEnabled": true` on an environment. You can also provide `"userAgent": "XRM-VSCode/{version}"` (custom string) if you want to override the default `XRM-VSCode/{extensionVersion}` header for server-side logging.
`webResourceSupportedExtensions` controls which file types appear in the XRM menu and are included when publishing a bound folder. `createMissingWebResources` (defaults to `false`) controls whether publishing is allowed to create web resources that don't already exist in the environment/solution. To force client-credential auth for an environment, set `"authType": "clientSecret"` in that environment entry.

### Authenticate (interactive by default)
- Run `XRM: Sign In (Interactive)` (or publish to an environment) to sign in using VS Code's Microsoft authentication provider. Tokens are scoped to the environment URL/resource (`https://{org}.crm.dynamics.com/.default` by default).
- If you must use client credentials, run `XRM: Set Environment Credentials` to store `clientId`, `clientSecret`, and optional `tenantId` in Secret Storage (never in `xrm.config.json`).
During publish, the extension prefers interactive tokens; it falls back to stored client credentials when no token is available or when `authType` is set to `clientSecret` for an environment.

### Bind and publish resources
- In the Explorer, right-click any file or folder → **XRM** → pick **Publish Resource** (prompts for environment; asks to bind first if needed). For bound folders, all supported files under the selected folder are published. Use **Bind Resource** to create new bindings.
- Run `XRM: Bind Resource` from the Command Palette to bind the active file/folder.
- Run `XRM: Set Default Solution` to update the global default solution.

**Binding priority:** When publishing a folder, file-specific bindings take precedence over folder bindings. This lets you override the remote path for individual files while keeping the folder binding for everything else.

Bindings are stored in `.vscode/xrm.bindings.json`:
```jsonc
{
  "bindings": [
    { "relativeLocalPath": "src/webresources/hjk_", "remotePath": "hjk_", "solutionName": "HjkCore", "kind": "folder" },
    { "relativeLocalPath": "src/webresources/hjk_/contact/form.js", "remotePath": "hjk_/contact/form.js", "solutionName": "HjkCore", "kind": "file" }
  ]
}
```
In this example, publishing the `hjk_` folder will:
- Publish `hjk_/contact/form.js` as `hjk_/contact/form.js` (file binding wins)
- Publish all other files using their relative paths under `hjk_/` (folder binding)

### Notes and next steps
- Publish uses the Dataverse Web API to create/update the web resource, add it to the selected solution, and call `PublishXml` for that resource.
- Context menu entries rely on a single **XRM** action that branches based on binding existence for now.
- The service-layer separation (`configurationService`, `bindingService`, `publisherService`) is intended for scaling to assemblies or other asset types later.

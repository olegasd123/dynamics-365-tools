import * as path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import { CommandContext } from "../../../app/commandContext";
import type { ClipboardPort } from "../../../app/ports/clipboard";
import type { WorkspaceFilesPort } from "../../../app/ports/files";
import type { NotificationPort } from "../../../app/ports/notifications";

const execFileAsync = promisify(execFile);

export async function generatePublicKeyToken(ctx: CommandContext): Promise<void> {
  const { configuration, notifications, files, fileDialogs, clipboard, input } = ctx.core;
  const workspaceRoot = configuration.workspaceRoot ?? files.workspaceRoot;

  const projectPick = await fileDialogs.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultPath: workspaceRoot,
    filters: { "C# Project": ["csproj"], "All Files": ["*"] },
    openLabel: "Select .csproj to strong-name",
  });
  const csprojPath = projectPick?.[0];
  if (!csprojPath) {
    return;
  }

  const projectDir = path.dirname(csprojPath);

  const filename = await input.showInputBox({
    prompt: "Enter file name for the strong name key (.snk)",
    value: "plugin.snk",
    ignoreFocusOut: true,
  });
  if (!filename) {
    return;
  }

  const resolvedPath = path.join(projectDir, filename);
  const relativeKeyPath = path.relative(projectDir, resolvedPath).replace(/\\/g, "/");

  const snTool = await resolveSnTool();
  if (!snTool) {
    void notifications.error(
      "Strong Name tool (sn.exe/sn) not found. Install the .NET SDK and ensure the `sn` tool is on your PATH.",
    );
    return;
  }

  try {
    await files.createDirectory(path.dirname(resolvedPath));
    await execFileAsync(snTool.command, [...snTool.generateArgs, resolvedPath]);
    const token = await generatePublicKeyTokenValue(snTool, resolvedPath);
    await ensureCsprojStrongName(files, csprojPath, relativeKeyPath);

    const message = token
      ? `Strong name key created and project updated. Public key token: ${token}`
      : "Strong name key created and project updated. Failed to read public key token from sn output.";
    showPublicKeyTokenResult(notifications, clipboard, message, token);
  } catch (error) {
    void notifications.error(
      `Failed to generate strong name key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function showPublicKeyTokenResult(
  notifications: NotificationPort,
  clipboard: ClipboardPort,
  message: string,
  token?: string,
): void {
  const copyAction = token ? "Copy token" : undefined;
  void notifications.askInfo(message, [copyAction ?? "OK"]).then(
    async (selection) => {
      if (selection === copyAction && token) {
        try {
          await clipboard.writeText(token);
        } catch (error) {
          void notifications.error(
            `Failed to copy public key token: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    () => undefined,
  );
}

export function extractToken(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  const match =
    output.match(/Public key token is\s+([0-9a-fA-F]+)/i) ||
    output.match(/Public key token=(\w+)/i) ||
    output.match(/Public key token:\s*([0-9a-fA-F]+)/i);
  return match?.[1];
}

async function generatePublicKeyTokenValue(
  snTool: SnTool,
  keyPath: string,
): Promise<string | undefined> {
  const publicKeyPath = path.join(
    path.dirname(keyPath),
    `.tmp-${path.basename(keyPath)}.public.snk`,
  );

  try {
    await execFileAsync(snTool.command, [...snTool.publicArgs, keyPath, publicKeyPath]);
    const tokenOutput = await execFileAsync(snTool.command, [...snTool.tokenArgs, publicKeyPath]);
    return extractToken(tokenOutput.stdout) || extractToken(tokenOutput.stderr);
  } catch (error) {
    const stderr = (error as any)?.stderr || (error as any)?.message;
    throw new Error(`sn failed to produce public key token: ${stderr ?? error}`);
  } finally {
    try {
      await fs.unlink(publicKeyPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function ensureCsprojStrongName(
  files: WorkspaceFilesPort,
  csprojPath: string,
  keyFileRelative: string,
): Promise<void> {
  const content = Buffer.from(await files.readFile(csprojPath)).toString("utf8");
  if (content.includes("<AssemblyOriginatorKeyFile")) {
    return;
  }

  const insertion = [
    "  <PropertyGroup>",
    "    <SignAssembly>true</SignAssembly>",
    `    <AssemblyOriginatorKeyFile>${keyFileRelative}</AssemblyOriginatorKeyFile>`,
    "  </PropertyGroup>",
    "  <ItemGroup>",
    `    <None Include="${keyFileRelative}" />`,
    "  </ItemGroup>",
  ].join("\n");

  const closingTag = "</Project>";
  const index = content.lastIndexOf(closingTag);
  const updated =
    index >= 0
      ? `${content.slice(0, index)}${insertion}\n${closingTag}\n`
      : `${content.trimEnd()}\n${insertion}\n${closingTag}\n`;

  await files.writeFile(csprojPath, Buffer.from(updated, "utf8"));
}

type SnTool = {
  command: string;
  generateArgs: string[];
  publicArgs: string[];
  tokenArgs: string[];
};

async function resolveSnTool(): Promise<SnTool | undefined> {
  const candidates: SnTool[] = [
    { command: "sn", generateArgs: ["-k"], publicArgs: ["-p"], tokenArgs: ["-t"] },
    { command: "sn.exe", generateArgs: ["-k"], publicArgs: ["-p"], tokenArgs: ["-t"] },
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.command, ["-?"]);
      return candidate;
    } catch {
      // Continue to next candidate
    }
  }

  return undefined;
}

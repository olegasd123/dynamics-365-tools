import * as vscode from "vscode";
import { EnvironmentConfig, SolutionConfig } from "../types";

export class UiService {
  async pickEnvironment(
    environments: EnvironmentConfig[],
    defaultEnvName?: string,
    options?: { placeHolder?: string },
  ): Promise<EnvironmentConfig | undefined> {
    if (!environments.length) {
      vscode.window.showErrorMessage(
        "No environments configured. Run 'Dynamics 365 Tools: Edit Environments & Solutions' first.",
      );
      return undefined;
    }

    const defaultEnv = defaultEnvName
      ? environments.find((env) => env.name === defaultEnvName)
      : undefined;

    const pick = await vscode.window.showQuickPick(
      environments.map((env) => ({
        label: env.name,
        description: env.url,
        picked: defaultEnv ? env.name === defaultEnv.name : false,
        env,
      })),
      { placeHolder: options?.placeHolder ?? "Select environment for publish" },
    );

    return pick?.env;
  }

  async promptRemotePath(defaultValue?: string): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: "Enter CRM web resource path (e.g. new_/account/form.js)",
      value: defaultValue,
      ignoreFocusOut: true,
    });
  }

  async promptSolution(solutions: SolutionConfig[]): Promise<SolutionConfig | undefined> {
    if (!solutions.length) {
      const entered = await vscode.window.showInputBox({
        prompt: "Enter solution unique name",
        ignoreFocusOut: true,
      });
      if (!entered) {
        return undefined;
      }
      return { name: entered, prefix: "" };
    }

    const pick = await vscode.window.showQuickPick(
      solutions.map((solution) => ({
        label: solution.prefix || solution.name,
        description: solution.name,
        solution,
      })),
      { placeHolder: "Select solution for this resource (prefix shown)" },
    );

    return pick?.solution;
  }
}

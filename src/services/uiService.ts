import * as vscode from "vscode";
import { EnvironmentConfig, SolutionConfig } from "../types";

export class UiService {
  async pickEnvironment(
    environments: EnvironmentConfig[],
  ): Promise<EnvironmentConfig | undefined> {
    if (!environments.length) {
      vscode.window.showErrorMessage(
        "No environments configured. Run 'XRM: Edit Environments & Solutions' first.",
      );
      return undefined;
    }

    const pick = await vscode.window.showQuickPick(
      environments.map((env) => ({
        label: env.name,
        description: env.url,
        env,
      })),
      { placeHolder: "Select environment for publish" },
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

  async promptSolution(
    solutions: SolutionConfig[],
    defaultSolutionName?: string,
  ): Promise<SolutionConfig | undefined> {
    if (!solutions.length) {
      const entered = await vscode.window.showInputBox({
        prompt: "Enter solution unique name",
        value: defaultSolutionName,
        ignoreFocusOut: true,
      });
      if (!entered) {
        return undefined;
      }
      return { solutionName: entered, prefix: "", displayName: entered };
    }

    const pick = await vscode.window.showQuickPick(
      solutions.map((solution) => ({
        label: solution.prefix || solution.solutionName,
        description: solution.solutionName,
        detail: solution.displayName,
        picked: solution.solutionName === defaultSolutionName,
        solution,
      })),
      { placeHolder: "Select solution for this resource (prefix shown)" },
    );

    return pick?.solution;
  }
}

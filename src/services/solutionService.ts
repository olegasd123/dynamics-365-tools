import * as vscode from "vscode";
import { DEFAULT_SOLUTION_NAME, EnvironmentConfig, SolutionConfig } from "../types";

type SolutionQuickPickItem = vscode.QuickPickItem & {
  solution?: SolutionConfig;
  manualEntry?: true;
};

export class SolutionService {
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

  async promptSolution(
    solutions: SolutionConfig[],
    options?: { includeDefaultSolution?: boolean },
  ): Promise<SolutionConfig | undefined> {
    const includeDefaultSolution = options?.includeDefaultSolution ?? true;
    const items: SolutionQuickPickItem[] = solutions.map((solution) => ({
      label: solution.name,
      description: solution.prefix || "<no prefix>",
      detail: "Solution from configuration",
      solution,
    }));

    if (includeDefaultSolution) {
      items.push({
        label: "Default solution",
        description: DEFAULT_SOLUTION_NAME,
        detail: "Built-in solution that contains all components",
        solution: { name: DEFAULT_SOLUTION_NAME, prefix: "new_" },
      });
    }

    if (!items.length) {
      return this.promptForSolutionName();
    }

    items.push({
      label: "Other solution…",
      description: "Enter a different solution unique name",
      manualEntry: true,
    });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select solution for this resource (prefix shown)",
    });
    if (!pick) {
      return undefined;
    }

    if (pick.manualEntry) {
      return this.promptForSolutionName();
    }

    return pick.solution;
  }

  private async promptForSolutionName(): Promise<SolutionConfig | undefined> {
    const entered = await vscode.window.showInputBox({
      prompt: "Enter solution unique name",
      ignoreFocusOut: true,
    });
    if (!entered) {
      return undefined;
    }
    return { name: entered, prefix: "" };
  }
}

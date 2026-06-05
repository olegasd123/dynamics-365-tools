import { PluginAssembly } from "../models";
import { AssemblyIdentity } from "../pluginAssemblyIntrospector";

export class AssemblyIdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyIdentityValidationError";
  }
}

export function validateAssemblyIdentity(
  targetAssembly: PluginAssembly,
  localAssembly: AssemblyIdentity,
): void {
  if (normalizeAssemblyName(targetAssembly.name) !== normalizeAssemblyName(localAssembly.name)) {
    throw new AssemblyIdentityValidationError(
      `Selected CRM assembly is "${targetAssembly.name}", but the DLL is "${localAssembly.name}". Select the matching DLL for this assembly.`,
    );
  }

  const targetToken = normalizePublicKeyToken(targetAssembly.publicKeyToken);
  const localToken = normalizePublicKeyToken(localAssembly.publicKeyToken);
  if (targetToken && targetToken !== localToken) {
    throw new AssemblyIdentityValidationError(
      `Selected CRM assembly "${targetAssembly.name}" has public key token "${targetToken}", but the DLL has "${localToken ?? "none"}". Select the matching signed DLL.`,
    );
  }

  const targetCulture = normalizeCulture(targetAssembly.culture);
  const localCulture = normalizeCulture(localAssembly.culture);
  if (targetCulture !== localCulture) {
    throw new AssemblyIdentityValidationError(
      `Selected CRM assembly "${targetAssembly.name}" uses culture "${targetCulture ?? "neutral"}", but the DLL uses "${localCulture ?? "neutral"}". Select the matching DLL.`,
    );
  }
}

function normalizeAssemblyName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePublicKeyToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "none" && normalized !== "null" ? normalized : undefined;
}

function normalizeCulture(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "neutral" && normalized !== "none" && normalized !== "null"
    ? normalized
    : undefined;
}

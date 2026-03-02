export function buildDefaultEnvironmentUrl(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    return "https://org.crm.dynamics.com";
  }

  return `https://${normalized}.crm.dynamics.com`;
}

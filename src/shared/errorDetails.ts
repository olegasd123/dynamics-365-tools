export function formatErrorDetails(error: unknown): string {
  const base = getErrorMessage(error);
  const code = readString(error, "code");
  const correlationId = readString(error, "correlationId");
  const status = readNumber(error, "status");
  const rawBody = readString(error, "rawBody");
  const requestMethod = readString(error, "requestMethod");
  const requestPath = readString(error, "requestPath");
  const requestUrl = readString(error, "requestUrl");
  const causeName = readString(error, "causeName");
  const causeMessage = readString(error, "causeMessage");
  const causeCode = readString(error, "causeCode");
  const causeChain = readString(error, "causeChain");
  const causeStack = readString(error, "causeStack");
  const stack = error instanceof Error ? error.stack : undefined;
  const request = requestMethod
    ? `${requestMethod}${requestPath ? ` ${requestPath}` : ""}`
    : requestPath;
  const causeLabel = [causeName, causeMessage].filter(Boolean).join(": ");

  const sections = [
    `Message: ${base}`,
    code ? `Code: ${code}` : undefined,
    status !== undefined ? `Status: ${status}` : undefined,
    correlationId ? `CorrelationId: ${correlationId}` : undefined,
    request ? `Request: ${request}` : undefined,
    requestUrl ? `Url: ${requestUrl}` : undefined,
    causeCode ? `CauseCode: ${causeCode}` : undefined,
    causeLabel ? `Cause: ${causeLabel}` : undefined,
    causeChain ? `CauseChain: ${causeChain}` : undefined,
    causeStack ? `CauseStack: ${causeStack}` : undefined,
    stack && stack !== base ? `Stack: ${stack}` : undefined,
    rawBody ? `Response: ${rawBody}` : undefined,
  ].filter(Boolean);

  return sections.join("\n");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readString(value: unknown, key: string): string | undefined {
  const property = readProperty(value, key);
  return typeof property === "string" && property.trim() ? property : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  const property = readProperty(value, key);
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

import { XMLParser } from "fast-xml-parser";
import { PcfControlType } from "./models";

export interface PcfManifest {
  namespace: string;
  constructor: string;
  version: string;
  controlType: PcfControlType;
  displayName?: string;
  description?: string;
}

export class PcfManifestReader {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
  });

  read(content: string): PcfManifest {
    const parsed = this.parser.parse(content) as unknown;
    const control = findControlNode(parsed);
    if (!control) {
      throw new Error("ControlManifest.Input.xml has no control node.");
    }

    const namespace = requiredString(getAttribute(control, "namespace"), "namespace");
    const constructor = requiredString(getAttribute(control, "constructor"), "constructor");
    const version = requiredString(getAttribute(control, "version"), "version");

    return {
      namespace,
      constructor,
      version,
      controlType: detectControlType(control),
      displayName: optionalString(getAttribute(control, "display-name-key", "displayNameKey")),
      description: optionalString(getAttribute(control, "description-key", "descriptionKey")),
    };
  }
}

function findControlNode(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const manifest = value.manifest;
  if (isRecord(manifest) && isRecord(manifest.control)) {
    return manifest.control;
  }

  if (isRecord(value.control)) {
    return value.control;
  }

  return undefined;
}

function detectControlType(control: Record<string, unknown>): PcfControlType {
  if (getAttribute(control, "control-type", "controlType") === "virtual") {
    return "virtual";
  }

  if (control.dataset || control["data-set"]) {
    return "dataset";
  }

  return "field";
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`Control manifest is missing ${field}.`);
  }
  return text;
}

function getAttribute(control: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = control[`@_${name}`] ?? control[name];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { createHash } from "node:crypto";

const TRUNCATION_MARKER = "… [truncated]";

export type BoundedText = {
  text: string;
  truncated: boolean;
};

export function boundUtf8(input: string, maxBytes: number): BoundedText {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) {
    return { text: input, truncated: false };
  }

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const contentLimit = Math.max(0, maxBytes - markerBytes);
  let output = "";
  let bytes = 0;

  for (const character of input) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > contentLimit) {
      break;
    }
    output += character;
    bytes += nextBytes;
  }

  return { text: `${output}${TRUNCATION_MARKER}`, truncated: true };
}

export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function valueToText(value: unknown, extractionLimit: number): string {
  let text: string;

  if (typeof value === "string") {
    text = value;
  } else if (Array.isArray(value)) {
    text = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isObject(item) && typeof item.text === "string") return item.text;
        if (isObject(item) && typeof item.content === "string") return item.content;
        return safeJson(item);
      })
      .filter(Boolean)
      .join("\n");
  } else {
    text = safeJson(value);
  }

  return boundUtf8(text, extractionLimit).text;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable value]";
  }
}

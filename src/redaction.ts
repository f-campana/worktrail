import { homedir } from "node:os";

import { boundUtf8, type BoundedText } from "./text.js";

export type RedactedText = BoundedText & {
  redactionCount: number;
};

type Replacement = {
  pattern: RegExp;
  replace: string | ((match: string, group1: string, group2: string) => string);
};

const replacements: Replacement[] = [
  {
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
    replace: "[REDACTED_PRIVATE_KEY]",
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replace: "Bearer [REDACTED_TOKEN]",
  },
  {
    pattern: /^(?:Cookie|Set-Cookie):[^\r\n]*/gim,
    replace: "Cookie: [REDACTED_COOKIE]",
  },
  {
    pattern:
      /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?):\/\/[^\s'"`]+/gi,
    replace: (_match: string, scheme: string) =>
      `${scheme}://[REDACTED_CONNECTION_STRING]`,
  },
  {
    pattern: /\b(https?):\/\/[^\s/@:]+:[^\s/@]+@([^\s'"`]+)/gi,
    replace: (_match: string, scheme: string, hostAndPath: string) =>
      `${scheme}://[REDACTED_CREDENTIALS]@${hostAndPath}`,
  },
  {
    pattern:
      /\b((?:OPENAI|ANTHROPIC|AWS|AZURE|GITHUB|GITLAB|NPM|DATABASE|DB|REDIS|MONGO|POSTGRES|MYSQL|STRIPE|SLACK)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|URL)|[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|COOKIE))\s*=\s*([^\s;]+)/gi,
    replace: (_match: string, name: string) => `${name}=[REDACTED]`,
  },
  {
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*([^\s,;]+)/gi,
    replace: (_match: string, name: string) => `${name}=[REDACTED]`,
  },
  {
    pattern:
      /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:sk|rk)_live_[A-Za-z0-9]{12,}|npm_[A-Za-z0-9]{12,})\b/g,
    replace: "[REDACTED_API_KEY]",
  },
  {
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:_TOKEN|_SECRET|_SECRET_KEY|_ACCESS_KEY|_PASSWORD|_COOKIE))\s*=\s*([^\s;]+)/g,
    replace: (_match: string, name: string) => `${name}=[REDACTED]`,
  },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret)\s*[:=]\s*([^\s,;]+)/gi,
    replace: (_match: string, name: string) => `${name}=[REDACTED]`,
  },
];

export function redactAndBound(input: string, maxBytes: number): RedactedText {
  let text = input;
  let redactionCount = 0;

  for (const replacement of replacements) {
    text = text.replace(replacement.pattern, (...args: unknown[]) => {
      redactionCount += 1;
      return typeof replacement.replace === "string"
        ? replacement.replace
        : replacement.replace(
            typeof args[0] === "string" ? args[0] : "",
            typeof args[1] === "string" ? args[1] : "",
            typeof args[2] === "string" ? args[2] : "",
          );
    });
  }

  text = normalizeHomePaths(text);
  const bounded = boundUtf8(text, maxBytes);
  return { ...bounded, redactionCount };
}

export function normalizeHomePaths(input: string): string {
  let output = input;
  const localHome = homedir();
  if (localHome && localHome !== "/") {
    output = output.split(localHome).join("~");
  }

  output = output.replace(/\/Users\/[^/\s]+(?=\/)/g, "~");
  output = output.replace(/\/home\/[^/\s]+(?=\/)/g, "~");
  return output;
}

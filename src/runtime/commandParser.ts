/**
 * Generischer Text-Tokenizer für Konsoleneingaben (Name, Args, --Flags).
 * Er kennt keine fachlichen Commands — er zerlegt nur Text.
 */

export type ParsedCommandText = {
  raw: string;
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
};

export function parseCommandText(raw: string): ParsedCommandText {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  const request: ParsedCommandText = {
    raw,
    name: "",
    args: [],
    flags: {},
  };

  if (tokens.length === 0) {
    return request;
  }

  request.name = tokens[0];
  let index = 1;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      const nextToken = tokens[index + 1];

      if (nextToken && !nextToken.startsWith("-")) {
        request.flags[flagName] = nextToken;
        index += 2;
      } else {
        request.flags[flagName] = true;
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-")) {
      const flagName = token.slice(1);
      request.flags[flagName] = true;
      index += 1;
      continue;
    }

    request.args.push(token);
    index += 1;
  }

  return request;
}

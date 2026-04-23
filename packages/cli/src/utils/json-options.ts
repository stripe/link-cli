import type { Command } from 'commander';
import { z } from 'zod';

export class ValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join('\n'));
    this.errors = errors;
  }
}

export interface InputFieldDef {
  schema: z.ZodType;
  flag: string;
  description: string;
  jsonDescription?: string; // richer description for --help JSON block; falls back to description
  required?: boolean;
  alias?: string;
  defaultValue?: unknown;
  flagParser?: (raw: string) => unknown;
}
export type InputSchema = Record<string, InputFieldDef>;

export interface OutputFieldDef {
  outputExample: string;
  description: string;
}
export type OutputSchema = Record<string, OutputFieldDef>;

function flagToCommanderKey(flag: string): string {
  const name = flag.split(' ')[0].replace(/^--/, '');
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function registerSchemaOptions(cmd: Command, schema: InputSchema): void {
  function collect(value: string, previous: string[]): string[] {
    return previous.concat([value]);
  }

  for (const [, def] of Object.entries(schema)) {
    const flags = def.alias ? `${def.alias}, ${def.flag}` : def.flag;

    if (def.schema instanceof z.ZodArray) {
      cmd.option(flags, def.description, collect, []);
    } else if (def.defaultValue !== undefined) {
      cmd.option(flags, def.description, def.defaultValue as string);
    } else {
      cmd.option(flags, def.description);
    }
  }
}

export function resolveInput(
  options: Record<string, unknown>,
  schema: InputSchema,
): Record<string, unknown> {
  const entries = Object.entries(schema);

  let rawInput: Record<string, unknown>;

  if (options.json !== undefined) {
    // Error if any schema flags were explicitly set alongside --json
    const conflicts = entries.filter(([, def]) => {
      const val = options[flagToCommanderKey(def.flag)];
      if (def.schema instanceof z.ZodArray)
        return Array.isArray(val) && val.length > 0;
      if (def.defaultValue !== undefined)
        return val !== undefined && val !== def.defaultValue;
      return val !== undefined;
    });

    if (conflicts.length > 0) {
      const names = conflicts
        .map(([, def]) => def.flag.split(' ')[0])
        .join(', ');
      throw new Error(`Cannot combine --json with individual flags (${names})`);
    }

    try {
      rawInput = JSON.parse(options.json as string) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON: ${options.json}`);
    }

    // Apply schema defaults for fields not present in the JSON input
    for (const [key, def] of entries) {
      if (rawInput[key] === undefined && def.defaultValue !== undefined) {
        rawInput[key] = def.defaultValue;
      }
    }
  } else {
    // Build raw object from flags, keyed by schema field name
    rawInput = {};
    for (const [key, def] of entries) {
      const val = options[flagToCommanderKey(def.flag)];
      if (def.schema instanceof z.ZodArray) {
        const arr = (val as string[] | undefined) ?? [];
        if (arr.length > 0) {
          rawInput[key] = def.flagParser ? arr.map(def.flagParser) : arr;
        }
      } else if (val !== undefined) {
        rawInput[key] = val;
      }
    }
  }

  // Validate through Zod (same path for both --json and flags)
  const zodShape = Object.fromEntries(
    entries.map(([key, def]) => [
      key,
      def.required ? def.schema : def.schema.optional(),
    ]),
  );

  const fieldToFlag = Object.fromEntries(
    entries.map(([key, def]) => [key, def.flag.split(' ')[0]]),
  );
  const useJsonKeys = !!options.outputJson;

  try {
    return z.object(zodShape).strict().parse(rawInput) as Record<
      string,
      unknown
    >;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.issues.map((issue) => {
        const fieldName = issue.path[0] as string | undefined;
        const label =
          !useJsonKeys && fieldName && fieldToFlag[fieldName]
            ? fieldToFlag[fieldName]
            : issue.path.join('.');
        return label ? `${label}: ${issue.message}` : issue.message;
      });
      throw new ValidationError(messages);
    }
    throw err;
  }
}

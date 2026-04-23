import { z } from 'zod';
import type { InputSchema, OutputSchema } from './json-options';

export function buildInputHelp(schema: InputSchema): string {
  const entries = Object.entries(schema);
  const nonArrayEntries = entries.filter(
    ([, def]) => !(def.schema instanceof z.ZodArray),
  );
  const arrayEntries = entries.filter(
    ([, def]) => def.schema instanceof z.ZodArray,
  );

  // Non-array flags: strip <arg> from flag string
  const nonArrayFlags = nonArrayEntries.map(([, def]) => {
    const flag = def.flag.split(' ')[0];
    return def.required ? `${flag} (required)` : flag;
  });
  const flagPrefix = '  Flags: ';
  const indent = ' '.repeat(flagPrefix.length);
  const arrayFlagLines = arrayEntries.map(
    ([, def]) => `${indent}${def.flag}  (repeatable)`,
  );

  const flagsLine = `${flagPrefix}${nonArrayFlags.join('  ')}`;
  const flagsSection =
    arrayFlagLines.length > 0
      ? `${flagsLine}\n${arrayFlagLines.join('\n')}`
      : flagsLine;

  // JSON section: pretty-printed multi-line
  const jsonIndent = '    ';
  const jsonFields = entries.map(([key, def], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    const desc = def.jsonDescription ?? def.description;
    const requiredNote = def.required ? 'required' : '';
    const descNote = desc ? desc : '';
    const commentParts = [requiredNote, descNote].filter(Boolean);
    const comment =
      commentParts.length > 0 ? ` // ${commentParts.join(' — ')}` : '';
    if (def.schema instanceof z.ZodArray) {
      return `${jsonIndent}"${key}": [...]${comma}${comment}`;
    }
    const placeholder =
      def.defaultValue !== undefined
        ? JSON.stringify(def.defaultValue)
        : '"..."';
    return `${jsonIndent}"${key}": ${placeholder}${comma}${comment}`;
  });
  const jsonLine = `  JSON:  --json '{\n${jsonFields.join('\n')}\n  }'`;

  // Array detail sections: derive formats from schema
  const arrayDetails: string[] = [];
  for (const [key, def] of arrayEntries) {
    const element = (def.schema as z.ZodArray<z.ZodObject<z.ZodRawShape>>)
      .element;
    if (!(element instanceof z.ZodObject)) continue;
    const keys = Object.keys(element.shape);
    const flagFormat = `"key:<value>,key:<value>,..."`;
    const jsonExample = keys
      .slice(0, 3)
      .map((k) => `"${k}": "..."`)
      .join(', ');
    const jsonFormat = `"${key}": [{ ${jsonExample}${keys.length > 3 ? ', ...' : ''} }]`;
    arrayDetails.push(
      `  ${def.flag}\n    Keys:  ${keys.join(', ')}\n    Flag:  ${flagFormat}\n    JSON:  ${jsonFormat}`,
    );
  }

  const parts = ['\nInput formats:', flagsSection, jsonLine];
  if (arrayDetails.length > 0) {
    parts.push('', ...arrayDetails);
  }

  return `${parts.join('\n')}\n`;
}

export function buildOutputHelp(schema: OutputSchema, isArray = false): string {
  const fields = Object.entries(schema);

  const lines = ['\nOutput (--output-json):'];
  const outerIndent = '  ';
  const innerIndent = isArray ? '      ' : '    ';

  if (isArray) {
    lines.push(`${outerIndent}[`);
    lines.push(`${outerIndent}  {`);
  } else {
    lines.push(`${outerIndent}{`);
  }

  fields.forEach(([key, def], i) => {
    const comma = i < fields.length - 1 ? ',' : '';
    lines.push(`${innerIndent}"${key}": ${def.outputExample}${comma}`);
  });

  if (isArray) {
    lines.push(`${outerIndent}  }`);
    lines.push(`${outerIndent}]`);
  } else {
    lines.push(`${outerIndent}}`);
  }

  return `${lines.join('\n')}\n`;
}

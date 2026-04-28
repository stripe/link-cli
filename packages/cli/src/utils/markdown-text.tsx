import { Text } from 'ink';
import type React from 'react';

interface MarkdownTextProps {
  children: string;
  dimColor?: boolean;
}

/**
 * Renders a string with inline markdown: **bold** and `code`.
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({
  children,
  dimColor,
}) => {
  const parts = tokenize(children);
  return (
    <Text dimColor={dimColor}>
      {parts.map((part) => {
        if (part.type === 'bold') {
          return (
            <Text key={part.key} bold>
              {part.text}
            </Text>
          );
        }
        if (part.type === 'code') {
          return (
            <Text key={part.key} color="yellow">
              {part.text}
            </Text>
          );
        }
        return <Text key={part.key}>{part.text}</Text>;
      })}
    </Text>
  );
};

type Token =
  | { type: 'text'; key: string; text: string }
  | { type: 'bold'; key: string; text: string }
  | { type: 'code'; key: string; text: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  // Match **bold** or `code`
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;

  for (;;) {
    const match = re.exec(input);
    if (match === null) break;
    if (match.index > last) {
      tokens.push({
        type: 'text',
        key: `t${last}`,
        text: input.slice(last, match.index),
      });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold', key: `b${match.index}`, text: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({
        type: 'code',
        key: `c${match.index}`,
        text: `\`${match[2]}\``,
      });
    }
    last = match.index + match[0].length;
  }

  if (last < input.length) {
    tokens.push({ type: 'text', key: `t${last}`, text: input.slice(last) });
  }

  return tokens;
}

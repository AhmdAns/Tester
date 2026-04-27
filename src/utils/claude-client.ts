import { spawn } from 'child_process';

export interface ClaudeCallOptions {
  model?: string;
  onChunk?: (text: string) => void;
}

// Strips ANSI escape codes from claude CLI output before parsing
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  opts: ClaudeCallOptions = {},
): Promise<string> {
  const model = opts.model ?? 'claude-sonnet-4-6';

  // Embed system instructions at the top of the prompt
  const fullPrompt = systemPrompt.trim()
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  return new Promise((resolve, reject) => {
    // -p = print/non-interactive mode; reads prompt from stdin
    const args = ['-p', '--model', model];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      opts.onChunk?.(stripAnsi(text));
    });

    child.stderr.on('data', (data: Buffer) => {
      // Forward claude's stderr (e.g. progress indicators) to our stderr
      process.stderr.write(data);
    });

    child.on('close', (code: number | null) => {
      if (code === 0 || code === null) {
        resolve(stripAnsi(output).trim());
      } else {
        reject(new Error(`claude exited with code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(
        new Error(
          isNotFound
            ? 'Claude Code CLI not found. Ensure `claude` is in PATH (install Claude Code).'
            : `Failed to spawn claude: ${err.message}`,
        ),
      );
    });

    child.stdin.write(fullPrompt, 'utf-8');
    child.stdin.end();
  });
}

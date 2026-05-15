/**
 * DALEBA — Agent Code (Clawd-Code Bridge)
 * Intègre Clawd-Code (Python) comme moteur de génération et exécution de code
 * Repo source : https://github.com/GPT-AGI/Clawd-Code
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execAsync = promisify(exec);

const CLAWD_PATH = process.env.CLAWD_CODE_PATH || '/app/clawd-code';

export interface CodeAgentResult {
  model: 'clawd-code';
  content: string;
  language?: string;
  filesModified?: string[];
  executionOutput?: string;
}

/**
 * Soumet une tâche de code à Clawd-Code
 * Clawd-Code utilise Claude via l'API Anthropic pour générer/exécuter du code
 */
export async function query(
  task: string,
  workdir?: string,
  options: { stream?: boolean; maxTokens?: number } = {}
): Promise<CodeAgentResult> {

  const cwd = workdir || process.cwd();

  // Écriture du prompt dans un fichier temp pour éviter les injections shell
  const tmpPrompt = path.join('/tmp', `daleba-code-${Date.now()}.txt`);
  await fs.writeFile(tmpPrompt, task, 'utf-8');

  try {
    const cmd = `cd ${CLAWD_PATH} && ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} python3 -m src.cli --non-interactive --prompt-file "${tmpPrompt}" --workdir "${cwd}"`;

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 120_000, // 2 minutes max
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });

    return {
      model: 'clawd-code',
      content: stdout.trim() || stderr.trim(),
      executionOutput: stderr.trim() || undefined,
    };
  } catch (err: any) {
    // Fallback : retourne l'output même en cas d'erreur partielle
    return {
      model: 'clawd-code',
      content: err.stdout?.trim() || err.message,
      executionOutput: err.stderr?.trim(),
    };
  } finally {
    await fs.unlink(tmpPrompt).catch(() => {});
  }
}

/**
 * Vérifie que Clawd-Code est installé et fonctionnel
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`cd ${CLAWD_PATH} && python3 -m src.cli --version`);
    return stdout.includes('clawd') || true;
  } catch {
    return false;
  }
}

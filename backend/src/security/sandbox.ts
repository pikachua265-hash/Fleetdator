import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface WorkspaceDirs {
  base: string;
  source: string;
  build: string;
  output: string;
  logs: string;
}

export interface ExecutionOptions {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class SandboxManager {
  private baseWorkspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.baseWorkspaceRoot = path.resolve(workspaceRoot);
    if (!fs.existsSync(this.baseWorkspaceRoot)) {
      fs.mkdirSync(this.baseWorkspaceRoot, { recursive: true });
    }
  }

  createJobWorkspace(jobId: string): WorkspaceDirs {
    const jobBase = path.join(this.baseWorkspaceRoot, jobId);
    const dirs: WorkspaceDirs = {
      base: jobBase,
      source: path.join(jobBase, 'source'),
      build: path.join(jobBase, 'build'),
      output: path.join(jobBase, 'output'),
      logs: path.join(jobBase, 'logs')
    };

    for (const dir of Object.values(dirs)) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    return dirs;
  }

  getSanitizedEnvironment(customEnv?: Record<string, string>): Record<string, string> {
    const safeEnv: Record<string, string> = {};

    // Only allow specific system environment variables
    const allowedKeys = [
      'PATH',
      'Path',
      'JAVA_HOME',
      'GRADLE_HOME',
      'GRADLE_USER_HOME',
      'USERPROFILE',
      'HOME',
      'HOMEDRIVE',
      'HOMEPATH',
      'TMP',
      'TEMP',
      'SYSTEMROOT',
      'SystemRoot',
      'COMSPEC',
      'PATHEXT'
    ];

    for (const key of allowedKeys) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }

    // Default JDK 21 if Eclipse Adoptium is present and not overridden
    const defaultJdk = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot';
    if (!safeEnv['JAVA_HOME'] && fs.existsSync(defaultJdk)) {
      safeEnv['JAVA_HOME'] = defaultJdk;
      safeEnv['Path'] = `${path.join(defaultJdk, 'bin')};${safeEnv['Path'] || ''}`;
    }

    // Merge custom env if provided, strictly ensuring NO API keys exist
    if (customEnv) {
      for (const [k, v] of Object.entries(customEnv)) {
        if (/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i.test(k)) {
          continue; // Block leaking any secrets to child processes
        }
        safeEnv[k] = v;
      }
    }

    return safeEnv;
  }

  async runSandboxedProcess(options: ExecutionOptions): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const timeoutMs = options.timeoutMs || 300000; // 5 minutes default
      let timedOut = false;
      let stdoutAcc = '';
      let stderrAcc = '';

      const sanitizedEnv = this.getSanitizedEnvironment(options.env);

      // On Windows, quote command if it contains spaces
      const safeCommand =
        process.platform === 'win32' && options.command.includes(' ') && !options.command.startsWith('"')
          ? `"${options.command}"`
          : options.command;

      // Spawn child process
      const child: ChildProcess = spawn(safeCommand, options.args, {
        cwd: options.cwd,
        env: sanitizedEnv,
        shell: true
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // ignore kill errors
        }
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        const str = data.toString();
        stdoutAcc += str;
        if (options.onStdout) options.onStdout(str);
      });

      child.stderr?.on('data', (data) => {
        const str = data.toString();
        stderrAcc += str;
        if (options.onStderr) options.onStderr(str);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout: stdoutAcc,
          stderr: stderrAcc + `\nProcess spawn error: ${err.message}`,
          durationMs: Date.now() - startTime,
          timedOut: false
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? (timedOut ? -2 : 0),
          stdout: stdoutAcc,
          stderr: stderrAcc + (timedOut ? `\nProcess timed out after ${timeoutMs}ms` : ''),
          durationMs: Date.now() - startTime,
          timedOut
        });
      });
    });
  }

  cleanupWorkspace(jobId: string): void {
    const jobBase = path.join(this.baseWorkspaceRoot, jobId);
    try {
      if (fs.existsSync(jobBase)) {
        // Keep logs and output, clean source/build to save space
        const sourceDir = path.join(jobBase, 'source');
        const buildDir = path.join(jobBase, 'build');
        if (fs.existsSync(sourceDir)) fs.rmSync(sourceDir, { recursive: true, force: true });
        if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }
}

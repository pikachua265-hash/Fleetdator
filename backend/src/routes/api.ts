import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { JobManager } from '../services/jobManager.js';
import { ModInspector } from '../inspector/modInspector.js';
import { VersionResolver } from '../migration/versionResolver.js';
import { GeminiProvider } from '../ai/GeminiProvider.js';
import { OpenAIProvider } from '../ai/OpenAIProvider.js';
import { MAX_FILE_SIZE_BYTES, SecurityError } from '../security/fileSecurity.js';

export function createApiRouter(jobManager: JobManager, uploadsDir: string): Router {
  const router = Router();
  const inspector = new ModInspector();
  const versionResolver = new VersionResolver();

  // Multer storage setup
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      // Safe alphanumeric filename
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${uniqueSuffix}_${safeName}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.jar' || ext === '.zip') {
        cb(null, true);
      } else {
        cb(new SecurityError('Only .jar and .zip mod files or project archives are supported.'));
      }
    }
  });

  // 1. Upload & Inspect
  router.post('/mods/upload', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    try {
      const artifactPath = req.file.path;
      const inspection = await inspector.inspect(artifactPath);

      res.json({
        success: true,
        file: {
          originalName: req.file.originalname,
          sizeBytes: req.file.size,
          path: artifactPath,
          id: path.basename(artifactPath)
        },
        inspection
      });
    } catch (e: any) {
      // Clean up uploaded file on failure
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch {}
      res.status(500).json({ error: `Inspection failed: ${e.message}` });
    }
  });

  // 2. Start Update Job
  router.post('/update-jobs', async (req: Request, res: Response) => {
    const { filePath, targetMinecraft, loader, aiMode, maxRepairAttempts } = req.body;

    if (!filePath || !targetMinecraft) {
      res.status(400).json({ error: 'filePath and targetMinecraft are required' });
      return;
    }

    // Verify file exists
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(uploadsDir, filePath);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: `Uploaded file not found at: ${filePath}` });
      return;
    }

    try {
      const job = jobManager.createJob({
        artifactPath: fullPath,
        targetMinecraft,
        loader,
        aiMode,
        maxRepairAttempts: maxRepairAttempts ? parseInt(maxRepairAttempts, 10) : undefined
      });

      res.status(201).json({
        success: true,
        jobId: job.id,
        job
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Get Job
  router.get('/update-jobs/:id', (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const job = jobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ job });
  });

  // 4. Job Logs (SSE Stream + JSON fallback)
  router.get('/update-jobs/:id/logs', (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const job = jobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // If Accept header contains text/event-stream, establish SSE
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Send existing logs
      for (const log of job.logs) {
        res.write(`data: ${JSON.stringify({ type: 'log', log })}\n\n`);
      }

      // Send current state
      res.write(`data: ${JSON.stringify({ type: 'state', state: job.state, resultState: job.resultState })}\n\n`);

      const logListener = (data: { jobId: string; entry: any }) => {
        if (data.jobId === job.id) {
          res.write(`data: ${JSON.stringify({ type: 'log', log: data.entry })}\n\n`);
        }
      };

      const stateListener = (data: { jobId: string; state: string }) => {
        if (data.jobId === job.id) {
          res.write(`data: ${JSON.stringify({ type: 'state', state: data.state })}\n\n`);
        }
      };

      const finishListener = (data: { jobId: string; state: string; resultState: string }) => {
        if (data.jobId === job.id) {
          res.write(`data: ${JSON.stringify({ type: 'finished', state: data.state, resultState: data.resultState })}\n\n`);
        }
      };

      jobManager.on('log', logListener);
      jobManager.on('state', stateListener);
      jobManager.on('finished', finishListener);

      req.on('close', () => {
        jobManager.off('log', logListener);
        jobManager.off('state', stateListener);
        jobManager.off('finished', finishListener);
      });
    } else {
      res.json({ logs: job.logs });
    }
  });

  // 5. Job Result
  router.get('/update-jobs/:id/result', (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const job = jobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      jobId: job.id,
      state: job.state,
      resultState: job.resultState,
      failureReason: job.failureReason,
      loader: job.loader,
      currentMinecraft: job.currentMinecraft,
      targetMinecraft: job.targetMinecraft,
      originalArtifact: job.originalArtifact,
      updatedArtifact: job.updatedArtifact,
      validation: job.validation,
      repairAttempts: job.currentRepairAttempt,
      patchesCount: job.patches.length,
      downloadUrl: job.updatedArtifact ? `/api/update-jobs/${job.id}/download` : null
    });
  });

  // 6. Download Artifact
  router.get('/update-jobs/:id/download', (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const job = jobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const mode = req.query.mode === 'original' ? 'original' : 'updated';
    const artifact = mode === 'original' ? job.originalArtifact : job.updatedArtifact;

    if (!artifact || !fs.existsSync(artifact.path)) {
      res.status(404).json({ error: `${mode} artifact file not found` });
      return;
    }

    res.download(artifact.path, artifact.fileName);
  });

  // 7. Cancel Job
  router.post('/update-jobs/:id/cancel', async (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const cancelled = await jobManager.cancelJob(jobId);
    res.json({ success: cancelled });
  });

  // 8. Minecraft Versions
  router.get('/versions', async (_req: Request, res: Response) => {
    try {
      const versions = await versionResolver.getGameVersions();
      res.json({ versions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 9. Loaders
  router.get('/loaders', (_req: Request, res: Response) => {
    res.json({
      loaders: [
        { id: 'fabric', name: 'Fabric', description: 'Lightweight, modular modding toolchain for modern Minecraft' },
        { id: 'forge', name: 'Minecraft Forge', description: 'Traditional Minecraft modding platform' },
        { id: 'neoforge', name: 'NeoForge', description: 'Modern community-driven fork of Minecraft Forge' }
      ]
    });
  });

  // 10. AI Test Connection
  router.post('/ai/test', async (req: Request, res: Response) => {
    const { provider, apiKey, model } = req.body;

    if (provider === 'gemini') {
      const gemini = new GeminiProvider(apiKey, model);
      const result = await gemini.testConnection();
      res.json(result);
    } else if (provider === 'openai') {
      const openai = new OpenAIProvider(apiKey, model);
      const result = await openai.testConnection();
      res.json(result);
    } else {
      res.status(400).json({ success: false, message: 'Invalid provider. Must be "gemini" or "openai".' });
    }
  });

  // 11. AI Config (NEVER leaks actual keys!)
  router.get('/ai/config', (_req: Request, res: Response) => {
    const gemini = new GeminiProvider();
    const openai = new OpenAIProvider();

    res.json({
      geminiConfigured: gemini.isConfigured(),
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      openaiConfigured: openai.isConfigured(),
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
      maxRepairAttempts: parseInt(process.env.MAX_REPAIR_ATTEMPTS || '8', 10)
    });
  });

  // 12. Update AI Config (Saves to server .env safely)
  router.post('/ai/config', (req: Request, res: Response) => {
    const { geminiApiKey, geminiModel, openaiApiKey, openaiModel, maxRepairAttempts } = req.body;
    const envPath = path.resolve(__dirname, '../../.env');

    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    if (geminiApiKey) {
      process.env.GEMINI_API_KEY = geminiApiKey;
      envContent = updateEnvKey(envContent, 'GEMINI_API_KEY', geminiApiKey);
    }
    if (geminiModel) {
      process.env.GEMINI_MODEL = geminiModel;
      envContent = updateEnvKey(envContent, 'GEMINI_MODEL', geminiModel);
    }
    if (openaiApiKey) {
      process.env.OPENAI_API_KEY = openaiApiKey;
      envContent = updateEnvKey(envContent, 'OPENAI_API_KEY', openaiApiKey);
    }
    if (openaiModel) {
      process.env.OPENAI_MODEL = openaiModel;
      envContent = updateEnvKey(envContent, 'OPENAI_MODEL', openaiModel);
    }
    if (maxRepairAttempts) {
      process.env.MAX_REPAIR_ATTEMPTS = String(maxRepairAttempts);
      envContent = updateEnvKey(envContent, 'MAX_REPAIR_ATTEMPTS', String(maxRepairAttempts));
    }

    fs.writeFileSync(envPath, envContent, 'utf-8');
    res.json({ success: true, message: 'AI configuration updated securely.' });
  });

  // 13. History
  router.get('/history', (_req: Request, res: Response) => {
    const all = jobManager.getAllJobs().map((j) => ({
      id: j.id,
      createdAt: j.createdAt,
      state: j.state,
      resultState: j.resultState,
      loader: j.loader,
      currentMinecraft: j.currentMinecraft,
      targetMinecraft: j.targetMinecraft,
      modName: j.inspection?.modName || j.originalArtifact.fileName,
      modId: j.inspection?.modId || 'unknown',
      sourceSha256: j.originalArtifact.sha256,
      updatedSha256: j.updatedArtifact?.sha256,
      repairAttempts: j.currentRepairAttempt,
      failureReason: j.failureReason
    }));
    res.json({ history: all });
  });

  return router;
}

function updateEnvKey(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content ? `${content.trim()}\n${key}=${value}\n` : `${key}=${value}\n`;
}

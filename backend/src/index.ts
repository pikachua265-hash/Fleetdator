import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables before anything else
dotenv.config();

import express from 'express';
import cors from 'cors';
import { JobManager } from './services/jobManager.js';
import { createApiRouter } from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || '0.0.0.0';

const workspaceRoot = path.resolve(__dirname, '../workspace');
const uploadsDir = path.resolve(__dirname, '../uploads');

fs.mkdirSync(workspaceRoot, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const jobManager = new JobManager(workspaceRoot);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount API routes
app.use('/api', createApiRouter(jobManager, uploadsDir));

// Start server
const server = app.listen(Number(PORT), HOST, () => {
  console.log(`[SERVER] Minecraft Mod Updater AI Backend running on http://${HOST}:${PORT}`);
  console.log(`[SERVER] Sandboxed Workspace Root: ${workspaceRoot}`);
});

process.on('SIGINT', () => {
  console.log('[SERVER] Shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

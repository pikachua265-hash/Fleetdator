import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';

export const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_FILE_COUNT = 15000;

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

export function computeBufferSha256(buffer: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

export function sanitizePath(baseDir: string, relativePath: string): string {
  // Normalize and resolve against base directory
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir) + path.sep;

  if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
    throw new SecurityError(`Path traversal attempt detected: ${relativePath}`);
  }

  // Reject null bytes and illegal control characters
  if (relativePath.includes('\0') || /[\x00-\x1f]/.test(relativePath)) {
    throw new SecurityError(`Malicious characters in file path: ${relativePath}`);
  }

  return resolved;
}

export function safeExtractZip(zipFilePath: string, targetDir: string): { extractedFiles: string[]; totalBytes: number } {
  if (!fs.existsSync(zipFilePath)) {
    throw new SecurityError(`Archive not found: ${zipFilePath}`);
  }

  const stats = fs.statSync(zipFilePath);
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new SecurityError(`Archive exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const zip = new AdmZip(zipFilePath);
  const zipEntries = zip.getEntries();

  if (zipEntries.length > MAX_FILE_COUNT) {
    throw new SecurityError(`Archive contains too many entries (${zipEntries.length} > ${MAX_FILE_COUNT})`);
  }

  let totalExtractedBytes = 0;
  const extractedFiles: string[] = [];

  for (const entry of zipEntries) {
    const entryName = entry.entryName;

    // Check entry name for Zip-Slip
    const destinationPath = sanitizePath(targetDir, entryName);

    if (entry.isDirectory) {
      fs.mkdirSync(destinationPath, { recursive: true });
      continue;
    }

    // Decompression bomb check
    totalExtractedBytes += entry.header.size;
    if (totalExtractedBytes > MAX_EXTRACTED_BYTES) {
      throw new SecurityError(`Decompression limit exceeded (possible zip bomb)`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(destinationPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let data = entry.getData();
    // Automatically sanitize UTF-8 BOM if present on text files
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      data = data.subarray(3);
    }
    fs.writeFileSync(destinationPath, data);
    extractedFiles.push(path.relative(targetDir, destinationPath));
  }

  return { extractedFiles, totalBytes: totalExtractedBytes };
}

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function printUsage() {
  console.log(
    [
      'SmartMovieMatch Build System',
      '',
      'Usage:',
      '  node scripts/build.js --target <dir> [--dry-run] [--verbose] [--ext <csv>] [--include <pattern>] [--exclude <pattern>] [--rollback <versionId>]',
      '',
      'Flags:',
      '  --target <dir>       Root folder to process (required)',
      '  --dry-run            Simulate changes without writing files or logs',
      '  --verbose            Print detailed status output',
      '  --ext <csv>          Comma-separated list of extensions to process (default: js,ts,json,css,html)',
      '  --include <pattern>  Only process files whose relative path contains this substring',
      '  --exclude <pattern>  Skip files whose relative path contains this substring',
      '  --rollback <id>      Roll back files from a previous backup version id (e.g., 20251119-120101)',
      '',
      'Examples:',
      '  node scripts/build.js --target . --dry-run --verbose',
      '  node scripts/build.js --target . --ext js,ts,json --include assets/js',
      '  node scripts/build.js --target . --rollback 20251119-120101'
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = { target: null, dryRun: false, verbose: false, ext: ['js','ts','json','css','html'], include: null, exclude: null, rollback: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; }
    else if (a === '--target') { args.target = argv[++i]; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--verbose') { args.verbose = true; }
    else if (a === '--ext') { const v = argv[++i] || ''; args.ext = v.split(',').map(s=>s.trim()).filter(Boolean); }
    else if (a === '--include') { args.include = argv[++i] || null; }
    else if (a === '--exclude') { args.exclude = argv[++i] || null; }
    else if (a === '--rollback') { args.rollback = argv[++i] || null; }
  }
  return args;
}

function nowVersionId() {
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readFileSafe(fp) {
  try { return fs.readFileSync(fp); } catch (e) { return null; }
}

function writeFileSafe(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, data);
}

function isBinaryBuffer(buf) {
  if (!buf) return false;
  const len = Math.min(buf.length, 1024);
  for (let i=0;i<len;i++) {
    const c = buf[i];
    if (c === 0) return true;
  }
  return false;
}

function normalizeText(content) {
  const normalized = content.replace(/\r\n|\r/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n');
  return normalized.endsWith('\n') ? normalized : normalized + '\n';
}

function transformJson(buffer) {
  try {
    const text = buffer.toString('utf8');
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2) + '\n';
    return Buffer.from(pretty, 'utf8');
  } catch (_) {
    return null;
  }
}

function transformByExt(relPath, buffer) {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.json') {
    const out = transformJson(buffer);
    return out || buffer; // fallback to original if invalid JSON
  }
  if (ext === '.js' || ext === '.ts' || ext === '.css' || ext === '.html') {
    if (isBinaryBuffer(buffer)) return buffer;
    const text = buffer.toString('utf8');
    const out = normalizeText(text);
    return Buffer.from(out, 'utf8');
  }
  return buffer;
}

function shouldProcess(relPath, opts) {
  const ext = path.extname(relPath).replace(/^\./,'').toLowerCase();
  if (opts.ext.length && !opts.ext.includes(ext)) return false;
  if (opts.include && !relPath.includes(opts.include)) return false;
  if (opts.exclude && relPath.includes(opts.exclude)) return false;
  if (relPath.startsWith('.smm_build')) return false;
  if (relPath.includes('node_modules')) return false;
  return true;
}

function listFilesRecursive(root) {
  const out = [];
  const stack = ['.'];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of entries) {
      const childRel = path.join(rel, ent.name);
      const childAbs = path.join(root, childRel);
      if (ent.isDirectory()) {
        stack.push(childRel);
        continue;
      }
      if (ent.isFile()) out.push({ rel: childRel.replace(/\\/g,'/'), abs: childAbs });
    }
  }
  return out;
}

function chmodPreserve(fp, mode) {
  try { if (typeof mode === 'number') fs.chmodSync(fp, mode); } catch (_) {}
}

function accessWritable(fp) {
  try { fs.accessSync(fp, fs.constants.W_OK); return true; } catch (_) { return false; }
}

function createBackupRoot(root, versionId) {
  const backupRoot = path.join(root, '.smm_build', 'backups', versionId);
  fs.mkdirSync(backupRoot, { recursive: true });
  return backupRoot;
}

function appendChangeLog(root, entry) {
  const dir = path.join(root, '.smm_build');
  fs.mkdirSync(dir, { recursive: true });
  const jsonl = path.join(dir, 'change-log.jsonl');
  const txt = path.join(dir, 'change-log.txt');
  fs.appendFileSync(jsonl, JSON.stringify(entry) + os.EOL);
  const line = `[${entry.timestamp}] ${entry.action} ${entry.relPath} from=${entry.fromHash} to=${entry.toHash}` + os.EOL;
  fs.appendFileSync(txt, line);
}

async function processAll(opts) {
  const root = path.resolve(opts.target);
  const versionId = nowVersionId();
  const backupRoot = opts.dryRun ? null : createBackupRoot(root, versionId);
  const files = listFilesRecursive(root).filter(f => shouldProcess(f.rel, opts));

  const summary = { scanned: files.length, changed: 0, skipped: 0, failed: 0 };
  const concurrency = 8;
  let idx = 0;

  function nextBatch() {
    const batch = [];
    while (idx < files.length && batch.length < concurrency) batch.push(files[idx++]);
    return batch;
  }

  while (idx < files.length) {
    const batch = nextBatch();
    await Promise.all(batch.map(async ({ rel, abs }) => {
      const statBefore = fs.statSync(abs);
      const original = readFileSafe(abs);
      if (!original) { summary.failed++; if (opts.verbose) console.warn('Read failed:', rel); return; }
      if (!accessWritable(abs)) { summary.skipped++; if (opts.verbose) console.warn('No write permission:', rel); return; }
      const fromHash = sha256(original);
      const transformed = transformByExt(rel, original);
      const toHash = sha256(transformed);
      if (fromHash === toHash) { summary.skipped++; if (opts.verbose) console.log('No changes:', rel); return; }

      if (opts.verbose) console.log('Change:', rel);
      if (!opts.dryRun) {
        const backupPath = path.join(backupRoot, rel);
        writeFileSafe(backupPath, original);
        try {
          writeFileSafe(abs, transformed);
        } catch (e) {
          summary.failed++; console.error('Write failed:', rel, e && e.message); return;
        }
        chmodPreserve(abs, statBefore.mode);
        const after = readFileSafe(abs);
        const verifyHash = sha256(after);
        if (verifyHash !== toHash) { summary.failed++; console.error('Integrity mismatch after write:', rel); return; }
        const entry = {
          timestamp: new Date().toISOString(),
          versionId,
          action: 'modify',
          relPath: rel,
          fromHash,
          toHash,
          mode: statBefore.mode
        };
        appendChangeLog(root, entry);
      }
      summary.changed++;
    }));
  }

  console.log('Build complete:', JSON.stringify(summary));
  if (!opts.dryRun) {
    console.log('Backup version id:', versionId);
    console.log('Backup location:', path.join(root, '.smm_build', 'backups', versionId));
  }
}

function rollback(opts) {
  const root = path.resolve(opts.target);
  const versionId = opts.rollback;
  if (!versionId) { console.error('Missing --rollback <versionId>'); process.exit(2); }
  const backupRoot = path.join(root, '.smm_build', 'backups', versionId);
  if (!fs.existsSync(backupRoot)) { console.error('Backup not found:', backupRoot); process.exit(2); }

  const files = listFilesRecursive(backupRoot);
  let restored = 0, failed = 0;
  for (const { rel, abs } of files) {
    const target = path.join(root, rel);
    const buf = readFileSafe(abs);
    if (!buf) { failed++; console.warn('Missing backup file:', rel); continue; }
    try {
      writeFileSafe(target, buf);
      restored++;
      const entry = {
        timestamp: new Date().toISOString(),
        versionId,
        action: 'rollback',
        relPath: rel,
        fromHash: sha256(readFileSafe(target)),
        toHash: sha256(buf)
      };
      appendChangeLog(root, entry);
    } catch (e) {
      failed++;
      console.error('Restore failed:', rel, e && e.message);
    }
  }
  console.log('Rollback complete:', JSON.stringify({ restored, failed }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.target) { printUsage(); process.exit(args.help ? 0 : 2); }
  if (args.rollback) { rollback(args); return; }
  await processAll(args);
}

main().catch((e)=>{ console.error('Build failed:', e && e.message ? e.message : e); process.exit(1); });

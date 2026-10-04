// Keep the esbuild executable usable after the project's NAS-to-local migration.
// Only this dependency executable is cached; application code stays in this tree.
import { mkdir, copyFile, chmod, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const binary = path.join(root,'node_modules/@esbuild',`${process.platform}-${process.arch}`,'bin/esbuild');
const cache = path.join(tmpdir(),'sessionweave-native',process.getuid?.().toString() || 'user');
await mkdir(cache,{recursive:true});
const target = path.join(cache,'esbuild');
const source = await stat(binary);
const existing = await stat(target).catch(() => null);
if (!existing || existing.size !== source.size || existing.mtimeMs < source.mtimeMs) { await copyFile(binary,target); await chmod(target,0o700); }
const env = {...process.env, ESBUILD_BINARY_PATH:target};
const run = args => new Promise(resolve => { const child = spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'}); child.on('error', e => { console.error(e.message); resolve(1); }); child.on('exit', code => resolve(code ?? 1)); });
const command = process.argv[2];
let result = 0;
if (command === 'build') { result = await run(['node_modules/typescript/bin/tsc','--noEmit']); if (!result) result = await run(['node_modules/vite/bin/vite.js','build']); }
else if (command === 'check') result = await run(['node_modules/typescript/bin/tsc','--noEmit']);
else if (command === 'test') { for(const file of (await readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.ts'))) {result=await run(['--import','tsx',`tests/${file}`]);if(result)break;} }
else if (command === 'script') result = await run(['--import','tsx',...process.argv.slice(3)]);
else result = await run(['--import','tsx','server/index.ts',...(command === 'start' ? ['--production'] : [])]);
process.exitCode = Number(result);

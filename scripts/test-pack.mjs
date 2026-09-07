import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const testedPiVersion = '0.85.0';
// An already installed runtime can be repacked locally when npm release-age
// policy excludes the tested version. Never disable that policy in this script.
let piSource = `@earendil-works/pi-coding-agent@${testedPiVersion}`;
const expectedFiles = ['LICENSE', 'README.md', 'attachments.mjs', 'capabilities.mjs', 'core.mjs', 'ffmpeg.mjs', 'index.ts', 'package.json'].sort();
assert.equal(manifest.name, 'pi-video');
assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
assert.equal(manifest.license, 'MIT');
assert.ok(manifest.keywords.includes('pi-package'));
assert.equal(manifest.peerDependencies['@earendil-works/pi-coding-agent'], `^${testedPiVersion}`);
assert.equal(manifest.engines.node, '>=22.19.0');

const sandbox = await mkdtemp(join(tmpdir(), 'pi-video-pack-'));
const host = join(sandbox, 'host');
const archiveDir = resolve(process.env.PI_VIDEO_PACK_DIR || join(root, 'runs', 'release'));
const profile = join(sandbox, 'profile');
const testTmp = join(sandbox, 'tmp');
for (const dir of [host, archiveDir, profile, testTmp]) await mkdir(dir, {recursive: true});
const env = {...process.env, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: '1', TMPDIR: testTmp, TMP: testTmp, TEMP: testTmp,
  npm_config_cache: join(sandbox, 'npm-cache')};
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
const run = (command, args, cwd, timeout = 600000) => {
  const pending = exec(command, args, {cwd, env, timeout, maxBuffer: 8 * 1024 * 1024});
  // The pi print CLI reads piped stdin before startup; an open empty pipe hangs.
  pending.child.stdin?.end();
  return pending;
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runNpm = (args, cwd) => process.env.npm_execpath ? run(process.execPath, [process.env.npm_execpath, ...args], cwd) : run(npm, args, cwd);
let passed = false;
try {
  if (process.env.PI_VIDEO_TEST_PI_DIR) {
    // Copy an already trusted runtime, with its installed dependencies, into a
    // disposable bundled archive. No global runtime files/config are modified.
    const installed = resolve(process.env.PI_VIDEO_TEST_PI_DIR);
    const piManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(piManifest.name, '@earendil-works/pi-coding-agent');
    assert.equal(piManifest.version, testedPiVersion);
    const snapshot = join(sandbox, 'pi-runtime');
    await cp(installed, snapshot, {recursive: true, dereference: true});
    piManifest.bundledDependencies = Object.keys({...piManifest.dependencies, ...piManifest.optionalDependencies});
    await writeFile(join(snapshot, 'package.json'), JSON.stringify(piManifest, null, 2) + '\n');
    const runtimePack = JSON.parse((await runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', sandbox], snapshot)).stdout)[0];
    piSource = join(sandbox, runtimePack.filename);
  }
  const packed = JSON.parse((await runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', archiveDir], root)).stdout)[0];
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedFiles, 'Unexpected tarball contents');
  const tarball = join(archiveDir, packed.filename);
  const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  await writeFile(join(host, 'package.json'), JSON.stringify({name: 'pi-video-pack-smoke', private: true, type: 'module'}) + '\n');
  console.log(`Installing ${packed.id} and pi ${testedPiVersion} in a fresh host with an empty npm cache…`);
  const install = await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', ...(process.env.PI_VIDEO_TEST_PI_DIR ? ['--offline'] : []), tarball, piSource], host);
  await writeFile(join(archiveDir, 'install.log'), install.stdout + install.stderr);
  await copyFile(join(root, 'test', 'packed-smoke.mjs'), join(host, 'packed-smoke.test.mjs'));
  env.PI_VIDEO_PACKAGE_ROOT = join(host, 'node_modules', manifest.name);
  for (const file of ['packed-hook-tests.mjs', 'packed-driver.ts']) await copyFile(join(root, 'test', file), join(host, file));
  env.PI_VIDEO_HOOK_REPORT = join(sandbox, 'hook-report.json');
  await writeFile(join(profile, 'models.json'), JSON.stringify({providers: {'pack-smoke': {
    baseUrl: 'https://unused.invalid/v1', api: 'openai-completions', apiKey: 'mock',
    models: [{id: 'mock', name: 'Offline smoke', input: ['text'], reasoning: false, contextWindow: 8192, maxTokens: 1024}]
  }}}));
  const cli = join(host, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
  const testedNodes = [];
  const runtimes = [process.execPath, ...(process.env.PI_VIDEO_TEST_NODE ? [resolve(process.env.PI_VIDEO_TEST_NODE)] : [])];
  for (const [index, runtime] of runtimes.entries()) {
    const nodeVersion = (await run(runtime, ['--version'], host)).stdout.trim();
    const suffix = index === 0 ? '' : `-${nodeVersion}`;
    const smoke = await run(runtime, ['--test', 'packed-smoke.test.mjs'], host, 60000);
    console.log(smoke.stdout);
    await writeFile(join(archiveDir, `packed-smoke${suffix}.log`), smoke.stdout + smoke.stderr);
    const cliSmoke = await run(runtime, [cli, '--offline', '--no-extensions', '-e', join(host, 'packed-driver.ts'),
      '--no-session', '--no-skills', '--no-prompt-templates', '--provider', 'pack-smoke', '--model', 'mock', '--mode', 'json', '--print', 'unused'], host, 60000);
    await writeFile(join(archiveDir, `packed-cli${suffix}.log`), cliSmoke.stdout + cliSmoke.stderr);
    assert.ok(!cliSmoke.stdout.includes('"type":"agent_start"'), 'Smoke prompt unexpectedly started inference');
    const hookReport = JSON.parse(await readFile(env.PI_VIDEO_HOOK_REPORT, 'utf8'));
    await writeFile(join(archiveDir, `hook-report${suffix}.json`), JSON.stringify(hookReport, null, 2) + '\n');
    assert.equal(hookReport.tests, 4, JSON.stringify(hookReport));
    assert.equal(hookReport.passed, hookReport.tests, JSON.stringify(hookReport));
    console.log(`PASS: ${hookReport.passed} packed extension checks through the bundled pi CLI`);
    testedNodes.push(nodeVersion);
  }
  const report = {name: packed.name, version: packed.version, tarball, sha256, integrity: packed.integrity,
    size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files, node: process.version, testedNodes,
    pi: testedPiVersion, piSource: process.env.PI_VIDEO_TEST_PI_DIR ? 'offline bundled snapshot of installed runtime' : 'npm registry', cleanInstall: 'passed (lifecycle scripts disabled)', extensionSmoke: 'passed',
    scope: 'Real pi loader and serializers; mocked capability discovery and video bytes; no inference.'};
  await writeFile(join(archiveDir, 'pack-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${packed.id}; ${packed.files.length} files; SHA256 ${sha256}`);
  console.log(`Release artifacts: ${archiveDir}`);
  passed = true;
} catch (error) {
  console.error(error.stdout || '', error.stderr || '');
  throw error;
} finally {
  if (passed) await rm(sandbox, {recursive: true, force: true});
  else console.error(`Failed smoke sandbox retained for inspection: ${sandbox}`);
}

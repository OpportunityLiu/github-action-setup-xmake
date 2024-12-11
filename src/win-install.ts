import * as core from '@actions/core';
import { exec } from '@actions/exec';
import * as io from '@actions/io';
import * as toolCache from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as git from './git';
import { Version, GitVersion } from './interfaces';

function getInstallerUrl(version: GitVersion, latest: GitVersion): string {
    let ver = version.version;
    switch (version.type) {
        case 'heads': {
            const arch = os.arch() === 'x64' ? 'win64' : 'win32';
            const latestver = latest.version;
            if (ver !== 'dev' && ver !== 'master') {
                ver = latestver;
            }
            return `https://github.com/xmake-io/xmake/releases/download/${latestver}/xmake-${ver}.${arch}.exe`;
        }
        case 'pull': {
            throw new Error('PR builds for windows is not supported');
        }
        case 'sha': {
            throw new Error('Sha builds for windows is not supported');
        }
        case 'tags': {
            const arch = os.arch() === 'x64' ? 'win64' : 'win32';
            return semver.gt(ver, '2.2.6')
                ? `https://github.com/xmake-io/xmake/releases/download/${ver}/xmake-${ver}.${arch}.exe`
                : `https://github.com/xmake-io/xmake/releases/download/${ver}/xmake-${ver}.exe`;
        }
        default: {
            // check that we have tested all types
            const _: never = version.type;
            throw new Error('Unknown version type');
        }
    }
}

async function installFromSource(xmakeBin: string, sourceDir: string, binDir: string): Promise<void> {
    await exec(xmakeBin, ['-y'], { cwd: sourceDir });
    await exec(xmakeBin, ['install', '-o', binDir, 'cli'], { cwd: sourceDir });
}

export async function winInstall(version: Version, latest: Version): Promise<void> {
    if (version.type === 'local' || latest.type === 'local') {
        throw new Error('Local builds for windows is not supported');
    }

    const actionsCacheFolder = core.getInput('actions-cache-folder');
    let actionsCacheKey = core.getInput('actions-cache-key');
    if (!actionsCacheKey) {
        actionsCacheKey = '';
    }

    const ver = version.version;
    const sha = version.sha;
    const cacheKey = `xmake-cache-${actionsCacheKey}-${ver}-${sha}-${os.arch()}-${os.platform()}-${
        process.env.RUNNER_OS ?? 'unknown'
    }`;

    let toolDir = '';
    if (actionsCacheFolder && process.env.GITHUB_WORKSPACE) {
        const fullCachePath = path.join(process.env.GITHUB_WORKSPACE, actionsCacheFolder);
        try {
            try {
                fs.accessSync(path.join(fullCachePath, 'xmake.exe'), fs.constants.X_OK);
            } catch {
                await cache.restoreCache([actionsCacheFolder], cacheKey);
            }
            fs.accessSync(path.join(fullCachePath, 'xmake.exe'), fs.constants.X_OK);
            toolDir = fullCachePath;
            core.info(`cache path: ${toolDir}, key: ${cacheKey}`);
        } catch {
            core.warning(`No cached files found at path "${fullCachePath}".`);
            await io.rmRF(fullCachePath);
        }
    } else {
        toolDir = toolCache.find('xmake', ver);
    }

    if (!toolDir) {
        const installer = await core.group(`download xmake ${String(version)}`, async () => {
            const url = getInstallerUrl(version, latest);
            core.info(`downloading from ${url}`);
            const file = await toolCache.downloadTool(url);
            const exe = path.format({
                ...path.parse(file),
                ext: '.exe',
                base: undefined,
            });
            await io.mv(file, exe);
            core.info(`downloaded to ${exe}`);
            return exe;
        });
        toolDir = await core.group(`install xmake ${String(version)}`, async () => {
            const binDir = path.join(os.tmpdir(), `xmake-${version.sha}`);
            core.info(`installing to ${binDir}`);
            await exec(`"${installer}" /NOADMIN /S /D=${binDir}`);
            core.info(`installed to ${binDir}`);
            const cacheDir = await toolCache.cacheDir(binDir, 'xmake', ver);
            await io.rmRF(binDir);
            await io.rmRF(installer);
            return cacheDir;
        });
        await exec(`"${toolDir}/xmake.exe" --version`);
        if (version.type === 'heads') {
            const sourceDir = await core.group(`download xmake source ${String(version)}`, () =>
                git.create(version.repo, version.sha),
            );
            toolDir = await core.group(`install xmake source ${String(version)}`, async () => {
                const binDir = path.join(os.tmpdir(), `xmake-${version.sha}`);
                await installFromSource(`${toolDir}/xmake.exe`, `${sourceDir}/core`, binDir);
                const cacheDir = await toolCache.cacheDir(binDir, 'xmake', ver);

                await io.rmRF(binDir);
                await git.cleanup(version.sha);
                return cacheDir;
            });
        }

        if (toolDir) {
            let cacheDir = '';
            if (actionsCacheFolder && process.env.GITHUB_WORKSPACE) {
                cacheDir = path.join(process.env.GITHUB_WORKSPACE, actionsCacheFolder);
                await io.cp(toolDir, cacheDir, {
                    recursive: true,
                });
                await cache.saveCache([actionsCacheFolder], cacheKey);
                toolDir = cacheDir;
            }
        }
    }
    core.addPath(toolDir);
}

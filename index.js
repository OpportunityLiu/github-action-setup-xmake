const core = require('@actions/core')
const exec = require('@actions/exec').exec
const fs = require('fs').promises
const io = require('@actions/io')
const toolCache = require('@actions/tool-cache')
const os = require('os')
const path = require('path')
const semver = require('semver')
const git = require('./git')
const selectVersion = require('./selectVersion')

async function winInstall(version) {
    let toolDir = toolCache.find('xmake', version)
    if (!toolDir) {
        const installer = await core.group("download xmake", async () => {
            const arch = os.arch() === 'x64' ? 'x64' : 'x86'
            const url = semver.gt(version, '2.2.6')
                ? `https://ci.appveyor.com/api/projects/waruqi/xmake/artifacts/xmake-installer.exe?tag=v${version}&pr=false&job=Image%3A+Visual+Studio+2017%3B+Platform%3A+${arch}`
                : `https://github.com/xmake-io/xmake/releases/download/v$v/xmake-v${version}.exe`
            core.info(`downloading from ${url}`)
            const file = await toolCache.downloadTool(url)
            const exe = path.format({ ...path.parse(file), ext: '.exe' })
            await fs.rename(file, exe)
            core.info(`downloaded to ${exe}`)
            return exe
        })
        toolDir = await core.group("install xmake", async () => {
            const binDir = path.join(os.tmpdir(), `xmake-${version}`)
            await exec(`"${installer}" /NOADMIN /S /D=${binDir}`)
            const cacheDir = await toolCache.cacheDir(binDir, 'xmake', version)
            await io.rmRF(binDir)
            await io.rmRF(installer)
            return cacheDir
        })
    }
    core.addPath(toolDir)
}

async function unixInstall(version, sha) {
    let toolDir = toolCache.find('xmake', version)
    if (!toolDir) {
        const sourceDir = await core.group("download xmake", () => git.create(sha))
        toolDir = await core.group("install xmake", async () => {
            await exec('make', ['build'], { cwd: sourceDir })
            const binDir = path.join(os.tmpdir(), `xmake-${version}-${sha}`)
            await exec('make', ['install', `prefix=${binDir}`], { cwd: sourceDir })
            const cacheDir = await toolCache.cacheDir(binDir, 'xmake', version)
            await io.rmRF(binDir)
            await git.cleanup()
            return cacheDir
        })
    }
    core.addPath(path.join(toolDir, 'share', 'xmake'))
}

async function run() {
    try {
        const { version, sha } = selectVersion()
        if (os.platform() === 'win32' || os.platform() === 'cygwin')
            await winInstall(version)
        else
            await unixInstall(version, sha)
        await exec('xmake --version')
    } catch (error) {
        core.setFailed(error.message)
    }
}

run()
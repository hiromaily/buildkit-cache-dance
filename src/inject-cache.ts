import { promises as fs } from "fs";
import path from 'path';
import { CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath, getUID, getGID, getBuilder, generateUniqueSuffix, isDebug } from './opts.js';
import { run, debug, debugSection, debugInspectDirectory } from './run.js';
import { notice } from '@actions/core/lib/core.js';

async function injectCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string, debugEnabled: boolean) {
    // Generate unique image name for this cache to avoid conflicts with multiple caches
    const uniqueSuffix = generateUniqueSuffix(cacheSource);
    const imageName = `dance:inject-${uniqueSuffix}`;

    debugSection(`INJECT CACHE: ${cacheSource}`);
    debug(`Cache source: ${cacheSource}`);
    debug(`Cache options: ${JSON.stringify(cacheOptions)}`);
    debug(`Scratch dir: ${scratchDir}`);
    debug(`Container image: ${containerImage}`);
    debug(`Builder: ${builder}`);
    debug(`Unique suffix: ${uniqueSuffix}`);
    debug(`Image name: ${imageName}`);

    // Clean Scratch Directory
    await fs.rm(scratchDir, { recursive: true, force: true });
    await fs.mkdir(scratchDir, { recursive: true });

    // Prepare Cache Source Directory
    await fs.mkdir(cacheSource, { recursive: true });

    // Inspect cache source before injection
    if (debugEnabled) {
        await debugInspectDirectory(cacheSource, `Cache source BEFORE injection (${cacheSource})`);
    }

    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(cacheSource, 'buildstamp'), date);

    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    debug(`Target path: ${targetPath}`);
    debug(`Mount args: ${mountArgs}`);

    // If UID OR GID are set, then add chown to restore files ownership.
    let ownershipCommand = "";
    const uid = getUID(cacheOptions);
    const gid = getGID(cacheOptions);
    if (uid !== "" || gid !== "") {
        ownershipCommand = `&& chown -R ${uid}:${gid} ${targetPath}`
        debug(`Ownership command: ${ownershipCommand}`);
    }

    // Prepare Dancefile to Access Caches
    const dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \\
    --mount=type=bind,source=.,target=/var/dance-cache \\
    cp -p -R /var/dance-cache/. ${targetPath} ${ownershipCommand} || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.inject'), dancefileContent);

    debugSection(`Generated Dancefile.inject`);
    console.log(dancefileContent);

    try {
        // Inject Data into Docker Cache
        debug(`Running docker buildx build for injection...`);
        debug(`TIP: For more detailed docker output, run with: BUILDKIT_PROGRESS=plain`);

        // Use --progress=plain in debug mode for detailed output
        const buildArgs = ['buildx', 'build', '--builder', builder, '-f', path.join(scratchDir, 'Dancefile.inject'), '--tag', imageName];
        if (debugEnabled) {
            buildArgs.push('--progress=plain');
        }
        buildArgs.push(cacheSource);

        await run('docker', buildArgs);
        debug(`Docker build completed successfully (exit code: 0)`);
    } finally {
        // Cleanup: Remove the temporary image (always runs)
        try {
            await run('docker', ['rmi', '-f', imageName]);
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    // Clean Directories
    try {
        await fs.rm(cacheSource, { recursive: true, force: true });
    } catch (err) {
        // Ignore Cleaning Errors
        notice(`Error while cleaning cache source directory: ${err}. Ignoring...`);
    }
}


export async function injectCaches(opts: Opts) {
    const debugEnabled = isDebug(opts);
    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];
    const builder = getBuilder(opts);

    debugSection(`INJECT CACHES - START`);
    debug(`Total caches to inject: ${Object.keys(cacheMap).length}`);
    debug(`Cache map: ${JSON.stringify(cacheMap, null, 2)}`);

    // Inject Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await injectCache(cacheSource, cacheOptions, scratchDir, containerImage, builder, debugEnabled);
    }

    debugSection(`INJECT CACHES - COMPLETE`);
}

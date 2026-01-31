import { promises as fs } from 'fs';
import path from 'path';
import {CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath, getBuilder, generateUniqueSuffix, isDebug, isRsyncMode, getUtilityImage, validateSafePath, sanitizeForDockerfile} from './opts.js';
import { run, runPiped, debug, debugSection, debugInspectDirectory, debugSizeComparison } from './run.js';

function elapsedMs(start: number): number {
  return Math.round((Date.now() - start) / 10) / 100;
}

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string, debugEnabled: boolean, rsyncEnabled: boolean) {
    // Security: Validate cacheSource is a safe relative path
    validateSafePath(cacheSource, 'cache source');
    validateSafePath(scratchDir, 'scratch directory');

    // Generate unique names for this cache to avoid conflicts with multiple caches
    const uniqueSuffix = generateUniqueSuffix(cacheSource);
    const imageName = `dance:extract-${uniqueSuffix}`;
    const containerName = `cache-container-${uniqueSuffix}`;

    debugSection(`EXTRACT CACHE: ${cacheSource}`);
    debug(`Cache source (destination): ${cacheSource}`);
    debug(`Cache options: ${JSON.stringify(cacheOptions)}`);
    debug(`Scratch dir: ${scratchDir}`);
    debug(`Container image: ${containerImage}`);
    debug(`Builder: ${builder}`);
    debug(`Unique suffix: ${uniqueSuffix}`);
    debug(`Image name: ${imageName}`);
    debug(`Container name: ${containerName}`);
    debug(`Rsync mode: ${rsyncEnabled}`);

    // Clean Scratch Directory to avoid leftover data from previous iterations
    await fs.rm(scratchDir, { recursive: true, force: true });
    await fs.mkdir(scratchDir, { recursive: true });

    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    // Security: Validate values that will be used in Dockerfile
    sanitizeForDockerfile(targetPath);
    sanitizeForDockerfile(mountArgs);

    debug(`Target path: ${targetPath}`);
    debug(`Mount args (CRITICAL): ${mountArgs}`);

    let dancefileContent: string;

    if (rsyncEnabled) {
        // rsync mode: Use rsync for differential sync (much faster on subsequent runs)
        // Uses ghcr.io/hiromaily/cache-dance-rsync:latest which has rsync pre-installed
        // -a: Archive mode (preserves permissions, timestamps, etc.)
        dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \\
    mkdir -p /var/dance-cache/ \\
    && rsync -a ${targetPath}/ /var/dance-cache/ || true
`;
    } else {
        // Default mode: Use cp for full copy
        dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \\
    mkdir -p /var/dance-cache/ \\
    && cp -p -R ${targetPath}/. /var/dance-cache/ || true
`;
    }

    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);

    debugSection(`Generated Dancefile.extract (CRITICAL - check mount args)`);
    console.log(dancefileContent);

    // Inspect cache source before extraction
    let beforeSize: string | null = null;
    if (debugEnabled) {
        beforeSize = await debugInspectDirectory(cacheSource, `Cache source BEFORE extraction (${cacheSource})`);
    }

    try {
        // Extract Data into Docker Image
        debug(`Running docker buildx build for extraction...`);
        debug(`TIP: For more detailed docker output, run with: BUILDKIT_PROGRESS=plain`);

        // Use --progress=plain in debug mode for detailed output
        const buildArgs = ['buildx', 'build', '--builder', builder, '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', imageName, '--load'];
        if (debugEnabled) {
            buildArgs.push('--progress=plain');
        }
        buildArgs.push(scratchDir);

        await run('docker', buildArgs);
        debug(`Docker build completed successfully (exit code: 0)`);

        // Create Extraction Container
        try {
            await run('docker', ['rm', '-f', containerName]);
        } catch (error) {
            // Ignore error if container does not exist
        }
        debug(`Creating container: ${containerName}`);
        await run('docker', ['create', '-ti', '--name', containerName, imageName]);

        // Unpack Docker Image into Scratch
        debug(`Extracting data from container to scratch dir...`);
        await runPiped(
            ['docker', ['cp', '-L', `${containerName}:/var/dance-cache`, '-']],
            ['tar', ['-H', 'posix', '-x', '-C', scratchDir]]
        );

        // Inspect scratch dir after docker cp
        if (debugEnabled) {
            await debugInspectDirectory(path.join(scratchDir, 'dance-cache'), `Scratch dir after docker cp`);
        }

        // Move Cache into Its Place
        debug(`Moving extracted cache to: ${cacheSource}`);
        await run('sudo', ['rm', '-rf', cacheSource]);
        await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);

        // Inspect cache source after extraction and compare sizes
        let afterSize: string | null = null;
        if (debugEnabled) {
            afterSize = await debugInspectDirectory(cacheSource, `Cache source AFTER extraction (${cacheSource})`);
            debugSizeComparison(beforeSize, afterSize, `Extract: ${cacheSource}`);
        }
    } finally {
        // Cleanup: Remove the temporary container and image (always runs)
        try {
            await run('docker', ['rm', '-f', containerName]);
        } catch (error) {
            // Ignore cleanup errors
        }
        try {
            await run('docker', ['rmi', '-f', imageName]);
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    debug(`Extract cache completed for: ${cacheSource}`);
}

export async function extractCaches(opts: Opts) {
    const debugEnabled = isDebug(opts);
    const rsyncEnabled = isRsyncMode(opts);

    debugSection(`EXTRACT CACHES - POST JOB CLEANUP`);
    debug(`skip-extraction: ${opts["skip-extraction"]}`);
    debug(`Rsync mode: ${rsyncEnabled}`);

    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = getUtilityImage(opts);
    const builder = getBuilder(opts);

    const extractStart = Date.now();
    debugSection(`EXTRACT CACHES - START`);
    debug(`Total caches to extract: ${Object.keys(cacheMap).length}`);
    debug(`Cache map: ${JSON.stringify(cacheMap, null, 2)}`);
    debug(`Rsync mode: ${rsyncEnabled}`);

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir, containerImage, builder, debugEnabled, rsyncEnabled);
    }

    if (debugEnabled) {
        debugSection(`EXTRACT CACHES - TIMING`);
        debug(`Extract total: ${elapsedMs(extractStart)}s (use this to verify cache/rsync improvement)`);
    }
    debugSection(`EXTRACT CACHES - COMPLETE`);
}

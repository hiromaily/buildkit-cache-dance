import { promises as fs } from 'fs';
import path from 'path';
import {CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath, getBuilder, generateUniqueSuffix} from './opts.js';
import { run, runPiped } from './run.js';

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string) {
    // Generate unique names for this cache to avoid conflicts with multiple caches
    const uniqueSuffix = generateUniqueSuffix(cacheSource);
    const imageName = `dance:extract-${uniqueSuffix}`;
    const containerName = `cache-container-${uniqueSuffix}`;

    // Clean Scratch Directory to avoid leftover data from previous iterations
    await fs.rm(scratchDir, { recursive: true, force: true });
    await fs.mkdir(scratchDir, { recursive: true });

    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    const dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    mkdir -p /var/dance-cache/ \
    && cp -p -R ${targetPath}/. /var/dance-cache/ || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    try {
        // Extract Data into Docker Image
        await run('docker', ['buildx', 'build', '--builder', builder, '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', imageName, '--load', scratchDir]);

        // Create Extraction Container
        try {
            await run('docker', ['rm', '-f', containerName]);
        } catch (error) {
            // Ignore error if container does not exist
        }
        await run('docker', ['create', '-ti', '--name', containerName, imageName]);

        // Unpack Docker Image into Scratch
        await runPiped(
            ['docker', ['cp', '-L', `${containerName}:/var/dance-cache`, '-']],
            ['tar', ['-H', 'posix', '-x', '-C', scratchDir]]
        );

        // Move Cache into Its Place
        await run('sudo', ['rm', '-rf', cacheSource]);
        await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);
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
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];
    const builder = getBuilder(opts);

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir, containerImage, builder);
    }
}

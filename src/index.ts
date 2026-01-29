import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { injectCaches } from "./inject-cache.js";
import { extractCaches } from "./extract-cache.js";
import { help, parseOpts, isDebug, getCacheMap, getMountArgsString, getTargetPath } from "./opts.js";
import { setDebugMode, debug, debugSection } from "./run.js";

async function dumpInputs(opts: ReturnType<typeof parseOpts>) {
  debugSection(`INPUT VALUES DUMP`);

  // Environment info
  debug(`GITHUB_WORKSPACE: ${process.env.GITHUB_WORKSPACE || '(not set)'}`);
  debug(`GITHUB_STATE: ${process.env.GITHUB_STATE || '(not set)'}`);
  debug(`STATE_POST: ${process.env.STATE_POST || '(not set)'}`);
  debug(`Current working directory: ${process.cwd()}`);

  // Resolve paths to absolute
  const dockerfilePath = path.resolve(opts.dockerfile);
  const cacheDirPath = opts["cache-dir"] ? path.resolve(opts["cache-dir"]) : '(not set)';
  const scratchDirPath = path.resolve(opts["scratch-dir"]);

  debug(`\n--- Options ---`);
  debug(`builder: ${opts.builder}`);
  debug(`dockerfile: ${opts.dockerfile}`);
  debug(`dockerfile (absolute): ${dockerfilePath}`);
  debug(`cache-dir: ${opts["cache-dir"]}`);
  debug(`cache-dir (absolute): ${cacheDirPath}`);
  debug(`scratch-dir: ${opts["scratch-dir"]}`);
  debug(`scratch-dir (absolute): ${scratchDirPath}`);
  debug(`skip-extraction: ${opts["skip-extraction"]}`);
  debug(`utility-image: ${opts["utility-image"]}`);
  debug(`is-debug: ${opts["is-debug"]}`);
  debug(`extract (post step): ${opts.extract}`);

  debug(`\n--- Raw cache-map input ---`);
  debug(`cache-map: ${opts["cache-map"]}`);

  // Parse and display cache map
  try {
    const cacheMap = await getCacheMap(opts);
    debug(`\n--- Parsed cache-map ---`);
    debug(JSON.stringify(cacheMap, null, 2));

    // Show mount args that will be generated for each cache
    debug(`\n--- Mount args that will be generated ---`);
    for (const [source, cacheOptions] of Object.entries(cacheMap)) {
      const mountArgs = getMountArgsString(cacheOptions);
      const targetPath = getTargetPath(cacheOptions);
      debug(`  ${source}:`);
      debug(`    target: ${targetPath}`);
      debug(`    mount: --mount=${mountArgs}`);
    }
  } catch (e) {
    debug(`Failed to parse cache-map: ${e}`);
  }

  // Check if dockerfile exists
  try {
    await fs.access(dockerfilePath);
    debug(`\n--- Dockerfile check ---`);
    debug(`Dockerfile exists: YES`);
  } catch {
    debug(`\n--- Dockerfile check ---`);
    debug(`Dockerfile exists: NO (path: ${dockerfilePath})`);
  }

  // Check if cache-dir exists
  if (opts["cache-dir"]) {
    try {
      const stats = await fs.stat(cacheDirPath);
      debug(`\n--- Cache-dir check ---`);
      debug(`cache-dir exists: YES (isDirectory: ${stats.isDirectory()})`);
    } catch {
      debug(`\n--- Cache-dir check ---`);
      debug(`cache-dir exists: NO (will be created)`);
    }
  }
}

async function main(args: string[]) {
  const opts = parseOpts(args);

  // Initialize debug mode
  const debugEnabled = isDebug(opts);
  setDebugMode(debugEnabled);

  if (debugEnabled) {
    debugSection(`BuildKit Cache Dance - DEBUG MODE ENABLED`);
    debug(`Step type: ${opts.extract ? 'POST (extract)' : 'MAIN (inject)'}`);
    debug(`Timestamp: ${new Date().toISOString()}`);
    await dumpInputs(opts);
  }

  if (opts.help) {
    return help();
  }

  if (opts.extract) {
    // Run the post step
    await extractCaches(opts);
  } else {
    // Otherwise, this is the main step
    if (process.env.GITHUB_STATE !== undefined) {
      await fs.appendFile(process.env.GITHUB_STATE, `POST=true${os.EOL}`);
    }
    await injectCaches(opts);
  }

  if (debugEnabled) {
    debugSection(`BuildKit Cache Dance - STEP COMPLETE`);
  }
}

main(process.argv)
    .catch(err => {
        console.error(err);
        if (err instanceof Error) {
            console.error(err.stack);
        }
        process.exit(1);
    });

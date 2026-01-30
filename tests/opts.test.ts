import { expect, test } from 'vitest'
import { getCacheMap, getTargetPath, getMountArgsString, parseOpts, getUID, getGID, generateUniqueSuffix, getUtilityImage, DEFAULT_UTILITY_IMAGE, RSYNC_UTILITY_IMAGE } from '../src/opts.js'
import { promises as fs } from 'fs'

test('parseOpts with no arguments', () => {
    const opts = parseOpts([])
    expect(opts).toEqual({
        "_": [],
        "cache-map": "{}",
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('parseOpts with cache-map argument', () => {
    const opts = parseOpts(['--cache-map', '{"key": "value"}'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": '{"key": "value"}',
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('parseOpts with deprecated cache-source and cache-target arguments', () => {
    const opts = parseOpts(['--cache-source', 'source', '--cache-target', 'target'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": '{"source":"target"}',
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "cache-source": 'source',
        "cache-target": 'target',
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('parseOpts with utility-image argument', () => {
    const opts = parseOpts(['--utility-image', 'alpine:1'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": '{}',
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "alpine:1",
        "builder": "default"
    })
})

test('parseOpts with builder argument', () => {
    const opts = parseOpts(['--builder', 'another-builder'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": '{}',
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "another-builder"
    })
})

test('parseOpts with dockerfile argument', () => {
    const opts = parseOpts(['--dockerfile', 'Dockerfile.custom'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": "{}",
        "dockerfile": "Dockerfile.custom",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('parseOpts with cache-dir argument', () => {
    const opts = parseOpts(['--cache-dir', '/tmp/cache'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": "{}",
        "dockerfile": "Dockerfile",
        "cache-dir": "/tmp/cache",
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": false,
        "help": false,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('parseOpts with help argument', () => {
    const opts = parseOpts(['-h'])
    expect(opts).toEqual({
        "_": [],
        "cache-map": "{}",
        "dockerfile": "Dockerfile",
        "cache-dir": null,
        "scratch-dir": "scratch",
        "skip-extraction": false,
        "extract": false,
        "h": true,
        "help": true,
        "is-debug": false,
        "rsync-mode": false,
        "utility-image": "ghcr.io/containerd/busybox:latest",
        "builder": "default"
    })
})

test('getCacheMap', async () => {
    const opts = parseOpts(['--cache-map', '{"key": "value"}'])
    const cacheMap = await getCacheMap(opts)
    expect(cacheMap).toEqual({ key: 'value' })
})

test('getCacheMap with both cache-map and dockerfile specified', async () => {
    const opts = parseOpts(['--cache-map', '{"key": "value"}', '--dockerfile', 'Dockerfile.custom'])
    const cacheMap = await getCacheMap(opts)
    expect(cacheMap).toEqual({ key: 'value' })
})

const DOCKERFILE_CONTENT = `
FROM alpine:latest AS builder

# Target absolute path, no id
RUN --mount=type=cache,target=/tmp/cache \
    echo "Hello, World!" > /tmp/cache/hello.txt

# Target relative path with workdir, no id
WORKDIR /app
RUN --mount=type=cache,target=cache1 \
    echo "Hello, World!" > cache/hello.txt

# Multi-stage build
FROM alpine:latest

# Target absolute path with id
RUN --mount=type=cache,id=cache2,target=/tmp/cache \
    echo "Hello, World!" > /tmp/cache/hello.txt

# Target relative path with workdir and id
WORKDIR /app2
RUN --mount=type=cache,id=cache3,target=cache \
    echo "Hello, World!" > cache/hello.txt
`

test('getCacheMapFromDockerfile without bindRoot', async ({ onTestFinished }) => {
    const tmpDir = await fs.mkdtemp('/tmp/dockerfile-test-')
    onTestFinished(() => fs.rm(tmpDir, { recursive: true }))
    const dockerfilePath = `${tmpDir}/Dockerfile`
    await fs.writeFile(dockerfilePath, DOCKERFILE_CONTENT);

    const opts = parseOpts(['--dockerfile', dockerfilePath])
    const cacheMap = await getCacheMap(opts)

    // Note: path.basename is used for security (prevents path traversal)
    // So '/tmp/cache' becomes 'cache', and 'cache1' stays 'cache1'
    expect(cacheMap).toEqual(
        {
            'cache': {
                'id': '/tmp/cache',
                'target': '/var/cache-target'
            },
            'cache1': {
                'id': 'cache1',
                'target': '/var/cache-target'
            },
            'cache2': {
                'id': 'cache2',
                'target': '/var/cache-target'
            },
            'cache3': {
                'id': 'cache3',
                'target': '/var/cache-target'
            }
        }
    )
});

test('getCacheMapFromDockerfile with bindRoot', async ({ onTestFinished }) => {
    const tmpDir = await fs.mkdtemp('/tmp/dockerfile-test-')
    onTestFinished(() => fs.rm(tmpDir, { recursive: true }))
    const dockerfilePath = `${tmpDir}/Dockerfile`
    const cacheDir: string = `${tmpDir}/cache-mount`
    await fs.writeFile(dockerfilePath, DOCKERFILE_CONTENT);

    const opts = parseOpts(['--dockerfile', dockerfilePath, '--cache-dir', cacheDir])
    const cacheMap = await getCacheMap(opts)

    // Note: path.basename is used for security (prevents path traversal)
    // So '/tmp/cache' becomes 'cache' in the bindDir
    expect(cacheMap).toEqual(
        {
            [`${cacheDir}/cache`]: {
                'id': '/tmp/cache',
                'target': '/var/cache-target'
            },
            [`${cacheDir}/cache1`]: {
                'id': 'cache1',
                'target': '/var/cache-target'
            },
            [`${cacheDir}/cache2`]: {
                'id': 'cache2',
                'target': '/var/cache-target'
            },
            [`${cacheDir}/cache3`]: {
                'id': 'cache3',
                'target': '/var/cache-target'
            }
        }
    )
});

test('getCacheMap with invalid JSON', async() => {
    const opts = parseOpts(['--cache-map', 'invalid'])
    await expect(getCacheMap(opts)).rejects.toThrowError()
})

test('getTargetPath with string', () => {
    const cacheOptions = 'targetPath'
    const targetPath = getTargetPath(cacheOptions)
    expect(targetPath).toBe('targetPath')
})

test('getTargetPath with object', () => {
    const cacheOptions = { target: 'targetPath' }
    const targetPath = getTargetPath(cacheOptions)
    expect(targetPath).toBe('targetPath')
})

test('getTargetPath with invalid object', () => {
    const cacheOptions = {} as any
    expect(() => getTargetPath(cacheOptions)).toThrowError()
})

test('getMountArgsString with string', () => {
    const cacheOptions = 'targetPath'
    const mountString = getMountArgsString(cacheOptions)
    expect(mountString).toBe('type=cache,target=targetPath')
})

test('getMountArgsString with object', () => {
    const cacheOptions = { target: 'targetPath', shared: true, id: 1 }
    const mountString = getMountArgsString(cacheOptions)
    expect(mountString).toBe('type=cache,target=targetPath,shared=true,id=1')
})

test('getMountArgsString with Go cache pattern (explicit id)', () => {
    // This is the typical Go cache pattern used in GitHub Actions:
    // cache-map: { "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" } }
    const goModOptions = { target: '/go/pkg/mod', id: 'go-mod' }
    const goBuildOptions = { target: '/root/.cache/go-build', id: 'go-build' }
    
    expect(getMountArgsString(goModOptions)).toBe('type=cache,target=/go/pkg/mod,id=go-mod')
    expect(getMountArgsString(goBuildOptions)).toBe('type=cache,target=/root/.cache/go-build,id=go-build')
})

test('getCacheMap with explicit cache-map (Go cache pattern) without cache-dir', async () => {
    // Simulates GitHub Actions workflow with explicit cache-map but no cache-dir
    const cacheMapJson = JSON.stringify({
        "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" },
        "go-build": { "target": "/root/.cache/go-build", "id": "go-build" }
    })
    const opts = parseOpts(['--cache-map', cacheMapJson])
    const cacheMap = await getCacheMap(opts)
    
    // Without cache-dir, cache-map keys are used as-is
    expect(cacheMap).toEqual({
        "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" },
        "go-build": { "target": "/root/.cache/go-build", "id": "go-build" }
    })
})

test('getCacheMap with explicit cache-map and cache-dir (Go cache pattern)', async () => {
    // Simulates GitHub Actions workflow with explicit cache-map AND cache-dir
    // This is the common pattern: actions/cache saves cache-mount/, and cache-dance
    // should store caches inside cache-mount/
    const cacheMapJson = JSON.stringify({
        "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" },
        "go-build": { "target": "/root/.cache/go-build", "id": "go-build" }
    })
    const opts = parseOpts(['--cache-map', cacheMapJson, '--cache-dir', 'cache-mount'])
    const cacheMap = await getCacheMap(opts)
    
    // With cache-dir, cache-map keys should be prefixed with cache-dir
    expect(cacheMap).toEqual({
        "cache-mount/go-mod": { "target": "/go/pkg/mod", "id": "go-mod" },
        "cache-mount/go-build": { "target": "/root/.cache/go-build", "id": "go-build" }
    })
})

test('getCacheMap with explicit cache-map and cache-dir (path normalization)', async () => {
    // Test that path.basename is applied to cache-map keys for security
    const cacheMapJson = JSON.stringify({
        "some/nested/path": { "target": "/tmp/cache", "id": "nested" }
    })
    const opts = parseOpts(['--cache-map', cacheMapJson, '--cache-dir', 'cache-mount'])
    const cacheMap = await getCacheMap(opts)
    
    // path.basename extracts only the last component of the key
    expect(cacheMap).toEqual({
        "cache-mount/path": { "target": "/tmp/cache", "id": "nested" }
    })
})

test('getCacheMap with explicit cache-map and empty cache-dir', async () => {
    // Empty string cache-dir should not add any prefix
    const cacheMapJson = JSON.stringify({
        "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" }
    })
    const opts = parseOpts(['--cache-map', cacheMapJson, '--cache-dir', ''])
    const cacheMap = await getCacheMap(opts)
    
    // Empty cache-dir should not affect cache-map keys
    expect(cacheMap).toEqual({
        "go-mod": { "target": "/go/pkg/mod", "id": "go-mod" }
    })
})

test('getUID with string', () => {
    const cacheOptions = 'targetPath'
    const uid = getUID(cacheOptions)
    expect(uid).toBe('')
})


test('getUID with object without uid', () => {
    const cacheOptions = { target: 'targetPath', shared: true, id: 1 }
    const uid = getUID(cacheOptions)
    expect(uid).toBe('')
})

test('getUID with object with uid', () => {
    const cacheOptions = { target: 'targetPath', shared: true, id: 1, uid: 1000 }
    const uid = getUID(cacheOptions)
    expect(uid).toBe('1000')
})

test('getGID with string', () => {
    const cacheOptions = 'targetPath'
    const gid = getGID(cacheOptions)
    expect(gid).toBe('')
})


test('getGID with object without gid', () => {
    const cacheOptions = { target: 'targetPath', shared: true, id: 1 }
    const gid = getGID(cacheOptions)
    expect(gid).toBe('')
})

test('getGID with object with gid', () => {
    const cacheOptions = { target: 'targetPath', shared: true, id: 1, gid: 1000 }
    const gid = getGID(cacheOptions)
    expect(gid).toBe('1000')
})

test('generateUniqueSuffix with simple path', () => {
    const suffix = generateUniqueSuffix('go-mod')
    expect(suffix).toBe('go-mod')
})

test('generateUniqueSuffix with path containing slashes', () => {
    const suffix = generateUniqueSuffix('/var/cache/apt')
    expect(suffix).toBe('var-cache-apt')
})

test('generateUniqueSuffix with path containing special characters', () => {
    const suffix = generateUniqueSuffix('cache-mount/go-mod')
    expect(suffix).toBe('cache-mount-go-mod')
})

test('generateUniqueSuffix with uppercase letters', () => {
    const suffix = generateUniqueSuffix('Go-Build')
    expect(suffix).toBe('go-build')
})

test('generateUniqueSuffix with consecutive special characters', () => {
    const suffix = generateUniqueSuffix('//var//cache//')
    expect(suffix).toBe('var-cache')
})

// getUtilityImage tests
test('getUtilityImage returns default busybox when rsync-mode is false', () => {
    const opts = parseOpts([])
    const image = getUtilityImage(opts)
    expect(image).toBe(DEFAULT_UTILITY_IMAGE)
})

test('getUtilityImage returns rsync image when rsync-mode is true', () => {
    const opts = parseOpts(['--rsync-mode'])
    const image = getUtilityImage(opts)
    expect(image).toBe(RSYNC_UTILITY_IMAGE)
})

test('getUtilityImage respects custom utility-image even with rsync-mode', () => {
    const opts = parseOpts(['--rsync-mode', '--utility-image', 'custom/image:latest'])
    const image = getUtilityImage(opts)
    expect(image).toBe('custom/image:latest')
})

test('getUtilityImage uses rsync image when rsync-mode is true and utility-image is default', () => {
    const opts = parseOpts(['--rsync-mode', '--utility-image', DEFAULT_UTILITY_IMAGE])
    const image = getUtilityImage(opts)
    expect(image).toBe(RSYNC_UTILITY_IMAGE)
})

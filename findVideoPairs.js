const fs = require('fs-extra');
const path = require('path');

/**
 * Extracts username from filename
 * @param {string} filename - The filename to extract username from
 * @returns {string} The extracted username
 */
function extractUsername(filename) {
    // Extract username after the last dash or space
    const match = filename.match(/[- ]([^-]+)\.(?:mp4|mov|MOV|TS)$/);
    return match ? match[1].trim() : '';
}

/**
 * Extracts timestamp or prefix from filename
 * @param {string} filename - The filename to extract timestamp/prefix from
 * @returns {string} The extracted timestamp/prefix
 */
function extractTimestamp(filename) {
    // Extract timestamp or prefix before the username
    const match = filename.match(/^(.+?)(?:\s*-\s*[^-]+\.(?:mp4|mov|MOV|TS))$/);
    return match ? match[1].trim() : '';
}

/**
 * Finds paired video files between product and selfie folders
 * @param {string} sourceDir - The source directory containing product and selfie folders
 * @returns {Promise<Array<{video1: string, video2: string}>>} Array of paired video objects
 */
async function findVideoPairs(sourceDir) {
    try {
        // Ensure the source directory exists
        await fs.ensureDir(sourceDir);
        
        const productDir = path.join(sourceDir, 'product');
        const selfieDir = path.join(sourceDir, 'selfie');

        // Ensure both subdirectories exist
        await fs.ensureDir(productDir);
        await fs.ensureDir(selfieDir);

        // Get files from both directories
        const productFiles = await fs.readdir(productDir);
        const selfieFiles = await fs.readdir(selfieDir);

        // Filter for video files in each directory
        const productVideos = productFiles.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.TS'].includes(ext);
        });

        const selfieVideos = selfieFiles.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.TS'].includes(ext);
        });

        if (productVideos.length === 0 && selfieVideos.length === 0) {
            console.log('\nNo video files found in either product or selfie folders.');
            console.log('Please add video files to the "input/product" and "input/selfie" folders.');
            console.log('Supported formats: .mp4, .avi, .mov, .mkv, .wmv, .TS\n');
            return [];
        }

        if (productVideos.length === 0) {
            console.log('\nNo video files found in the product folder.');
            console.log('Please add product videos to the "input/product" folder.\n');
            return [];
        }

        if (selfieVideos.length === 0) {
            console.log('\nNo video files found in the selfie folder.');
            console.log('Please add selfie videos to the "input/selfie" folder.\n');
            return [];
        }

        // Create maps for product and selfie videos by username
        const productMap = new Map();
        const selfieMap = new Map();

        // Group product videos by username
        productVideos.forEach(file => {
            const username = extractUsername(file);
            if (!productMap.has(username)) {
                productMap.set(username, []);
            }
            productMap.get(username).push({
                file,
                timestamp: extractTimestamp(file)
            });
        });

        // Group selfie videos by username
        selfieVideos.forEach(file => {
            const username = extractUsername(file);
            if (!selfieMap.has(username)) {
                selfieMap.set(username, []);
            }
            selfieMap.get(username).push({
                file,
                timestamp: extractTimestamp(file)
            });
        });

        // Create pairs
        const pairs = [];
        const processedUsernames = new Set();
        const usedProductVideos = new Set();
        const usedSelfieVideos = new Set();

        // Process each username that has both product and selfie videos
        for (const [username, productVids] of productMap) {
            if (!selfieMap.has(username)) continue;

            const selfieVids = selfieMap.get(username);
            
            // Sort videos by timestamp/prefix for consistent pairing
            productVids.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            selfieVids.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            // Match videos based on timestamp/prefix similarity
            const minLength = Math.min(productVids.length, selfieVids.length);
            for (let i = 0; i < minLength; i++) {
                const productVideo = path.join(productDir, productVids[i].file);
                const selfieVideo = path.join(selfieDir, selfieVids[i].file);
                
                // Skip if either video has already been used
                if (usedProductVideos.has(productVideo) || usedSelfieVideos.has(selfieVideo)) {
                    continue;
                }

                // Verify both files exist
                if (await fs.pathExists(productVideo) && await fs.pathExists(selfieVideo)) {
                    pairs.push({
                        video1: productVideo,
                        video2: selfieVideo,
                        name1: path.parse(productVids[i].file).name,
                        name2: path.parse(selfieVids[i].file).name,
                        username: username
                    });
                    usedProductVideos.add(productVideo);
                    usedSelfieVideos.add(selfieVideo);
                }
            }
            processedUsernames.add(username);
        }

        if (pairs.length === 0) {
            console.log('\nNo valid video pairs found.');
            console.log('Please ensure you have matching video files in both product and selfie folders.');
            console.log('Files will be paired based on username and timestamp/prefix.\n');
        } else {
            console.log(`\nFound ${pairs.length} video pair(s):`);
            pairs.forEach((pair, index) => {
                console.log(`Pair ${index + 1} (${pair.username}):`);
                console.log(`  Product: ${pair.name1}`);
                console.log(`  Selfie:  ${pair.name2}`);
            });
            console.log('');

            // Report unmatched videos
            const unmatchedProduct = Array.from(productMap.entries())
                .filter(([username]) => !processedUsernames.has(username))
                .map(([username, videos]) => `${username}: ${videos.length} video(s)`);

            const unmatchedSelfie = Array.from(selfieMap.entries())
                .filter(([username]) => !processedUsernames.has(username))
                .map(([username, videos]) => `${username}: ${videos.length} video(s)`);

            if (unmatchedProduct.length > 0) {
                console.log('Unmatched product videos:');
                unmatchedProduct.forEach(msg => console.log(`  ${msg}`));
                console.log('');
            }

            if (unmatchedSelfie.length > 0) {
                console.log('Unmatched selfie videos:');
                unmatchedSelfie.forEach(msg => console.log(`  ${msg}`));
                console.log('');
            }

            // Report skipped videos due to one-to-one constraint
            const skippedProduct = productVideos.length - usedProductVideos.size;
            const skippedSelfie = selfieVideos.length - usedSelfieVideos.size;

            if (skippedProduct > 0 || skippedSelfie > 0) {
                console.log('Note: Some videos were skipped to maintain one-to-one pairing:');
                if (skippedProduct > 0) {
                    console.log(`  ${skippedProduct} product video(s) skipped`);
                }
                if (skippedSelfie > 0) {
                    console.log(`  ${skippedSelfie} selfie video(s) skipped`);
                }
                console.log('');
            }
        }

        return pairs;
    } catch (error) {
        console.error('\nError finding video pairs:', error.message);
        console.log('\nPlease ensure:');
        console.log('1. The input directory exists and contains "product" and "selfie" subfolders');
        console.log('2. Both subfolders contain video files');
        console.log('3. The video files are in a supported format (.mp4, .avi, .mov, .mkv, .wmv, .TS)\n');
        return [];
    }
}

/**
 * Validates if a pair of videos can be processed together
 * @param {string} video1 - Path to first video
 * @param {string} video2 - Path to second video
 * @returns {Promise<boolean>} True if videos are valid for processing
 */
async function validateVideoPair(video1, video2) {
    try {
        // Check if both files exist
        if (!(await fs.pathExists(video1)) || !(await fs.pathExists(video2))) {
            return false;
        }

        // Get file stats
        const stats1 = await fs.stat(video1);
        const stats2 = await fs.stat(video2);

        // Check if files are not empty
        if (stats1.size === 0 || stats2.size === 0) {
            return false;
        }

        // Check if files are readable
        try {
            await fs.access(video1, fs.constants.R_OK);
            await fs.access(video2, fs.constants.R_OK);
        } catch {
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error validating video pair:', error);
        return false;
    }
}

module.exports = {
    findVideoPairs,
    validateVideoPair
}; 
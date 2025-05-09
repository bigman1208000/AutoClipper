const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { findVideoPairs, validateVideoPair } = require('./findVideoPairs');

const inputDir = path.resolve('input');
const outputDir = path.resolve('output');
const completedDir = path.resolve('completed');
const tempDir = path.resolve('temp');
const duration = 4; // seconds per clip
const totalClips = 30;
const CONCURRENCY = Math.max(2, Math.floor(os.cpus().length / 2)); // Limit parallel jobs

// Sanitize folder name by removing or replacing invalid characters
function sanitizeFolderName(name) {
  // First, extract just the username part if it exists after a dash
  const usernameMatch = name.match(/- ([^-]+)$/);
  const username = usernameMatch ? usernameMatch[1] : name;
  
  // Then sanitize the username
  return username
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid Windows filename characters
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .replace(/[^a-zA-Z0-9._-]/g, '') // Remove any other potentially problematic characters
    .substring(0, 30); // Limit length to avoid path too long errors
}

// Ensure all required folders exist
async function ensureFolders() {
  const dirs = [
    inputDir,
    outputDir,
    path.join(inputDir, 'clips'),
    completedDir,
    path.join(completedDir, 'product'),
    path.join(completedDir, 'selfie'),
    tempDir
  ];

  for (const dir of dirs) {
    try {
      await fs.ensureDir(dir);
      // Ensure directory is writable
      const testFile = path.join(dir, '.test');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
    } catch (error) {
      console.error(`Error setting up directory ${dir}:`, error);
      throw error;
    }
  }
}

async function moveToCompleted(videoPath, type) {
  try {
    const fileName = path.basename(videoPath);
    const targetDir = path.join(completedDir, type);
    const targetPath = path.join(targetDir, fileName);
    
    // If file already exists in completed folder, add timestamp to filename
    if (await fs.pathExists(targetPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(fileName);
      const baseName = path.basename(fileName, ext);
      const newFileName = `${baseName}_${timestamp}${ext}`;
      await fs.move(videoPath, path.join(targetDir, newFileName));
    } else {
      await fs.move(videoPath, targetPath);
    }
    console.log(`Moved ${fileName} to completed/${type} folder`);
  } catch (error) {
    console.error(`Error moving file to completed folder: ${error.message}`);
  }
}

async function splitVideo(input, clipsDir, prefix) {
  await fs.ensureDir(clipsDir);
  const jobs = [];
  for (let i = 0; i < totalClips; i++) {
    const start = i * duration;
    const outPath = path.join(clipsDir, `${prefix}_clip${String(i+1).padStart(2, '0')}.mp4`);
    if (await fs.pathExists(outPath)) continue; // Skip if already exists
    jobs.push(() =>
      new Promise((resolve, reject) => {
        ffmpeg(input)
          .setStartTime(start)
          .setDuration(duration)
          .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-strict', 'experimental']) // normalize clips
          .output(outPath)
          .on('end', () => {
            console.log(`Created ${outPath}`);
            resolve();
          })
          .on('error', reject)
          .run();
      })
    );
  }
  // Run jobs in parallel with concurrency limit
  await runWithConcurrency(jobs, CONCURRENCY);
}

async function runWithConcurrency(tasks, limit) {
  let i = 0;
  async function next() {
    if (i >= tasks.length) return;
    const idx = i++;
    await tasks[idx]();
    await next();
  }
  const runners = [];
  for (let j = 0; j < limit && j < tasks.length; j++) {
    runners.push(next());
  }
  await Promise.all(runners);
}

async function mergeClips(clipsDir1, clipsDir2, outputSubDir, prefix1, prefix2, pairIndex) {
  let success = false;
  
  try {
    // Ensure output and temp directories exist and are writable
    await fs.ensureDir(outputSubDir);
    await fs.ensureDir(tempDir);
    
    // Test write permissions in both directories
    const testFiles = [
      path.join(outputSubDir, '.test'),
      path.join(tempDir, '.test')
    ];
    
    for (const testFile of testFiles) {
      try {
        await fs.writeFile(testFile, 'test');
        await fs.remove(testFile);
      } catch (error) {
        console.error(`Error: Directory ${path.dirname(testFile)} is not writable`);
        throw error;
      }
    }
    
    for (let i = 0; i < totalClips; i++) {
      const clip1 = path.join(clipsDir1, `${prefix1}_clip${String(i+1).padStart(2, '0')}.mp4`);
      const clip2 = path.join(clipsDir2, `${prefix2}_clip${String(i+1).padStart(2, '0')}.mp4`);
      
      if (!(await fs.pathExists(clip1)) || !(await fs.pathExists(clip2))) {
        console.error(`Missing input clips for index ${i+1}:`, clip1, clip2);
        continue;
      }

      // Create a unique temporary file name
      const timestamp = Date.now();
      const tempOutPath = path.join(tempDir, `temp_${timestamp}_clip${String(i+1).padStart(2, '0')}.mp4`);
      const finalOutPath = path.join(outputSubDir, `final_clip${String(i+1).padStart(2, '0')}.mp4`);
      
      try {
        const command = ffmpeg()
          .input(clip1)
          .input(clip2);

        // Check if both files have video streams before processing
        try {
          const probe1 = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(clip1, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });

          const probe2 = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(clip2, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });

          const hasVideo1 = probe1.streams.some(s => s.codec_type === 'video');
          const hasVideo2 = probe2.streams.some(s => s.codec_type === 'video');

          if (!hasVideo1 || !hasVideo2) {
            console.warn(`Skipping clip ${i+1} - One or both input files are missing video streams: ${clip1}, ${clip2}`);
            return; // Skip this clip and continue with the next one
          }

          // Basic filter chain with proper output mapping
          command
            .complexFilter(
              '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v0];' +
              '[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v1];' +
              '[v0][v1]concat=n=2:v=1:a=0',
              []
            )
            .outputOptions([
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-s', '1080x1920',
              '-an',
              '-y'
            ]);

          command.output(tempOutPath);
        } catch (error) {
          console.warn(`Error checking video streams for clip ${i+1}: ${error.message}`);
          return; // Skip this clip and continue with the next one
        }

        await new Promise((resolve, reject) => {
          command.on('start', (commandLine) => {
            // console.log(`Starting FFmpeg with command: ${commandLine}`);
          });

          command.on('progress', (progress) => {
            // console.log(`Processing ${tempOutPath}: ${Math.round(progress.percent)}% done`);
          });

          command.on('stderr', (stderrLine) => {
            // console.log(`FFmpeg stderr: ${stderrLine}`);
          });

          command.on('end', async () => {
            try {
              // Verify the temporary file exists and has content
              const stats = await fs.stat(tempOutPath);
              if (stats.size === 0) {
                throw new Error('Temporary output file is empty');
              }
              
              // Move the file from temp to final location
              await fs.move(tempOutPath, finalOutPath, { overwrite: true });
              console.log(`Successfully created ${finalOutPath}`);
              resolve();
            } catch (error) {
              // Clean up temporary file if it exists
              try {
                await fs.remove(tempOutPath);
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
              reject(error);
            }
          });

          command.on('error', (err, stdout, stderr) => {
            // Clean up temporary file if it exists
            try {
              fs.removeSync(tempOutPath);
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
            console.error('FFmpeg stderr:', stderr);
            console.error('Error details:', err);
            reject(new Error(`FFmpeg error: ${err.message}`));
          });

          command.run();
        });
      } catch (error) {
        console.error(`Failed to merge clips for ${prefix1} and ${prefix2} at index ${i+1}:`, error);
        throw error; // Re-throw to prevent moving to completed folder
      }
    }
    success = true;
  } catch (error) {
    console.error('Error in mergeClips:', error);
    throw error;
  }
  return success;
}

async function processVideoPair(pair, pairIndex) {
  try {
    if (!(await validateVideoPair(pair.video1, pair.video2))) {
      console.error(`Invalid video pair: ${pair.name1} and ${pair.name2}`);
      return;
    }

    console.log(`Processing pair: ${pair.name1} and ${pair.name2}`);
    
    // Create clip directories for this pair
    const clipsDir1 = path.join('clips', sanitizeFolderName(pair.name1));
    const clipsDir2 = path.join('clips', sanitizeFolderName(pair.name2));
    const outputSubDir = path.join(outputDir, `${String(pairIndex + 1).padStart(2, '0')}_${sanitizeFolderName(pair.name1)}_${sanitizeFolderName(pair.name2)}`);

    try {
      // Process the videos
      console.log(`Splitting ${pair.name1}...`);
      await splitVideo(pair.video1, clipsDir1, pair.name1);
      
      console.log(`Splitting ${pair.name2}...`);
      await splitVideo(pair.video2, clipsDir2, pair.name2);
      
      console.log(`Merging clips for ${pair.name1} and ${pair.name2}...`);
      const mergeSuccess = await mergeClips(clipsDir1, clipsDir2, outputSubDir, pair.name1, pair.name2, pairIndex);
      
      // Only move to completed folder if merge was successful
      if (mergeSuccess) {
        await moveToCompleted(pair.video1, 'product');
        await moveToCompleted(pair.video2, 'selfie');
      } else {
        console.error(`Skipping move to completed folder due to merge failure for ${pair.name1} and ${pair.name2}`);
      }
      
      // Clean up clip directories
      await fs.remove(clipsDir1);
      await fs.remove(clipsDir2);
      
      console.log(`Completed processing pair: ${pair.name1} and ${pair.name2}`);
    } catch (error) {
      console.error(`Error processing pair ${pair.name1} and ${pair.name2}:`, error);
      // Clean up any partial output
      try {
        await fs.remove(outputSubDir);
        await fs.remove(clipsDir1);
        await fs.remove(clipsDir2);
      } catch (cleanupError) {
        console.error('Error cleaning up partial output:', cleanupError);
      }
    }
  } catch (error) {
    console.error(`Error processing pair ${pair.name1} and ${pair.name2}:`, error);
  }
}

(async () => {
  try {
    await ensureFolders();
    
    // Find and process all video pairs
    const pairs = await findVideoPairs(inputDir);
    
    if (pairs.length === 0) {
      console.log('No video pairs to process. Please add video files to the input/product and input/selfie folders.');
      return;
    }
    
    // Process pairs sequentially to avoid overwhelming the system
    for (let i = 0; i < pairs.length; i++) {
      await processVideoPair(pairs[i], i);
    }
    
    console.log('All video pairs processed successfully!');
  } catch (err) {
    console.error('Error:', err);
  }
})();
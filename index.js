const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const inputDir = 'input';
const clipsDir1 = 'clips/video1';
const clipsDir2 = 'clips/video2';
const outputDir = 'output';

const input1 = path.join(inputDir, 'video1.mp4');
const input2 = path.join(inputDir, 'video2.mp4');

const duration = 4; // seconds per clip
const totalClips = 30;

// Extract base names for prefix
const prefix1 = path.parse(input1).name; // e.g., 'video1'
const prefix2 = path.parse(input2).name; // e.g., 'video2'

// Output subfolder
const outputSubDir = path.join(outputDir, `${prefix1}_${prefix2}`);

const CONCURRENCY = Math.max(2, Math.floor(os.cpus().length / 2)); // Limit parallel jobs

// Ensure all required folders exist
async function ensureFolders() {
  await fs.ensureDir('input');
  await fs.ensureDir('output');
  await fs.ensureDir('clips/video1');
  await fs.ensureDir('clips/video2');
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

async function mergeClips(prefix1, prefix2, outputSubDir) {
  await fs.ensureDir(outputSubDir);
  for (let i = 0; i < totalClips; i++) {
    const clip1 = path.join(clipsDir1, `${prefix1}_clip${String(i+1).padStart(2, '0')}.mp4`);
    const clip2 = path.join(clipsDir2, `${prefix2}_clip${String(i+1).padStart(2, '0')}.mp4`);
    if (!(await fs.pathExists(clip1)) || !(await fs.pathExists(clip2))) {
      console.error(`Missing input clips for index ${i+1}:`, clip1, clip2);
      continue;
    }
    const outPath = path.join(outputSubDir, `final_clip${String(i+1).padStart(2, '0')}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(clip1)
        .input(clip2)
        .complexFilter([
          {
            filter: 'concat',
            options: {
              n: 2, // number of segments
              v: 1, // number of video streams
              a: 1  // number of audio streams
            }
          }
        ])
        .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-strict', 'experimental'])
        .output(outPath)
        .on('end', () => {
          console.log(`Created ${outPath}`);
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }
}

(async () => {
  try {
    await ensureFolders();
    console.log('Splitting video 1...');
    await splitVideo(input1, clipsDir1, prefix1);
    console.log('Splitting video 2...');
    await splitVideo(input2, clipsDir2, prefix2);
    console.log('Merging clips...');
    await mergeClips(prefix1, prefix2, outputSubDir);
    console.log('All done!');
  } catch (err) {
    console.error('Error:', err);
  }
})();
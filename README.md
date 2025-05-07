# Video Split and Merge Automation

This project automatically splits two input videos into 4-second clips, then merges corresponding clips into 8-second final videos. All processing is done locally using Node.js and FFmpeg.

---

## Prerequisites

### 1. Install FFmpeg

- Download FFmpeg from [https://www.gyan.dev/ffmpeg/builds/](https://www.gyan.dev/ffmpeg/builds/)
- Extract the archive (e.g., to `C:\ffmpeg`)
- Add the `bin` folder (e.g., `C:\ffmpeg\bin`) to your system `PATH` environment variable
- Open a new terminal and verify installation by running:
  ```sh
  ffmpeg -version
  ```

### 2. Install Node.js and npm

- Download and install Node.js (which includes npm) from [https://nodejs.org/](https://nodejs.org/)
- Verify installation by running:
  ```sh
  node -v
  npm -v
  ```

---

## Setup

1. Clone or download this repository to your local machine.
2. Open a terminal in the project directory.
3. Install dependencies:
   ```sh
   npm install
   ```
4. Prepare your input videos:
   - Place two video files in the `input/` folder.
   - Name them exactly `video1.mp4` and `video2.mp4`.

---

## Usage

Run the script with:
```sh
node index.js
```

- The script will:
  - Automatically create all required folders (`input`, `output`, `clips/video1`, `clips/video2`) if they do not exist.
  - Split each input video into 30 clips of 4 seconds each.
  - Merge corresponding clips into 8-second videos.
  - Save the final merged videos in a subfolder of `output/` named `video1_video2`.

---

## Output

- Final merged clips will be in `output/video1_video2/` (or named after your input files).

---

## Notes

- Make sure your input videos are at least 2 minutes (120 seconds) long.
- If you want to process different videos, replace the files in the `input/` folder and re-run the script.
- **No need to manually create any folders**—the script will handle this for you.

---

If you encounter any issues, ensure FFmpeg is installed and available in your system PATH, and that your input files are named correctly.
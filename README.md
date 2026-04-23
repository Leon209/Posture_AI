## Posture.AI

Posture.AI is a browser-based posture coach that uses your webcam and MediaPipe landmarks to detect slouching, forward head posture, and head tilt (looking down). It guides you with real-time feedback after a short calibration.

## How to use

### Setup

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open the local URL shown in the terminal (Vite), and **allow camera access** in your browser.

### Calibrate

1. Click **Calibrate**.
2. Follow the on-screen prompts:
   - **Step 1**: Sit in your ideal posture
   - **Step 2**: Slowly lean forward
   - **Step 3**: Slowly lean back

Calibration trains simple per-user models so you can move closer/farther from the camera while still being evaluated relative to “good posture”.


### Interpreting feedback

- **Straighten your back**: shoulders are lower than expected for your current depth
- **Head forward**: nose is further forward than expected relative to shoulders
- **Looking down**: eye-to-mouth depth relationship is outside your neutral range
- **Close your mouth**: mouth-open detected for a short delay



